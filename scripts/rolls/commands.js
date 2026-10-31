import { getDerivedStats } from "../calculations.js";
import { applyDamagePools } from "../combat/damage-pools.js";
import { getEffectiveSelectedTechniqueIds } from "../selectors/techniques.js";
import { getSessionContext, getState, updateSessionState } from "../state.js";
import { calculateCharacterRoll } from "./calculations.js";
import { getSaraRollBreakdown } from "./providers/sara.js";

const HISTORY_LIMIT = 50;
const PENDING_CONSEQUENCE_LIMIT = 20;

export function recordCharacterRoll(input) {
  const context = getSessionContext();
  const character = getState();
  const breakdown = getSaraRollBreakdown(character, input.kind, input.id);
  if (!breakdown.ok) return { status: "rejected", reason: breakdown.reason };
  const calculated = calculateCharacterRoll(input, breakdown);
  if (!calculated.ok) return { status: "rejected", reason: calculated.reason };
  const existingRecords = Array.isArray(character.characterRolls?.records)
    ? character.characterRolls.records
    : [];
  if (calculated.consequenceProfile !== "none" &&
      existingRecords.filter((entry) =>
        ["pending", "awaiting-outcome"].includes(entry.consequence?.status)).length >=
        PENDING_CONSEQUENCE_LIMIT) {
    return {
      status: "rejected",
      reason: "Есть 20 нерешённых последствий; сначала обработайте одно из них.",
    };
  }
  calculated.id = `roll-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  calculated.appliedAmendments = [];
  calculated.consequence = calculated.consequenceProfile === "none"
    ? null
    : { status: calculated.dcResult == null ? "awaiting-outcome" : "pending" };
  const result = updateSessionState(context, (draft) => {
    draft.characterRolls ??= { records: [] };
    const records = [
      ...(Array.isArray(draft.characterRolls.records) ? draft.characterRolls.records : []),
      calculated,
    ];
    const unresolved = records.filter((entry) =>
      ["pending", "awaiting-outcome"].includes(entry.consequence?.status));
    const completed = records.filter((entry) =>
      !["pending", "awaiting-outcome"].includes(entry.consequence?.status))
      .slice(-(HISTORY_LIMIT - PENDING_CONSEQUENCE_LIMIT));
    draft.characterRolls.records = [...completed, ...unresolved];
    return draft;
  }, { metadata: { kind: "character-roll-recorded" } });
  return result.status === "applied"
    ? { ...result, record: calculated }
    : result;
}

export function amendCharacterRoll(rollId, techniqueId) {
  const context = getSessionContext();
  let amendedRecord = null;
  let reason = null;
  const result = updateSessionState(context, (draft) => {
    const records = draft.characterRolls?.records;
    const record = Array.isArray(records) ? records.find((entry) => entry.id === rollId) : null;
    if (!record) {
      reason = "Бросок больше не найден.";
      return false;
    }
    if (!["ll-monk:mantle-of-courtesy", "ll-monk:indomitable-spirit"].includes(techniqueId) ||
        !getEffectiveSelectedTechniqueIds(draft).has(techniqueId)) {
      reason = "Эта техника сейчас недоступна.";
      return false;
    }
    if (record.appliedAmendments?.some((entry) => entry.techniqueId === techniqueId)) {
      reason = "Эта поправка уже применена к броску.";
      return false;
    }
    const mantle = techniqueId === "ll-monk:mantle-of-courtesy";
    if (record.kind !== "ability-check" ||
        (mantle ? record.skillId !== "persuasion" : record.skillId !== "athletics")) {
      reason = mantle
        ? "Мантия учтивости применяется только к проверке Убеждения."
        : "Несокрушимый дух применяется только к проверке Атлетики.";
      return false;
    }
    const ki = Number(draft.combat?.ki?.current);
    if (!Number.isInteger(ki) || ki < 1) {
      reason = "Для этой поправки требуется 1 ци.";
      return false;
    }
    const before = {
      chosenD20: record.chosenD20,
      modifier: record.totalModifier,
      total: record.total,
    };
    draft.combat.ki.current = ki - 1;
    if (mantle) {
      record.chosenD20 = Number(draft.profile.level);
    } else {
      const wisdom = Number(getDerivedStats(draft).abilityModifiers?.wisdom);
      if (!Number.isFinite(wisdom)) {
        reason = "Не удалось определить модификатор Мудрости.";
        return false;
      }
      record.totalModifier += wisdom;
      record.modifierSnapshot.push({
        id: "indomitable-spirit",
        label: "Несокрушимый дух — Мудрость",
        value: wisdom,
      });
    }
    record.total = record.chosenD20 + record.totalModifier;
    record.dcResult = record.dc == null ? null : record.total >= record.dc;
    record.appliedAmendments ??= [];
    record.appliedAmendments.push({
      techniqueId,
      paidKi: 1,
      before,
      after: {
        chosenD20: record.chosenD20,
        modifier: record.totalModifier,
        total: record.total,
      },
      appliedAt: new Date().toISOString(),
    });
    amendedRecord = structuredClone(record);
    return draft;
  }, { metadata: { kind: "character-roll-amended", rollId, techniqueId } });
  if (result.status !== "applied") {
    return { ...result, reason: reason ?? result.reason };
  }
  return { ...result, record: amendedRecord };
}

export function correctCharacterRollOutcome(rollId, outcome) {
  if (!["success", "failure"].includes(outcome)) {
    return { status: "rejected", reason: "Выберите успех или провал." };
  }
  const context = getSessionContext();
  let corrected = null;
  let reason = null;
  const result = updateSessionState(context, (draft) => {
    const record = draft.characterRolls?.records?.find((entry) => entry.id === rollId);
    if (!record || record.kind !== "saving-throw") {
      reason = "Записанный спасбросок не найден.";
      return false;
    }
    record.manualOutcome = outcome;
    record.dcResult = outcome === "success";
    if (record.consequence?.status === "awaiting-outcome") {
      record.consequence.status = "pending";
    }
    corrected = structuredClone(record);
    return draft;
  }, { metadata: { kind: "character-roll-outcome-corrected", rollId } });
  return result.status === "applied"
    ? { ...result, record: corrected }
    : { ...result, reason: reason ?? result.reason };
}

export function resolveCharacterRollConsequence(rollId, resolution) {
  if (!["apply-to-character", "tracked-elsewhere"].includes(resolution)) {
    return { status: "rejected", reason: "Выберите способ учёта последствия." };
  }
  const context = getSessionContext();
  let resolved = null;
  let reason = null;
  let hpSnapshot = null;
  const result = updateSessionState(context, (draft) => {
    const record = draft.characterRolls?.records?.find((entry) => entry.id === rollId);
    if (!record || record.kind !== "saving-throw" || !record.consequence ||
        record.consequence.status !== "pending" || typeof record.dcResult !== "boolean") {
      reason = "Нет спасброска с известным исходом и ожидающим последствием.";
      return false;
    }
    const damage = Number(record.incomingDamage);
    if (!Number.isInteger(damage) || damage < 0) {
      reason = "В записи спасброска некорректен урон.";
      return false;
    }
    let calculatedDamage = 0;
    if (record.consequenceProfile === "failure-full") {
      calculatedDamage = record.dcResult ? 0 : damage;
    } else if (record.consequenceProfile === "save-half") {
      if (record.evasionEligible) {
        calculatedDamage = record.dcResult ? 0 : Math.floor(damage / 2);
      } else {
        calculatedDamage = record.dcResult ? Math.floor(damage / 2) : damage;
      }
    } else {
      reason = "Для спасброска не указан поддерживаемый профиль урона.";
      return false;
    }
    if (resolution === "apply-to-character") {
      const hp = draft.combat?.hp;
      const pools = applyDamagePools(Number(hp?.current), Number(hp?.temp ?? 0), calculatedDamage);
      if (!pools.ok) {
        reason = pools.reason;
        return false;
      }
      hp.current = pools.hpAfter;
      hp.temp = pools.tempHpAfter;
      hpSnapshot = {
        hpBefore: pools.hpBefore,
        hpAfter: pools.hpAfter,
        tempHpBefore: pools.tempHpBefore,
        tempHpAfter: pools.tempHpAfter,
      };
    }
    record.consequence = {
      status: resolution === "apply-to-character" ? "applied" : "tracked-elsewhere",
      profile: record.consequenceProfile,
      calculatedDamage,
      evasionUsed: record.evasionEligible && resolution === "apply-to-character",
      ...(hpSnapshot ?? {}),
      resolvedAt: new Date().toISOString(),
    };
    resolved = structuredClone(record);
    return draft;
  }, { metadata: { kind: "character-roll-consequence-resolved", rollId, resolution } });
  return result.status === "applied"
    ? { ...result, record: resolved }
    : { ...result, reason: reason ?? result.reason };
}
