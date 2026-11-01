import { getDerivedStats } from "../calculations.js";
import { applyDamagePools } from "../combat/damage-pools.js";
import { getEffectiveSelectedTechniqueIds } from "../selectors/techniques.js";
import { getSessionContext, getState, isCurrentSession, updateSessionState } from "../state.js";
import { calculateCharacterRoll } from "./calculations.js";
import { calculateRollConsequencePreview } from "./consequences.js";
import { getSaraRollBreakdown } from "./providers/sara.js";

const HISTORY_LIMIT = 50;
const PENDING_CONSEQUENCE_LIMIT = 20;
const PENDING_CONSEQUENCE_STATUSES = new Set([
  "pending",
  "awaiting-outcome",
  "awaiting-damage-decision",
  "awaiting-damage-input",
]);

export function isRollConsequencePending(record) {
  return PENDING_CONSEQUENCE_STATUSES.has(record?.consequence?.status);
}

function getMutationContext(options) {
  if (options.owner && !isCurrentSession(options.owner)) {
    return { error: { status: "rejected", reason: "stale-session" } };
  }
  return { context: getSessionContext() };
}

function buildRollRecord(input, options = {}) {
  if (options.outcome != null && !["success", "failure"].includes(options.outcome)) {
    return { ok: false, reason: "Выберите успех или провал." };
  }
  const character = getState();
  const breakdown = getSaraRollBreakdown(character, input.kind, input.id);
  if (!breakdown.ok) return { ok: false, reason: breakdown.reason };
  const calculated = calculateCharacterRoll(input, breakdown);
  if (!calculated.ok) return calculated;
  if (options.outcome) {
    calculated.manualOutcome = options.outcome;
    calculated.dcResult = options.outcome === "success";
  } else {
    calculated.manualOutcome = null;
  }
  calculated.id = `roll-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  calculated.appliedAmendments = [];
  if (calculated.consequenceProfile !== "none") {
    calculated.consequence = {
      status: typeof calculated.dcResult === "boolean" ? "pending" : "awaiting-outcome",
    };
  } else if (options.askForDamage === true && calculated.kind === "saving-throw") {
    calculated.consequence = {
      status: options.outcome ? "awaiting-damage-decision" : "awaiting-outcome",
    };
  } else if (options.askForDamage === true && options.outcome == null) {
    calculated.consequence = { status: "awaiting-outcome" };
  } else {
    calculated.consequence = null;
  }
  return { ok: true, record: calculated, character };
}

function hasPendingCapacity(character, record) {
  if (!isRollConsequencePending(record)) return true;
  const records = Array.isArray(character.characterRolls?.records)
    ? character.characterRolls.records : [];
  return records.filter(isRollConsequencePending).length < PENDING_CONSEQUENCE_LIMIT;
}

function trimRollHistory(draft) {
  const records = Array.isArray(draft.characterRolls?.records)
    ? draft.characterRolls.records : [];
  const unresolved = records.filter(isRollConsequencePending);
  const completed = records.filter((entry) => !isRollConsequencePending(entry))
    .slice(-(HISTORY_LIMIT - PENDING_CONSEQUENCE_LIMIT));
  draft.characterRolls.records = [...completed, ...unresolved];
}

function applyAmendmentToRecord(draft, record, techniqueId, {
  strictTiming = false,
  timingConfirmed = false,
} = {}) {
  if (!["ll-monk:mantle-of-courtesy", "ll-monk:indomitable-spirit"].includes(techniqueId) ||
      !getEffectiveSelectedTechniqueIds(draft).has(techniqueId)) {
    return { ok: false, reason: "Эта техника сейчас недоступна." };
  }
  if (record.appliedAmendments?.some((entry) => entry.techniqueId === techniqueId)) {
    return { ok: false, reason: "Эта поправка уже применена к броску." };
  }
  const mantle = techniqueId === "ll-monk:mantle-of-courtesy";
  if (record.kind !== "ability-check" ||
      (mantle ? record.skillId !== "persuasion" : record.skillId !== "athletics")) {
    return {
      ok: false,
      reason: mantle
        ? "Мантия учтивости применяется только к проверке Убеждения."
        : "Несокрушимый дух применяется только к проверке Атлетики.",
    };
  }
  if (!mantle && strictTiming && timingConfirmed !== true) {
    return { ok: false, reason: "Подтвердите, что исход ещё не объявлен ведущим." };
  }
  const ki = Number(draft.combat?.ki?.current);
  if (!Number.isInteger(ki) || ki < 1) {
    return { ok: false, reason: "Для этой поправки требуется 1 ци." };
  }
  const before = {
    chosenD20: record.chosenD20,
    modifier: record.totalModifier,
    total: record.total,
  };
  if (mantle) {
    const level = Number(draft.profile?.level);
    if (!Number.isInteger(level) || level < 1) {
      return { ok: false, reason: "Не удалось определить уровень персонажа." };
    }
    record.chosenD20 = level;
  } else {
    const wisdom = Number(getDerivedStats(draft).abilityModifiers?.wisdom);
    if (!Number.isFinite(wisdom)) {
      return { ok: false, reason: "Не удалось определить модификатор Мудрости." };
    }
    record.totalModifier += wisdom;
    record.modifierSnapshot.push({
      id: "indomitable-spirit",
      label: "Несокрушимый дух — Мудрость",
      value: wisdom,
    });
  }
  draft.combat.ki.current = ki - 1;
  record.total = record.chosenD20 + record.totalModifier;
  record.dcResult = record.manualOutcome
    ? record.manualOutcome === "success"
    : record.dc == null ? null : record.total >= record.dc;
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
  return { ok: true };
}

function commitNewRoll(record, options, amendment = null) {
  const mutation = getMutationContext(options);
  if (mutation.error) return mutation.error;
  if (!hasPendingCapacity(getState(), record)) {
    return {
      status: "rejected",
      reason: "Есть 20 нерешённых последствий; сначала обработайте одно из них.",
    };
  }
  let savedRecord = null;
  let reason = null;
  const result = updateSessionState(mutation.context, (draft) => {
    draft.characterRolls ??= { records: [] };
    const created = structuredClone(record);
    const records = Array.isArray(draft.characterRolls.records)
      ? draft.characterRolls.records : [];
    if (amendment) {
      const applied = applyAmendmentToRecord(draft, created, amendment.techniqueId, amendment);
      if (!applied.ok) {
        reason = applied.reason;
        return false;
      }
    }
    draft.characterRolls.records = [...records, created];
    trimRollHistory(draft);
    savedRecord = structuredClone(created);
    return draft;
  }, {
    operationId: options.operationId ?? null,
    metadata: {
      kind: amendment ? "character-roll-recorded-and-amended" : "character-roll-recorded",
      rollId: record.id,
      techniqueId: amendment?.techniqueId ?? null,
    },
  });
  if (result.status !== "applied") return { ...result, reason: reason ?? result.reason };
  return { ...result, record: savedRecord };
}

export function recordCharacterRoll(input, options = {}) {
  const built = buildRollRecord(input, options);
  if (!built.ok) return { status: "rejected", reason: built.reason };
  return commitNewRoll(built.record, options);
}

export function recordAndAmendCharacterRoll(input, techniqueId, options = {}) {
  const built = buildRollRecord(input, options);
  if (!built.ok) return { status: "rejected", reason: built.reason };
  return commitNewRoll(built.record, options, {
    techniqueId,
    strictTiming: true,
    timingConfirmed: options.timingConfirmed === true,
  });
}

export function amendCharacterRoll(rollId, techniqueId, options = {}) {
  const mutation = getMutationContext(options);
  if (mutation.error) return mutation.error;
  let amendedRecord = null;
  let reason = null;
  const result = updateSessionState(mutation.context, (draft) => {
    const record = draft.characterRolls?.records?.find((entry) => entry.id === rollId);
    if (!record) {
      reason = "Бросок больше не найден.";
      return false;
    }
    const applied = applyAmendmentToRecord(draft, record, techniqueId, options);
    if (!applied.ok) {
      reason = applied.reason;
      return false;
    }
    amendedRecord = structuredClone(record);
    return draft;
  }, {
    operationId: options.operationId ?? null,
    metadata: { kind: "character-roll-amended", rollId, techniqueId },
  });
  if (result.status !== "applied") {
    return { ...result, reason: reason ?? result.reason };
  }
  return { ...result, record: amendedRecord };
}

export function correctCharacterRollOutcome(rollId, outcome, options = {}) {
  if (!["success", "failure"].includes(outcome)) {
    return { status: "rejected", reason: "Выберите успех или провал." };
  }
  const mutation = getMutationContext(options);
  if (mutation.error) return mutation.error;
  let corrected = null;
  let reason = null;
  const result = updateSessionState(mutation.context, (draft) => {
    const record = draft.characterRolls?.records?.find((entry) => entry.id === rollId);
    if (!record || !["ability-check", "saving-throw"].includes(record.kind)) {
      reason = "Записанный бросок не найден.";
      return false;
    }
    const previousOutcome = record.manualOutcome ??
      (typeof record.dcResult === "boolean" ? record.dcResult ? "success" : "failure" : null);
    record.manualOutcome = outcome;
    record.dcResult = outcome === "success";
    if (record.kind === "saving-throw" &&
        (!record.consequence || record.consequence.status === "awaiting-outcome")) {
      record.consequence = { status: "awaiting-damage-decision" };
    } else if (record.kind === "ability-check" &&
        record.consequence?.status === "awaiting-outcome") {
      record.consequence = null;
    }
    if (record.consequence?.status === "applied" && previousOutcome !== outcome) {
      record.consequence.outcomeCorrectedAfterApplication = true;
    }
    corrected = structuredClone(record);
    return draft;
  }, {
    operationId: options.operationId ?? null,
    metadata: { kind: "character-roll-outcome-corrected", rollId, outcome },
  });
  return result.status === "applied"
    ? { ...result, record: corrected }
    : { ...result, reason: reason ?? result.reason };
}

function applyLegacyConsequence(record, draft, resolution) {
  const damage = Number(record.incomingDamage);
  if (!Number.isInteger(damage) || damage < 0) {
    return { ok: false, reason: "В записи спасброска некорректен урон." };
  }
  let calculatedDamage = 0;
  if (record.consequenceProfile === "failure-full") {
    calculatedDamage = record.dcResult ? 0 : damage;
  } else if (record.consequenceProfile === "save-half") {
    calculatedDamage = record.evasionEligible
      ? record.dcResult ? 0 : Math.floor(damage / 2)
      : record.dcResult ? Math.floor(damage / 2) : damage;
  } else {
    return { ok: false, reason: "Для спасброска не указан поддерживаемый профиль урона." };
  }
  let hpSnapshot = null;
  if (resolution === "apply-to-character") {
    const hp = draft.combat?.hp;
    const pools = applyDamagePools(Number(hp?.current), Number(hp?.temp ?? 0), calculatedDamage);
    if (!pools.ok) return pools;
    hp.current = pools.hpAfter;
    hp.temp = pools.tempHpAfter;
    hpSnapshot = {
      hpBefore: pools.hpBefore,
      hpAfter: pools.hpAfter,
      tempHpBefore: pools.tempHpBefore,
      tempHpAfter: pools.tempHpAfter,
    };
  }
  return {
    ok: true,
    calculatedDamage,
    consequence: {
      status: resolution === "apply-to-character" ? "applied" : "tracked-elsewhere",
      profile: record.consequenceProfile,
      calculatedDamage,
      evasionUsed: record.evasionEligible && resolution === "apply-to-character",
      ...(hpSnapshot ?? {}),
      outcomeAtApplication: record.dcResult ? "success" : "failure",
      resolvedAt: new Date().toISOString(),
    },
  };
}

export function resolveCharacterRollConsequence(rollId, resolution, input = null, options = {}) {
  const allowed = [
    "apply-to-character",
    "tracked-elsewhere",
    "no-damage",
    "begin-damage-input",
    "has-damage",
  ];
  if (!allowed.includes(resolution)) {
    return { status: "rejected", reason: "Выберите способ учёта последствия." };
  }
  const mutation = getMutationContext(options);
  if (mutation.error) return mutation.error;
  let resolved = null;
  let reason = null;
  const result = updateSessionState(mutation.context, (draft) => {
    const record = draft.characterRolls?.records?.find((entry) => entry.id === rollId);
    if (!record || !["ability-check", "saving-throw"].includes(record.kind)) {
      reason = "Запись броска больше не найдена.";
      return false;
    }
    const status = record.consequence?.status ?? null;
    if (resolution === "no-damage") {
      if (record.kind !== "saving-throw" ||
          !["awaiting-damage-decision", "awaiting-damage-input"].includes(status)) {
        reason = "Для этой записи сейчас нельзя отметить отсутствие урона.";
        return false;
      }
      record.consequence = {
        status: "resolved-none",
        profile: "none",
        finalDamage: 0,
        outcomeAtResolution: record.manualOutcome ??
          (record.dcResult ? "success" : "failure"),
        ruleExplanation: "Ведущий подтвердил, что урона по хитам нет.",
        resolvedAt: new Date().toISOString(),
      };
    } else if (resolution === "has-damage" || resolution === "begin-damage-input") {
      const hasOutcome = record.manualOutcome === "success" || record.manualOutcome === "failure" ||
        typeof record.dcResult === "boolean";
      if (!hasOutcome) {
        reason = "Сначала запишите полученный от ведущего исход.";
        return false;
      }
      const validSaveStep = record.kind === "saving-throw" && status === "awaiting-damage-decision";
      const validCheckStep = record.kind === "ability-check" &&
        (status == null || status === "awaiting-damage-decision");
      if (!validSaveStep && !validCheckStep) {
        reason = "Оценка урона для этого броска уже начата или завершена.";
        return false;
      }
      record.consequence = { status: "awaiting-damage-input" };
    } else if (status === "pending") {
      if (record.kind !== "saving-throw" || typeof record.dcResult !== "boolean") {
        reason = "Нет старого ожидающего последствия с известным исходом.";
        return false;
      }
      const legacy = applyLegacyConsequence(record, draft, resolution);
      if (!legacy.ok) {
        reason = legacy.reason;
        return false;
      }
      record.consequence = legacy.consequence;
    } else if (status === "awaiting-damage-input") {
      const preview = calculateRollConsequencePreview(record, draft, input ?? {});
      if (!preview.ok) {
        reason = preview.reason;
        return false;
      }
      let hpSnapshot = {};
      if (resolution === "apply-to-character") {
        const hp = draft.combat?.hp;
        const pools = applyDamagePools(
          Number(hp?.current),
          Number(hp?.temp ?? 0),
          preview.finalDamage,
        );
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
        profile: preview.effectProfile,
        damageBasis: preview.damageBasis,
        originalDamage: preview.originalDamage,
        calculatedDamage: preview.finalDamage,
        finalDamage: preview.finalDamage,
        evasionUsed: preview.evasionUsed,
        ruleExplanation: preview.ruleExplanation,
        outcomeAtApplication: preview.outcome,
        ...(hpSnapshot),
        resolvedAt: new Date().toISOString(),
      };
    } else {
      reason = "Нет нерешённого последствия, ожидающего урон.";
      return false;
    }
    resolved = structuredClone(record);
    trimRollHistory(draft);
    return draft;
  }, {
    operationId: options.operationId ?? null,
    metadata: { kind: "character-roll-consequence-resolved", rollId, resolution },
  });
  return result.status === "applied"
    ? { ...result, record: resolved }
    : { ...result, reason: reason ?? result.reason };
}
