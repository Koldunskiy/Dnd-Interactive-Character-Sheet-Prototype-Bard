import { getDerivedStats } from "../calculations.js";
import {
  calculateAttackDamage,
  calculateAttackPreview,
  calculateAttackPreviewFromSnapshot,
  calculateDeflectionPreview,
  parsePhysicalInteger
} from "../combat/sara-combat.js";
import { applyHealing } from "../combat/damage-pools.js";
import { getEffectiveSelectedTechniqueIds } from "../selectors/techniques.js";
import { MONK_TECHNIQUE_BY_ID } from "../../data/monk-techniques.js";
import { getState, isCurrentSession, updateSessionState } from "../state.js";
import { applyMonkTechnique } from "./monk.js";
import { closeRestWindow, spendBoundDart } from "../sara-functional.js";
import { isAttackProfileEligible } from "../combat/attack-profile-eligibility.js";
import { gentlingPreview } from "../sara-functional.js";
import { integer } from "../sara-functional.js";
import {
  pendingSeeking,
  readSeekingHistory,
  writeSeekingHistory,
} from "../combat/seeking-history.js";

const SAVE_ABILITIES = Object.freeze({
  "ll-monk:empowered-strike": "strength",
  "ll-monk:stunning-strike": "constitution",
  "ll-monk:crippling-strike": "constitution",
  "ll-monk:slowing-strike": "wisdom"
});
const MAX_UNRESOLVED_COMBAT_TASKS = 20;
const MAX_RECENT_COMBAT_SEQUENCES = 30;

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

function countUnresolvedCombatTasks(assistant) {
  const pendingSaves = assistant.pendingApplications.filter((entry) =>
    !["success", "failure"].includes(entry.targetOutcome)).length;
  const pendingDamage = assistant.activeSequences.reduce((count, sequence) =>
    count + (sequence.resolvedAttacks ?? []).filter((attack) => {
      try {
      return attack.damageStatus === "awaiting-damage" ||
        Boolean((attack.seekingAmendments !== undefined ||
          attack.seekingAmendment != null) && pendingSeeking(readSeekingHistory(attack, {
          actionId: sequence.id, attackId: attack.id,
        })));
      } catch {
      return attack.seekingAmendments !== undefined ||
        attack.seekingAmendment != null;
      }
    }).length, 0);
  return pendingSaves + pendingDamage;
}

function pruneCombatHistory(assistant) {
  const unresolvedApplicationIds = new Set(assistant.pendingApplications
    .filter((entry) => !["success", "failure"].includes(entry.targetOutcome))
    .map((entry) => entry.parentAttackId));
  const unresolvedSequences = [];
  const completedSequences = [];
  for (const sequence of assistant.activeSequences) {
    const unresolved = sequence.status === "open" ||
      sequence.resolvedAttacks?.some((attack) => {
        try {
          return attack.damageStatus === "awaiting-damage" ||
            unresolvedApplicationIds.has(attack.id) ||
            Boolean((attack.seekingAmendments !== undefined ||
              attack.seekingAmendment != null) && pendingSeeking(readSeekingHistory(attack, {
              actionId: sequence.id, attackId: attack.id,
            })));
        } catch {
          return attack.seekingAmendments !== undefined ||
            attack.seekingAmendment != null;
        }
      });
    (unresolved ? unresolvedSequences : completedSequences).push(sequence);
  }
  assistant.activeSequences = [
    ...completedSequences.slice(-MAX_RECENT_COMBAT_SEQUENCES),
    ...unresolvedSequences,
  ];
  const unresolvedApplications = assistant.pendingApplications.filter((entry) =>
    !["success", "failure"].includes(entry.targetOutcome));
  const completedApplications = assistant.pendingApplications.filter((entry) =>
    ["success", "failure"].includes(entry.targetOutcome)).slice(-MAX_RECENT_COMBAT_SEQUENCES);
  assistant.pendingApplications = [...completedApplications, ...unresolvedApplications];
}

function createSequenceRecord(character, sequenceId, kind = "attack-action", input = {}) {
  const derived = getDerivedStats(character);
  const battle = character.battleConsole?.current;
  const maximumAttacks = getSaraAttackCount(character, kind);
  return {
    id: sequenceId,
    kind,
    parentId: input.parentId ?? null,
    parentFeature: input.parentFeature ?? null,
    turnMarker: Number(character.ui?.turn?.turnNumber ?? 1),
    battleId: battle?.id ?? null,
    ownTurnId: battle?.phase === "own-turn" ? battle.ownTurnId : null,
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

function validateBattleActionPhase(character, kind) {
  const battle = character.battleConsole?.current;
  if (!battle || battle.phase === "ended") return null;
  if (kind === "reaction-unarmed" || kind === "returned-projectile") {
    return ["waiting", "own-turn"].includes(battle.phase)
      ? null
      : "В приостановленной сцене нельзя выполнять реакцию.";
  }
  return battle.phase === "own-turn"
    ? null
    : "Эту боевую атаку можно начать только в свой ход.";
}

function seekingParentWindowIsCurrent(character, sequence) {
  if (!sequence || !["open", "complete"].includes(sequence.status) ||
      Number(sequence.turnMarker) !== Number(character.ui?.turn?.turnNumber ?? 1)) return false;
  const battle = character.battleConsole?.current;
  const reaction = ["reaction-unarmed", "returned-projectile"].includes(sequence.kind);
  if (reaction) {
    return sequence.kind === "reaction-unarmed" && Boolean(battle) &&
      ["waiting", "own-turn"].includes(battle.phase) && battle.id === sequence.battleId &&
      (!sequence.ownTurnId || sequence.ownTurnId === battle.ownTurnId) &&
      character.ui?.turn?.reactionUsed === true;
  }
  if (!["attack-action", "flurry", "bonus-unarmed"].includes(sequence.kind)) return false;
  if (!battle) return !sequence.battleId;
  return battle.phase === "own-turn" && battle.id === sequence.battleId &&
    (!sequence.ownTurnId || sequence.ownTurnId === battle.ownTurnId);
}

function reject(reason) {
  return { status: "rejected", reason };
}

function mayRunAlongside(kind, existingKind) {
  const bonusKinds = new Set(["flurry", "bonus-unarmed"]);
  return kind === "attack-action" && bonusKinds.has(existingKind) ||
    existingKind === "attack-action" && bonusKinds.has(kind);
}

export function getUsedAttackSlots(sequence) {
  return (sequence?.resolvedAttacks?.length ?? 0) +
    (sequence?.replacementResults?.length ?? 0);
}

export function getSaraAttackCount(character, kind = "attack-action") {
  const level = Number(character?.profile?.level ?? 1);
  if (kind === "attack-action") return level >= 5 ? 2 : 1;
  if (kind === "flurry") return level >= 17 ? 3 : 2;
  return 1;
}

function commit(context, operationId, metadata, updater, validate) {
  if (!operationId) return reject("Для операции требуется стабильный идентификатор.");
  if (!isCurrentSession(context)) return reject("stale-session");
  return updateSessionState(context, updater, { operationId, metadata, validate });
}

export function startAttackSequence(context, input, operationId) {
  const kind = input.kind ?? "attack-action";
  if (kind === "returned-projectile") {
    return reject("Возвращённый снаряд применяется одной атомарной записью физической атаки.");
  }
  if (!["attack-action", "flurry", "bonus-unarmed", "reaction-unarmed"].includes(kind)) {
    return reject("Неизвестный вид последовательности атак.");
  }
  if (typeof input.sequenceId !== "string" || !input.sequenceId.trim()) {
    return reject("Последовательности требуется идентификатор.");
  }
  return commit(context, operationId, { kind: "sara-attack-sequence-start", sequenceKind: kind },
    (draft) => {
      if (!isSara(draft)) throw new Error("Последовательность доступна только в листе Сары.");
      const phaseReason = validateBattleActionPhase(draft, kind);
      if (phaseReason) throw new Error(phaseReason);
      const assistant = ensureCombatAssistant(draft);
      if (assistant.activeSequences.some((sequence) =>
        sequence.status === "open" && !mayRunAlongside(kind, sequence.kind))) {
        throw new Error("Сначала завершите или закройте текущую последовательность.");
      }
      pruneCombatHistory(assistant);
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
      if (input.parentFeature === "ebb-and-flow" && level < 6) {
        throw new Error("Прилив и отлив доступен с 6 уровня.");
      }
      if (["flurry", "bonus-unarmed"].includes(kind) && turn.bonusActionUsed) {
        throw new Error("Бонусное действие уже использовано в этом ходу.");
      }
      if (kind === "reaction-unarmed" && turn.reactionUsed &&
          input.parentFeature !== "deflect-counter") {
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
      const sequence = createSequenceRecord(draft, input.sequenceId, kind, input);
      if (kind === "bonus-unarmed") {
        turn.bonusActionUsed = true;
        sequence.actionFlagApplied = true;
      } else if (kind === "reaction-unarmed") {
        turn.reactionUsed = true;
        sequence.actionFlagApplied = true;
      }
      sequence.resourcePaymentApplied = resourcePaymentApplied;
      sequence.actionFlagApplied ||= actionFlagApplied;
      if (sequence.resourcePaymentApplied || sequence.actionFlagApplied) {
        closeRestWindow(draft, "paid-or-budgeted-sequence-started");
      }
      assistant.activeSequences.push(sequence);
      return draft;
    },
    (current) => {
      if (!isSara(current)) return "Последовательность доступна только в листе Сары.";
      const phaseReason = validateBattleActionPhase(current, kind);
      if (phaseReason) return phaseReason;
      if (input.parentFeature === "ebb-and-flow" && Number(current.profile?.level) < 6) {
        return "Прилив и отлив доступен с 6 уровня.";
      }
      const activeSequences = current.monk?.combatAssistant?.activeSequences ?? [];
      if (activeSequences.some((sequence) =>
        sequence.id === input.sequenceId ||
        sequence.status === "open" && !mayRunAlongside(kind, sequence.kind))) {
        return "Последовательность уже существует или другая ещё открыта.";
      }
      if (kind === "reaction-unarmed" && current.ui?.turn?.reactionUsed &&
          input.parentFeature !== "deflect-counter") {
        return "Реакция уже использована в этом ходу.";
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
      const phaseReason = validateBattleActionPhase(draft, sequence?.kind ?? input.kind ?? "attack-action");
      if (phaseReason) throw new Error(phaseReason);
      if (!sequence && assistant.activeSequences.some((entry) => entry.id === actionId)) {
        throw new Error("Идентификатор последовательности уже использован.");
      }
      if (!sequence && ["attack-action", "bonus-unarmed", "reaction-unarmed", "returned-projectile"].includes(input.kind) &&
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
        sequence = createSequenceRecord(draft, actionId, input.kind, input);
        if (input.kind === "returned-projectile") {
          sequence.returnContinuationId = input.parentId;
          sequence.returnProficiencyConfirmed = input.proficiencyConfirmed === true;
        }
        assistant.activeSequences.push(sequence);
      }
      if (!sequence) throw new Error("Последовательность атаки закрыта или недействительна.");
      if (sequence.resolvedAttacks.some((attack) => attack.id === attackId)) {
        throw new Error("Этот удар уже записан.");
      }
      if (getUsedAttackSlots(sequence) >= sequence.maximumAttacks) {
        throw new Error("В этой последовательности уже записано максимальное число атак.");
      }
      let returnToken = null;
      if (sequence.kind === "returned-projectile") {
        returnToken = draft.monk?.techniqueRuntime?.deflectContinuation;
        if (typeof input.parentId !== "string" || !input.parentId.trim() ||
            sequence.parentId !== input.parentId ||
            sequence.returnContinuationId !== input.parentId ||
            returnToken?.id !== input.parentId || returnToken.kind !== "missile-return" ||
            returnToken.sourceSessionGeneration !== context.sessionGeneration ||
            returnToken.reactionAlreadyUsed !== true || returnToken.consumed === true ||
            returnToken.reservedBySequence || input.proficiencyConfirmed !== true) {
          throw new Error("Нет действительного токена продолжения возвращённого снаряда.");
        }
        const battle = draft.battleConsole?.current;
        if (returnToken.battleId && (battle?.id !== returnToken.battleId ||
            !["waiting", "own-turn"].includes(battle.phase) ||
            returnToken.ownTurnId && returnToken.ownTurnId !== battle.ownTurnId)) {
          throw new Error("Токен продолжения возвращённого снаряда устарел для этого боя.");
        }
      }
      const derived = getDerivedStats(draft);
      const profileId = input.profileId ?? "unarmed";
      if (!isAttackProfileEligible(sequence.kind, profileId,
        derived.saraAttackProfiles, draft)) {
        throw new Error("Этот профиль атаки недопустим для текущей последовательности.");
      }
      if (sequence.kind === "returned-projectile") {
        const currentKi = Number(draft.combat?.ki?.current);
        if (!Number.isInteger(currentKi) || currentKi < 1) {
          throw new Error("Для возвращения снаряда требуется 1 ци.");
        }
        draft.combat.ki.current = currentKi - 1;
        returnToken.consumed = true;
        sequence.resourcePaymentApplied = true;
      }
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
        if (preview.hitResult && countUnresolvedCombatTasks(assistant) >= MAX_UNRESOLVED_COMBAT_TASKS) {
          throw new Error("Достигнут предел 20 нерешённых задач боя; закройте или отметьте одну из них.");
        }
      }
      const attack = {
        id: attackId,
        profileId,
        profileSnapshot: structuredClone(preview.profile),
        optionalTargetLabel: String(input.targetLabel ?? "").trim(),
        rawD20Rolls: preview.rawD20Rolls,
        rollMode: preview.rollMode,
        chosenD20: preview.chosenD20,
        attackBonusSnapshot: preview.attackBonusSnapshot,
        targetArmorClass: input.targetArmorClass == null ||
          String(input.targetArmorClass).trim() === "" ? null : Number(input.targetArmorClass),
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
      const dartId = draft.inventory?.starterManifest?.bindings?.darts;
      if (profileId === dartId) {
        if (preview.profile.attackKind !== "weapon" ||
            !preview.profile.properties?.includes("thrown")) {
          throw new Error("Привязанный профиль дротика не является метательным оружием.");
        }

        attack.ammunitionSpend = {
          itemId: dartId,
          quantityAfter: spendBoundDart(draft, dartId),
        };
      }
      closeRestWindow(draft, "recorded-attack");
      sequence.resolvedAttacks.push(attack);
      attack.slotNumber = getUsedAttackSlots(sequence);
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
      if (getUsedAttackSlots(sequence) >= sequence.maximumAttacks) {
        sequence.status = "complete";
      }
      return draft;
    },
    (current) => {
      const sequences = current.monk?.combatAssistant?.activeSequences ?? [];
      const sequence = sequences.find((entry) => entry.id === actionId && entry.status === "open");
      const phaseReason = validateBattleActionPhase(current, sequence?.kind ?? input.kind ?? "attack-action");
      if (phaseReason) return phaseReason;
      const canStart = ["attack-action", "bonus-unarmed", "reaction-unarmed", "returned-projectile"].includes(input.kind) &&
        !sequences.some((entry) => entry.id === actionId ||
          entry.status === "open" && !mayRunAlongside(input.kind, entry.kind));
      if (!isSara(current) || (!sequence && !canStart)) return "Последовательность атаки закрыта или недействительна.";
      if (sequence && (sequence.resolvedAttacks.some((attack) => attack.id === attackId) ||
          getUsedAttackSlots(sequence) >= sequence.maximumAttacks)) {
        return "Удар уже записан или достигнут предел атак.";
      }
      return null;
    });
}

export function beginSeekingStrike(context, actionId, attackId, operationId) {
  if (!operationId) return reject("Для операции требуется стабильный идентификатор.");
  if (!isCurrentSession(context)) return reject("stale-session");
  const state = getState();
  const candidates = new Map();
  for (const sequence of state.monk?.combatAssistant?.activeSequences ?? []) {
    for (const attack of sequence.resolvedAttacks ?? []) {
      const entries = [
        ...(Array.isArray(attack.seekingAmendments)
          ? attack.seekingAmendments : []),
        ...(attack.seekingAmendment ? [attack.seekingAmendment] : []),
      ];
      if (entries.some((entry) =>
        entry?.paidOperationId === operationId || entry?.id === operationId)) {
        candidates.set(`${sequence.id}:${attack.id}`, {
          sequenceId: sequence.id,
          attackId: attack.id,
        });
      }
    }
  }
  candidates.set(`${actionId}:${attackId}`, { sequenceId: actionId, attackId });
  const matchingEntries = [];
  for (const candidate of candidates.values()) {
    const candidateAttack = state.monk?.combatAssistant?.activeSequences
      ?.find((sequence) => sequence.id === candidate.sequenceId)
      ?.resolvedAttacks?.find((attack) => attack.id === candidate.attackId);
    try {
      const history = candidateAttack
        ? readSeekingHistory(candidateAttack, {
          actionId: candidate.sequenceId,
          attackId: candidate.attackId,
        })
        : [];
      matchingEntries.push(...history.filter((entry) =>
        entry.paidOperationId === operationId));
    } catch (error) {
      return reject(`История Seeking Strike противоречива; применение заблокировано. ${error.message}`);
    }
  }
  if (matchingEntries.length > 1) {
    return reject("Конфликт Seeking Strike: несколько записей используют один идентификатор.");
  }
  const oldInvocation = matchingEntries[0] ?? null;
  if (oldInvocation) {
    return oldInvocation.parent?.actionId === actionId && oldInvocation.parent?.attackId === attackId
      ? { status: "applied", replayed: true, result: structuredClone(oldInvocation) }
      : reject("Идентификатор Seeking Strike уже использован для другого родителя.");
  }
  return commit(context, operationId, {
    kind: "sara-seeking-strike-begin", actionId, attackId, paidKi: 1,
  }, (draft) => {
    const sequence = draft.monk?.combatAssistant?.activeSequences?.find((entry) => entry.id === actionId);
    const attack = sequence?.resolvedAttacks?.find((entry) => entry.id === attackId);
    const history = attack
      ? readSeekingHistory(attack, { actionId, attackId })
      : [];
    if (!isSara(draft) || !sequence || !attack || attack.hitResult !== "miss" ||
        !seekingParentWindowIsCurrent(draft, sequence) ||
        !(attack.profileId === "unarmed" || attack.profileSnapshot?.martialArtsEligible === true) ||
        !attack.profileSnapshot || !Number.isFinite(Number(attack.attackBonusSnapshot)) ||
        pendingSeeking(history) ||
        !getEffectiveSelectedTechniqueIds(draft).has("ll-monk:seeking-strike")) {
      throw new Error("Seeking Strike требует текущий допустимый записанный промах Martial Arts.");
    }
    const ki = Number(draft.combat?.ki?.current);
    if (!Number.isInteger(ki) || ki < 1) throw new Error("Для Seeking Strike требуется 1 ци.");
    draft.combat.ki.current = ki - 1;
    history.push({
      id: operationId,
      paidOperationId: operationId,
      parent: { actionId, attackId },
      status: "awaiting-replacement",
      kiPaid: 1,
      original: {
        rawD20Rolls: structuredClone(attack.rawD20Rolls),
        rollMode: attack.rollMode,
        chosenD20: attack.chosenD20,
        attackTotal: attack.attackTotal,
        hitResult: attack.hitResult,
        critical: attack.critical,
      },
    });
    writeSeekingHistory(attack, history, { actionId, attackId });
    closeRestWindow(draft, "seeking-strike-paid");
    return draft;
  }, (current) => {
    const sequence = current.monk?.combatAssistant?.activeSequences?.find((entry) => entry.id === actionId);
    const attack = sequence?.resolvedAttacks?.find((entry) => entry.id === attackId);
    const history = attack
      ? readSeekingHistory(attack, { actionId, attackId })
      : [];
    return isSara(current) && attack?.hitResult === "miss" &&
      seekingParentWindowIsCurrent(current, sequence) &&
      (attack.profileId === "unarmed" || attack.profileSnapshot?.martialArtsEligible === true) &&
      !pendingSeeking(history) &&
      getEffectiveSelectedTechniqueIds(current).has("ll-monk:seeking-strike")
      ? null : "Нет допустимого текущего промаха для Seeking Strike.";
  });
}

export function resolveSeekingStrike(context, actionId, attackId, input, operationId) {
  return commit(context, operationId, { kind: "sara-seeking-strike-result", actionId, attackId },
    (draft) => {
      const sequence = draft.monk?.combatAssistant?.activeSequences?.find((entry) => entry.id === actionId);
      const attack = sequence?.resolvedAttacks?.find((entry) => entry.id === attackId);
      const history = attack
        ? readSeekingHistory(attack, { actionId, attackId })
        : [];
      const index = history.findIndex((entry) =>
        entry.paidOperationId === input.amendmentId);
      const pending = index >= 0 ? history[index] : null;
      if (!pending || pending.status !== "awaiting-replacement" || attack.hitResult !== "miss") {
        throw new Error("Нет оплаченного Seeking Strike, ожидающего нового физического результата.");
      }
      const targetArmorClass = input.targetArmorClass == null ||
        String(input.targetArmorClass).trim() === ""
        ? null : input.targetArmorClass;
      const preview = calculateAttackPreviewFromSnapshot(draft, {
        profileId: attack.profileId,
        rollMode: input.rollMode ?? attack.rollMode,
        firstD20: input.firstD20,
        secondD20: input.secondD20,
        targetArmorClass,
        dmHitResult: input.dmHitResult,
      }, attack.profileSnapshot, attack.attackBonusSnapshot);
      if (!preview.ok) throw new Error(preview.reason);
      if (preview.hitResult == null) throw new Error("Для переброса укажите КД либо явное попадание/промах.");
      const replacement = {
        rawD20Rolls: structuredClone(preview.rawD20Rolls),
        rollMode: preview.rollMode,
        chosenD20: preview.chosenD20,
        attackTotal: preview.attackTotal,
        attackBonusSnapshot: preview.attackBonusSnapshot,
        hitResult: preview.hitResult ? "hit" : "miss",
        critical: preview.critical,
        hitResolutionSource: preview.hitResolutionSource,
      };
      const resolutionRequest = {
        amendmentId: input.amendmentId,
        rollMode: preview.rollMode,
        firstD20: preview.rawD20Rolls[0],
        secondD20: preview.rawD20Rolls.length > 1 ? preview.rawD20Rolls[1] : null,
        targetArmorClass: targetArmorClass == null ? null : Number(targetArmorClass),
        dmHitResult: input.dmHitResult || null,
      };
      history[index] = {
        ...pending,
        replacement,
        resolutionOperationId: operationId,
        resolutionRequest,
        status: "resolved",
      };
      writeSeekingHistory(attack, history, { actionId, attackId });
      attack.rawD20Rolls = structuredClone(preview.rawD20Rolls);
      attack.rollMode = preview.rollMode;
      attack.chosenD20 = preview.chosenD20;
      attack.attackTotal = preview.attackTotal;
      attack.attackBonusSnapshot = preview.attackBonusSnapshot;
      attack.hitResolutionSource = preview.hitResolutionSource;
      attack.hitResult = replacement.hitResult;
      attack.critical = preview.critical;
      attack.damageStatus = preview.hitResult ? "awaiting-damage" : "not-applicable";
      attack.damageRolls = null;
      attack.damageTotalBeforeTargetModifiers = null;
      attack.techniqueApplicationId = null;
      attack.historicalResolution = !seekingParentWindowIsCurrent(draft, sequence);
      return draft;
    }, (current) => {
      const attack = current.monk?.combatAssistant?.activeSequences?.find((entry) =>
        entry.id === actionId)?.resolvedAttacks?.find((entry) => entry.id === attackId);
      const history = attack
        ? readSeekingHistory(attack, { actionId, attackId })
        : [];
      return pendingSeeking(history)?.paidOperationId === input.amendmentId
        ? null : "Нет оплаченного Seeking Strike, ожидающего результата.";
    });
}

export function applyGentlingTouchToAttackSlot(context, actionId, input, operationId) {
          if (!operationId) return reject("Для операции требуется стабильный идентификатор.");
          if (!isCurrentSession(context)) return reject("stale-session");
          let request;
          try {
            request = {
              extraKi: integer(input?.extraKi, 0),
              targetHp: integer(input?.targetHp, 0),
              sum: integer(input?.sum, 1),
            };
          } catch {
            return reject("Gentling Touch требует целые значения ци, HP цели и физической суммы.");
          }
          const previousSequence = (getState().monk?.combatAssistant?.activeSequences ?? [])
            .find((entry) => entry.replacementResults?.some((result) =>
              result.operationId === operationId));
          const previous = previousSequence?.replacementResults?.find((entry) =>
            entry.operationId === operationId);
          if (previous) {
            const recorded = previous.request;
            if (previousSequence.id !== actionId || !recorded ||
                recorded.extraKi !== request.extraKi ||
                recorded.targetHp !== request.targetHp || recorded.sum !== request.sum) {
              return reject("Идентификатор Gentling Touch уже использован с другими данными.");
            }
            return { status: "applied", replayed: true, result: structuredClone(previous) };
          }
          return commit(context, operationId, { kind: "sara-gentling-touch-slot", actionId, request },
          (draft) => {
            const sequence = draft.monk?.combatAssistant?.activeSequences?.find((entry) =>
              entry.id === actionId);
            const battle = draft.battleConsole?.current;
            const validTurn = battle
              ? battle.phase === "own-turn" && sequence?.battleId === battle.id &&
                sequence?.ownTurnId === battle.ownTurnId
              : !sequence?.battleId;
            if (!isSara(draft) || sequence?.kind !== "attack-action" ||
                sequence.status !== "open" ||
                !validTurn ||
                Number(sequence.turnMarker) !== Number(draft.ui?.turn?.turnNumber ?? 1) ||
                getUsedAttackSlots(sequence) >= sequence.maximumAttacks ||
                !getEffectiveSelectedTechniqueIds(draft).has("ll-monk:gentling-touch")) {
              throw new Error("Gentling Touch требует текущую последовательность Attack и свободный слот.");
            }
            const wisdom = getDerivedStats(draft).abilityModifiers.wisdom;
            const preview = gentlingPreview({
              ...request,
              martialDieSides: getDerivedStats(draft).monk.martialDieSides,
              wisdomModifier: wisdom,
            });
            const ki = Number(draft.combat?.ki?.current);
            if (!Number.isInteger(ki) || ki < preview.cost) throw new Error("Недостаточно ци для Gentling Touch.");
            draft.combat.ki.current = ki - preview.cost;
            const slotNumber = getUsedAttackSlots(sequence) + 1;
            sequence.replacementResults ??= [];
            sequence.replacementResults.push({
              id: operationId,
              operationId,
              request,
              kind: "gentling-touch",
              slotNumber,
              ...preview,
            });
            if (!sequence.actionFlagApplied) {
              draft.ui.turn.actionUsed = true;
              sequence.actionFlagApplied = true;
            }
            if (getUsedAttackSlots(sequence) >= sequence.maximumAttacks) {
              sequence.status = "complete";
            }
            closeRestWindow(draft, "gentling-touch-slot");
            return draft;
          }, (current) => {
            const sequence = current.monk?.combatAssistant?.activeSequences?.find((entry) => entry.id === actionId);
            const battle = current.battleConsole?.current;
            const validTurn = battle
              ? battle.phase === "own-turn" && sequence?.battleId === battle.id &&
                sequence?.ownTurnId === battle.ownTurnId
              : !sequence?.battleId;
            return sequence?.kind === "attack-action" && sequence.status === "open" && validTurn &&
              Number(sequence.turnMarker) === Number(current.ui?.turn?.turnNumber ?? 1) &&
              getUsedAttackSlots(sequence) < sequence.maximumAttacks
              ? null : "В последовательности больше нет свободного слота Attack.";
          });
        }

export function closeAttackSequence(context, actionId, operationId) {
  return commit(context, operationId, { kind: "sara-attack-sequence-close", actionId },
    (draft) => {
      const sequence = draft.monk?.combatAssistant?.activeSequences?.find((entry) =>
        entry.id === actionId && entry.status === "open");
      if (!isSara(draft) || !sequence) throw new Error("Нет открытой последовательности для закрытия.");
      sequence.status = getUsedAttackSlots(sequence) ? "abandoned" : "closed";
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
      const profile = attack.profileSnapshot;
      if (!profile || typeof profile !== "object") {
        throw new Error("Для исторического расчёта урона отсутствует снимок профиля атаки.");
      }
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
      const weaponEligible = attack?.profileSnapshot?.attackKind === "weapon" &&
        attack.profileSnapshot?.melee === true &&
        attack.profileSnapshot?.martialArtsEligible === true;
      const technique = getEffectiveSelectedTechniqueIds(draft).has(techniqueId)
        ? MONK_TECHNIQUE_BY_ID.get(techniqueId) : null;
      if (!isSara(draft) || !technique?.eligibleStrike || !attack || attack.hitResult !== "hit" ||
          !(attack.profileId === "unarmed" || weaponEligible) ||
          technique?.unarmedOnly === true && attack.profileId !== "unarmed" ||
          attack.techniqueApplicationId ||
          !isCurrentStrikeParent(draft, sequence)) {
        throw new Error("Техника удара требует подтверждённое безоружное попадание без уже применённой техники.");
      }
      if (!getEffectiveSelectedTechniqueIds(draft).has(techniqueId)) {
        throw new Error("Техника не выбрана или сейчас недоступна.");
      }
      if (SAVE_ABILITIES[techniqueId] &&
          countUnresolvedCombatTasks(assistant) >= MAX_UNRESOLVED_COMBAT_TASKS) {
        throw new Error("Достигнут предел 20 нерешённых задач боя; сначала разрешите один спасбросок или урон.");
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
      pruneCombatHistory(assistant);
      assistant.pendingApplications.push(application);
      attack.techniqueApplicationId = applicationId;
      techniqueOutcome = result.result;
      return draft;
    },
    (current) => {
      const sequence = current.monk?.combatAssistant?.activeSequences?.find((entry) => entry.id === actionId);
      const attack = sequence?.resolvedAttacks?.find((entry) => entry.id === attackId);
      const weaponEligible = attack?.profileSnapshot?.attackKind === "weapon" &&
        attack.profileSnapshot?.melee === true &&
        attack.profileSnapshot?.martialArtsEligible === true;
      const technique = MONK_TECHNIQUE_BY_ID.get(techniqueId);
      return isSara(current) && technique?.eligibleStrike === true && attack?.hitResult === "hit" &&
        (attack.profileId === "unarmed" || weaponEligible) &&
        !(technique?.unarmedOnly === true && attack.profileId !== "unarmed") &&
        !attack.techniqueApplicationId &&
        isCurrentStrikeParent(current, sequence) &&
        getEffectiveSelectedTechniqueIds(current).has(techniqueId)
        ? null
        : "Техника удара требует актуальное подтверждённое безоружное попадание.";
    });
}

function isCurrentStrikeParent(character, sequence) {
  if (!sequence || !["open", "complete"].includes(sequence.status) ||
      Number(sequence.turnMarker) !== Number(character.ui?.turn?.turnNumber ?? 1)) return false;
  const battle = character.battleConsole?.current;
  if (!battle) return !sequence.battleId;
  if (battle.phase === "paused" || battle.phase === "ended" ||
      sequence.battleId && sequence.battleId !== battle.id) return false;
  const reactionParent = ["reaction-unarmed", "returned-projectile"].includes(sequence.kind);
  if (!reactionParent && battle.phase !== "own-turn") return false;
  if (sequence.ownTurnId && sequence.ownTurnId !== battle.ownTurnId) return false;
  return reactionParent ? ["waiting", "own-turn"].includes(battle.phase) : true;
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

export function recordBasicSaraAction(context, actionId, operationId) {
  if (!["dash", "disengage"].includes(actionId)) {
    return reject("Неизвестное базовое боевое действие.");
  }
  return commit(context, operationId, { kind: "sara-basic-action", actionId },
    (draft) => {
      if (!isSara(draft)) throw new Error("Это действие доступно только в листе Сары.");
      const battle = draft.battleConsole?.current;
      if (battle && battle.phase !== "own-turn") {
        throw new Error("Это действие можно отметить только в свой ход.");
      }
      if (draft.ui?.turn?.actionUsed === true) {
        throw new Error("Действие уже использовано в этом ходу.");
      }
      draft.ui.turn.actionUsed = true;
      const assistant = ensureCombatAssistant(draft);
      rememberSummary(assistant, {
        id: operationId,
        kind: "basic-action",
        actionId,
        reminder: actionId === "dash"
          ? "Рывок отмечен; пройденное расстояние определяется за столом."
          : "Отход отмечен; фактические взаимодействия с угрозами определяются за столом."
      });
      return draft;
    },
    (current) => {
      if (!isSara(current)) return "Это действие доступно только в листе Сары.";
      const battle = current.battleConsole?.current;
      if (battle && battle.phase !== "own-turn") return "Это действие можно отметить только в свой ход.";
      return current.ui?.turn?.actionUsed === true
        ? "Действие уже использовано в этом ходу."
        : null;
    });
}

export function correctSaraResource(context, resourceId, rawValue, operationId) {
  let outcome;
  const result = commit(context, operationId, {
    kind: "sara-resource-correction",
    resourceId,
  }, (draft) => {
    if (!isSara(draft)) throw new Error("Ресурсы можно исправлять только в листе Сары.");
    const target = getSaraResourceCorrectionTarget(draft, resourceId);
    if (!target) throw new Error("Выбранный ресурс отсутствует или не поддерживается.");
    const parsed = parsePhysicalInteger(rawValue, 0, target.maximum, `Новое значение: ${target.label}`);
    if (!parsed.ok) throw new Error(parsed.reason);
    const previous = target.current;
    target.write(parsed.value);
    outcome = { resourceId, label: target.label, previous, current: parsed.value };
    const assistant = ensureCombatAssistant(draft);
    rememberSummary(assistant, {
      id: operationId,
      kind: "resource-correction",
      ...outcome,
    });
    return draft;
  }, (current) => {
    if (!isSara(current)) return "Ресурсы можно исправлять только в листе Сары.";
    const target = getSaraResourceCorrectionTarget(current, resourceId);
    if (!target) return "Выбранный ресурс отсутствует или не поддерживается.";
    const parsed = parsePhysicalInteger(rawValue, 0, target.maximum, `Новое значение: ${target.label}`);
    return parsed.ok ? null : parsed.reason;
  });
  return result.status === "applied" ? { ...result, outcome } : result;
}

function getSaraResourceCorrectionTarget(character, resourceId) {
  const derived = getDerivedStats(character);
  if (resourceId === "hp-current") {
    return {
      label: "Текущие HP",
      current: Number(character.combat?.hp?.current),
      maximum: derived.maxHitPoints,
      write(value) { character.combat.hp.current = value; },
    };
  }
  if (resourceId === "hp-temp") {
    return {
      label: "Временные HP",
      current: Number(character.combat?.hp?.temp ?? 0),
      maximum: Number.MAX_SAFE_INTEGER,
      write(value) { character.combat.hp.temp = value; },
    };
  }
  if (resourceId === "ki") {
    return {
      label: "Ци",
      current: Number(character.combat?.ki?.current),
      maximum: derived.monk.kiMaximum,
      write(value) { character.combat.ki.current = value; },
    };
  }
  if (resourceId === "practiced") {
    return {
      label: "Отработанные удары",
      current: Number(character.combat?.practiced?.current),
      maximum: derived.monk.practicedMaximum,
      write(value) { character.combat.practiced.current = value; },
    };
  }
  if (resourceId.startsWith("racial-spell:")) {
    const id = resourceId.slice("racial-spell:".length);
    const spell = character.spellcasting?.racialSpells?.find((entry) =>
      entry.id === id && entry.source === "racial" && entry.mode === "limited-racial" && entry.uses);
    if (!spell) return null;
    return {
      label: `Применения: ${spell.nameRu ?? spell.id}`,
      current: Number(spell.uses.current),
      maximum: Number(spell.uses.max),
      write(value) { spell.uses.current = value; },
    };
  }
  return null;
}

export function commitRegeneration(context, dieResult, operationId, {
  confirmNoHealing = false,
  allowOutsideCombat = false,
} = {}) {
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
        confirmNoHealing,
        allowOutsideCombat,
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
