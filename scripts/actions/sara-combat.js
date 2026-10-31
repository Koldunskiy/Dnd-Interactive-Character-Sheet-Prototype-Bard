import { getDerivedStats } from "../calculations.js";
import {
  calculateAttackDamage,
  calculateAttackPreview,
  calculateDeflectionPreview,
  parsePhysicalInteger
} from "../combat/sara-combat.js";
import { applyHealing } from "../combat/damage-pools.js";
import { getEffectiveSelectedTechniqueIds } from "../selectors/techniques.js";
import { isCurrentSession, updateSessionState } from "../state.js";
import { applyMonkTechnique } from "./monk.js";

const SAVE_ABILITIES = Object.freeze({
  "ll-monk:empowered-strike": "strength",
  "ll-monk:stunning-strike": "constitution",
  "ll-monk:crippling-strike": "constitution",
  "ll-monk:slowing-strike": "wisdom"
});

function isSara(character) {
  return character?.profile?.id === "sara-velaris";
}

function ensureCombatAssistant(character) {
  character.monk ??= {};
  character.monk.combatAssistant ??= {
    schemaVersion: 1,
    activeSequences: [],
    pendingApplications: [],
    recentlyCompletedSummaries: []
  };
  const assistant = character.monk.combatAssistant;
  assistant.schemaVersion = 1;
  assistant.activeSequences ??= [];
  assistant.pendingApplications ??= [];
  assistant.recentlyCompletedSummaries ??= [];
  return assistant;
}

function rememberSummary(assistant, record) {
  assistant.recentlyCompletedSummaries.push(record);
  assistant.recentlyCompletedSummaries = assistant.recentlyCompletedSummaries.slice(-20);
}

function createSequenceRecord(character, sequenceId, kind = "attack-action") {
  const derived = getDerivedStats(character);
  const maximumAttacks = kind === "attack-action"
    ? Number(character.profile.level) >= 5 ? 2 : 1
    : kind === "flurry" ? Number(character.profile.level) >= 17 ? 3 : 2 : 1;
  return {
    id: sequenceId,
    kind,
    turnMarker: Number(character.ui?.turn?.turnNumber ?? 1),
    status: "open",
    maximumAttacks,
    resolvedAttacks: [],
    resourcePaymentApplied: false,
    actionFlagApplied: false,
    creationStatsSnapshot: {
      level: derived.level,
      martialDieSides: derived.monk.martialDieSides,
      unarmed: derived.saraAttackProfiles.unarmed,
      returnedProjectile: derived.saraAttackProfiles.returnedProjectile
    }
  };
}

function reject(reason) {
  return { status: "rejected", reason };
}

function commit(context, operationId, metadata, updater, validate) {
  if (!operationId) return reject("Для операции требуется стабильный идентификатор.");
  if (!isCurrentSession(context)) return reject("stale-session");
  return updateSessionState(context, updater, { operationId, metadata, validate });
}

export function startAttackSequence(context, input, operationId) {
  const kind = input.kind ?? "attack-action";
  if (!["attack-action", "flurry", "bonus-unarmed", "reaction-unarmed", "returned-projectile"].includes(kind)) {
    return reject("Неизвестный вид последовательности атак.");
  }
  if (typeof input.sequenceId !== "string" || !input.sequenceId.trim()) {
    return reject("Последовательности требуется идентификатор.");
  }
  return commit(context, operationId, { kind: "sara-attack-sequence-start", sequenceKind: kind },
    (draft) => {
      if (!isSara(draft)) throw new Error("Последовательность доступна только в листе Сары.");
      const assistant = ensureCombatAssistant(draft);
      if (assistant.activeSequences.some((sequence) => sequence.status === "open")) {
        throw new Error("Сначала завершите или закройте текущую последовательность.");
      }
      const level = Number(draft.profile.level);
      const turn = draft.ui.turn;
      if (kind === "flurry" && input.confirmed !== true) {
        throw new Error("Подтвердите начало Шквала и расход 1 ци.");
      }
      if (kind === "attack-action" && turn.actionUsed && input.confirmSeparateAction !== true) {
        throw new Error("Действие уже отмечено. Подтвердите отдельное действие или исправьте отметку хода.");
      }
      if (["flurry", "bonus-unarmed"].includes(kind) && level < 2) {
        throw new Error("Бонусные безоружные атаки доступны со 2 уровня.");
      }
      if (["flurry", "bonus-unarmed"].includes(kind) && turn.bonusActionUsed) {
        throw new Error("Бонусное действие уже использовано в этом ходу.");
      }
      if (kind === "reaction-unarmed" && turn.reactionUsed) {
        throw new Error("Реакция уже использована в этом ходу.");
      }
      if (kind === "bonus-unarmed" && input.triggerConfirmed !== true) {
        throw new Error("Подтвердите условие бонусной атаки Боевых искусств.");
      }
      if (kind === "reaction-unarmed" && input.triggerConfirmed !== true) {
        throw new Error("Подтвердите условие ответного безоружного удара.");
      }
      let resourcePaymentApplied = false;
      let actionFlagApplied = false;
      if (kind === "flurry") {
        const ki = Number(draft.combat?.ki?.current);
        if (!Number.isInteger(ki) || ki < 1) throw new Error("Для Шквала требуется 1 ци.");
        draft.combat.ki.current = ki - 1;
        turn.bonusActionUsed = true;
        resourcePaymentApplied = true;
        actionFlagApplied = true;
      } else if (kind === "bonus-unarmed") {
        actionFlagApplied = false;
      } else if (kind === "reaction-unarmed") {
        actionFlagApplied = false;
      }
      const sequence = createSequenceRecord(draft, input.sequenceId, kind);
      sequence.resourcePaymentApplied = resourcePaymentApplied;
      sequence.actionFlagApplied = actionFlagApplied;
      assistant.activeSequences.push(sequence);
      return draft;
    },
    (current) => {
      if (!isSara(current)) return "Последовательность доступна только в листе Сары.";
      const activeSequences = current.monk?.combatAssistant?.activeSequences ?? [];
      if (activeSequences.some((sequence) =>
        sequence.id === input.sequenceId || sequence.status === "open")) {
        return "Последовательность уже существует или другая ещё открыта.";
      }
      return null;
    });
}

export function recordAttackOutcome(context, actionId, attackId, input, operationId) {
  if (!attackId) return reject("Удару требуется отдельный идентификатор.");
  return commit(context, operationId, { kind: "sara-attack-outcome", actionId, attackId },
    (draft) => {
      if (!isSara(draft)) throw new Error("Атака доступна только в листе Сары.");
      const assistant = ensureCombatAssistant(draft);
      let sequence = assistant.activeSequences.find((entry) =>
        entry.id === actionId && entry.status === "open");
      if (!sequence && assistant.activeSequences.some((entry) => entry.id === actionId)) {
        throw new Error("Идентификатор последовательности уже использован.");
      }
      if (!sequence && ["attack-action", "bonus-unarmed", "reaction-unarmed"].includes(input.kind) &&
          !assistant.activeSequences.some((entry) => entry.status === "open")) {
        if (input.kind === "bonus-unarmed" && input.triggerConfirmed !== true) {
          throw new Error("Подтвердите условие бонусной атаки Боевых искусств.");
        }
        if (input.kind === "bonus-unarmed" && draft.ui.turn.bonusActionUsed) {
          throw new Error("Бонусное действие уже использовано в этом ходу.");
        }
        if (input.kind === "reaction-unarmed" && input.triggerConfirmed !== true) {
          throw new Error("Подтвердите условие ответного безоружного удара.");
        }
        if (input.kind === "reaction-unarmed" && draft.ui.turn.reactionUsed) {
          throw new Error("Реакция уже использована в этом ходу.");
        }
        if (input.kind === "attack-action" && draft.ui.turn.actionUsed &&
            input.confirmSeparateAction !== true) {
          throw new Error("Действие уже отмечено. Подтвердите отдельное действие или исправьте отметку хода.");
        }
        sequence = createSequenceRecord(draft, actionId, input.kind);
        assistant.activeSequences.push(sequence);
      }
      if (!sequence) throw new Error("Последовательность атаки закрыта или недействительна.");
      if (sequence.resolvedAttacks.some((attack) => attack.id === attackId)) {
        throw new Error("Этот удар уже записан.");
      }
      if (sequence.resolvedAttacks.length >= sequence.maximumAttacks) {
        throw new Error("В этой последовательности уже записано максимальное число атак.");
      }
      const derived = getDerivedStats(draft);
      if (JSON.stringify(derived.saraAttackProfiles.unarmed) !==
            JSON.stringify(sequence.creationStatsSnapshot.unarmed) ||
          JSON.stringify(derived.saraAttackProfiles.returnedProjectile) !==
            JSON.stringify(sequence.creationStatsSnapshot.returnedProjectile) ||
          derived.level !== sequence.creationStatsSnapshot.level ||
          derived.monk.martialDieSides !== sequence.creationStatsSnapshot.martialDieSides) {
        throw new Error("Параметры персонажа изменились после начала последовательности. Закройте её и начните заново.");
      }
      const profileId = input.profileId ?? "unarmed";
      const previewInput = { ...input, profileId };
      let preview = calculateAttackPreview(draft, previewInput);
      if (!preview.ok) throw new Error(preview.reason);
      if (preview.hitResult == null) {
        if (preview.naturalMiss || preview.critical) {
          preview = {
            ...preview,
            hitResult: preview.critical,
            hitResolutionSource: "natural-rule"
          };
        } else {
          throw new Error("Укажите известную КД цели или вручную подтвердите попадание/промах.");
        }
      }
      const attack = {
        id: attackId,
        profileId,
        optionalTargetLabel: String(input.targetLabel ?? "").trim(),
        rawD20Rolls: preview.rawD20Rolls,
        rollMode: preview.rollMode,
        chosenD20: preview.chosenD20,
        attackBonusSnapshot: preview.attackBonusSnapshot,
        attackTotal: preview.attackTotal,
        hitResolutionSource: preview.hitResolutionSource,
        hitResult: preview.hitResult ? "hit" : "miss",
        critical: preview.critical,
        damageRolls: null,
        damageModifierSnapshot: null,
        damageTotalBeforeTargetModifiers: null,
        damageStatus: preview.hitResult ? "awaiting-damage" : "not-applicable",
        techniqueApplicationId: null
      };
      sequence.resolvedAttacks.push(attack);
      if (sequence.kind === "attack-action" && !sequence.actionFlagApplied) {
        draft.ui.turn.actionUsed = true;
        sequence.actionFlagApplied = true;
      } else if (sequence.kind === "bonus-unarmed" && !sequence.actionFlagApplied) {
        draft.ui.turn.bonusActionUsed = true;
        sequence.actionFlagApplied = true;
      } else if (sequence.kind === "reaction-unarmed" && !sequence.actionFlagApplied) {
        draft.ui.turn.reactionUsed = true;
        sequence.actionFlagApplied = true;
      }
      if (sequence.resolvedAttacks.length >= sequence.maximumAttacks) {
        sequence.status = "complete";
      }
      return draft;
    },
    (current) => {
      const sequences = current.monk?.combatAssistant?.activeSequences ?? [];
      const sequence = sequences.find((entry) => entry.id === actionId && entry.status === "open");
      const canStart = ["attack-action", "bonus-unarmed", "reaction-unarmed"].includes(input.kind) &&
        !sequences.some((entry) => entry.status === "open" || entry.id === actionId);
      if (!isSara(current) || (!sequence && !canStart)) return "Последовательность атаки закрыта или недействительна.";
      if (sequence && (sequence.resolvedAttacks.some((attack) => attack.id === attackId) ||
          sequence.resolvedAttacks.length >= sequence.maximumAttacks)) {
        return "Удар уже записан или достигнут предел атак.";
      }
      return null;
    });
}

export function closeAttackSequence(context, actionId, operationId) {
  return commit(context, operationId, { kind: "sara-attack-sequence-close", actionId },
    (draft) => {
      const sequence = draft.monk?.combatAssistant?.activeSequences?.find((entry) =>
        entry.id === actionId && entry.status === "open");
      if (!isSara(draft) || !sequence) throw new Error("Нет открытой последовательности для закрытия.");
      sequence.status = sequence.resolvedAttacks.length ? "abandoned" : "closed";
      return draft;
    },
    (current) => current.monk?.combatAssistant?.activeSequences?.some((entry) =>
      entry.id === actionId && entry.status === "open")
      ? null
      : "Нет открытой последовательности для закрытия.");
}

export function recordAttackDamage(context, actionId, attackId, rolls, operationId) {
  return commit(context, operationId, { kind: "sara-attack-damage", actionId, attackId },
    (draft) => {
      const sequence = draft.monk?.combatAssistant?.activeSequences?.find((entry) => entry.id === actionId);
      const attack = sequence?.resolvedAttacks?.find((entry) => entry.id === attackId);
      if (!isSara(draft) || !attack || attack.hitResult !== "hit") {
        throw new Error("Урон можно записать только для подтверждённого попадания.");
      }
      if (attack.damageStatus !== "awaiting-damage") throw new Error("Урон этого удара уже записан или закрыт.");
      const profile = getDerivedStats(draft).saraAttackProfiles[attack.profileId];
      const damage = calculateAttackDamage(profile, rolls, attack.critical);
      if (!damage.ok) throw new Error(damage.reason);
      attack.damageRolls = damage.damageRolls;
      attack.damageModifierSnapshot = damage.damageModifierSnapshot;
      attack.damageTotalBeforeTargetModifiers = damage.damageTotalBeforeTargetModifiers;
      attack.damageStatus = "recorded";
      return draft;
    },
    (current) => {
      const attack = current.monk?.combatAssistant?.activeSequences?.find((entry) =>
        entry.id === actionId)?.resolvedAttacks?.find((entry) => entry.id === attackId);
      if (!attack || attack.hitResult !== "hit" || attack.damageStatus !== "awaiting-damage") {
        return "Урон можно записать только один раз для попадания, ожидающего урон.";
      }
      return null;
    });
}

export function markAttackDamageOutside(context, actionId, attackId, operationId) {
  return commit(context, operationId, { kind: "sara-attack-damage-outside", actionId, attackId },
    (draft) => {
      const attack = draft.monk?.combatAssistant?.activeSequences?.find((entry) =>
        entry.id === actionId)?.resolvedAttacks?.find((entry) => entry.id === attackId);
      if (!attack || attack.hitResult !== "hit" || attack.damageStatus !== "awaiting-damage") {
        throw new Error("Нет попадания, ожидающего отметки об учёте урона вне приложения.");
      }
      attack.damageStatus = "recorded-outside-app";
      return draft;
    },
    (current) => {
      const attack = current.monk?.combatAssistant?.activeSequences?.find((entry) =>
        entry.id === actionId)?.resolvedAttacks?.find((entry) => entry.id === attackId);
      return attack?.hitResult === "hit" && attack.damageStatus === "awaiting-damage"
        ? null
        : "Нет попадания, ожидающего отметки об учёте урона вне приложения.";
    });
}

export function applyTechniqueToHit(context, actionId, attackId, techniqueId, input, operationId) {
  let applicationId = null;
  let techniqueOutcome = null;
  return commit(context, operationId, { kind: "sara-technique-hit", actionId, attackId, techniqueId },
    (draft) => {
      const assistant = ensureCombatAssistant(draft);
      const sequence = assistant.activeSequences.find((entry) => entry.id === actionId);
      const attack = sequence?.resolvedAttacks?.find((entry) => entry.id === attackId);
      if (!isSara(draft) || !attack || attack.hitResult !== "hit" ||
          attack.profileId !== "unarmed" || attack.techniqueApplicationId) {
        throw new Error("Техника удара требует подтверждённое безоружное попадание без уже применённой техники.");
      }
      if (!getEffectiveSelectedTechniqueIds(draft).has(techniqueId)) {
        throw new Error("Техника не выбрана или сейчас недоступна.");
      }
      const kiBefore = Number(draft.combat?.ki?.current);
      const practicedBefore = Number(draft.combat?.practiced?.current);
      const result = applyMonkTechnique(draft, techniqueId, {
        ...input,
        confirmed: true,
        unarmedHitConfirmed: true
      });
      if (!result.ok) throw new Error(result.reason);
      applicationId = input.applicationId ?? operationId;
      const saveAbility = SAVE_ABILITIES[techniqueId] ?? null;
      const application = {
        id: applicationId,
        parentAttackId: attackId,
        techniqueId,
        paymentKind: input.paymentMode === "practiced" ? "practiced" : "ki",
        paymentAmount: input.paymentMode === "practiced"
          ? practicedBefore - Number(draft.combat?.practiced?.current)
          : kiBefore - Number(draft.combat?.ki?.current),
        dc: getDerivedStats(draft).monk.techniqueSaveDc,
        saveAbility,
        selectedEffect: input.effect ?? null,
        criticalDisadvantageReminder: attack.critical && attack.profileId === "unarmed"
          ? "Спасбросок, вызванный этой критической атакой, совершается с помехой."
          : null,
        targetOutcome: "unknown",
        manualTimingNote: techniqueId === "ll-monk:slowing-strike"
          ? "Повторный спасбросок Мудрости в конце хода цели зависит от решения мастера."
          : null
      };
      assistant.pendingApplications.push(application);
      attack.techniqueApplicationId = applicationId;
      techniqueOutcome = result.result;
      return draft;
    },
    (current) => {
      const sequence = current.monk?.combatAssistant?.activeSequences?.find((entry) => entry.id === actionId);
      const attack = sequence?.resolvedAttacks?.find((entry) => entry.id === attackId);
      return isSara(current) && attack?.hitResult === "hit" &&
        attack.profileId === "unarmed" && !attack.techniqueApplicationId &&
        getEffectiveSelectedTechniqueIds(current).has(techniqueId)
        ? null
        : "Техника удара требует актуальное подтверждённое безоружное попадание.";
    });
}

export function recordTargetSaveOutcome(context, applicationId, outcome, operationId) {
  if (!["success", "failure", "unknown"].includes(outcome)) {
    return reject("Неизвестный результат спасброска цели.");
  }
  return commit(context, operationId, { kind: "sara-target-save-outcome", applicationId },
    (draft) => {
      const application = draft.monk?.combatAssistant?.pendingApplications?.find((entry) =>
        entry.id === applicationId);
      if (!isSara(draft) || !application) throw new Error("Не найдено применённое ожидание спасброска цели.");
      application.targetOutcome = outcome;
      return draft;
    },
    (current) => current.monk?.combatAssistant?.pendingApplications?.some((entry) =>
      entry.id === applicationId)
      ? null
      : "Не найдено применённое ожидание спасброска цели.");
}

export function commitRegeneration(context, dieResult, operationId, { confirmNoHealing = false } = {}) {
  let outcome;
  const result = commit(context, operationId, { kind: "sara-regeneration" },
    (draft) => {
      if (!isSara(draft)) throw new Error("Лечение доступно только в листе Сары.");
      const preview = calculateRegenerationPreviewForState(draft, dieResult);
      if (!preview.ok) throw new Error(preview.reason);
      if (preview.usefulHealing === 0 && !confirmNoHealing) {
        throw new Error("Полезного лечения нет; подтвердите явное применение или отмените форму.");
      }
      const applied = applyMonkTechnique(draft, "ll-monk:mystic-regeneration", {
        confirmed: true,
        dieResult,
        confirmNoHealing
      });
      if (!applied.ok) throw new Error(applied.reason);
      outcome = { ...preview, persistenceApplied: true };
      const assistant = ensureCombatAssistant(draft);
      if (assistant.recentlyCompletedSummaries.some((entry) => entry.id === operationId)) {
        throw new Error("Эта мистическая регенерация уже применена.");
      }
      rememberSummary(assistant, { id: operationId, kind: "regeneration", ...outcome });
      return draft;
    },
    (current) => {
      const preview = calculateRegenerationPreviewForState(current, dieResult);
      if (!preview.ok) return preview.reason;
      if (preview.kiBefore < 2) return "Недостаточно ци для мистической регенерации.";
      return preview.usefulHealing === 0 && !confirmNoHealing
        ? "Полезного лечения нет; подтвердите явное применение или отмените форму."
        : null;
    });
  return result.status === "applied" ? { ...result, outcome } : result;
}

function calculateRegenerationPreviewForState(character, dieResult) {
  const derived = getDerivedStats(character);
  const roll = parsePhysicalInteger(dieResult, 1, derived.monk.martialDieSides, "Результат кости Боевых искусств");
  if (!roll.ok) return roll;
  const amount = Math.max(0, roll.value + derived.abilityModifiers.wisdom);
  const healed = applyHealing(derived.currentHitPoints, derived.maxHitPoints, amount);
  if (!healed.ok) return healed;
  return {
    ok: true,
    dieResult: roll.value,
    calculatedHealing: amount,
    usefulHealing: healed.healing,
    hpBefore: healed.hpBefore,
    hpAfter: healed.hpAfter,
    kiBefore: Number(character.combat?.ki?.current),
    kiAfter: Number(character.combat?.ki?.current) - 2
  };
}

export function commitDeflection(context, input, operationId) {
  let outcome;
  const techniqueId = input.kind === "missile"
    ? "ll-monk:deflect-missile"
    : "ll-monk:deflect-strike";
  const result = commit(context, operationId, { kind: "sara-deflection", techniqueId },
    (draft) => {
      const preview = calculateDeflectionPreview(draft, input);
      if (!preview.ok) throw new Error(preview.reason);
      const applied = applyMonkTechnique(draft, techniqueId, {
        ...input,
        operationId,
        sessionGeneration: context.sessionGeneration,
        confirmed: true,
        applyDamageToSara: input.applyDamageToSara === true,
        mode: input.mode
      });
      if (!applied.ok) throw new Error(applied.reason);
      outcome = { ...preview, techniqueResult: applied.result };
      const assistant = ensureCombatAssistant(draft);
      if (assistant.recentlyCompletedSummaries.some((entry) => entry.id === operationId)) {
        throw new Error("Это отражение уже применено.");
      }
      rememberSummary(assistant, {
        id: operationId,
        kind: "deflection",
        techniqueId,
        incomingDamage: preview.incomingDamage,
        deflectRoll: preview.deflectRoll,
        rawRemainder: preview.rawRemainder,
        finalRemainder: preview.finalRemainder
      });
      return draft;
    },
    (current) => {
      const preview = calculateDeflectionPreview(current, input);
      if (!preview.ok) return preview.reason;
      if (!getEffectiveSelectedTechniqueIds(current).has(techniqueId)) {
        return "Техника отражения не выбрана или сейчас недоступна.";
      }
      return null;
    });
  return result.status === "applied" ? { ...result, outcome } : result;
}
