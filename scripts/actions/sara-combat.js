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
import { getSessionContext, getState, isCurrentSession, updateSessionState } from "../state.js";
import { applyMonkTechnique } from "./monk.js";
import { closeRestWindow, spendBoundDart } from "../sara-functional.js";
import { isAttackProfileEligible } from "../combat/attack-profile-eligibility.js";
import { gentlingPreview } from "../sara-functional.js";
import { integer } from "../sara-functional.js";
import {
  sameSeekingData,
  pendingSeeking,
  readSeekingHistory,
  writeSeekingHistory,
} from "../combat/seeking-history.js";
import { readIncomingEventReceipt } from "./incoming-event.js";

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

function pruneCombatHistory(assistant, character) {
  const unresolvedApplicationIds = new Set(assistant.pendingApplications
    .filter((entry) => !["success", "failure"].includes(entry.targetOutcome))
    .map((entry) => entry.parentAttackId));
  const unresolvedSequences = [];
  const completedSequences = [];
  const completedReplies = [];
  const protectedReplies = [];
  const currentBattle = character?.battleConsole?.current;
  const currentParentReceipts = new Set(assistant.recentlyCompletedSummaries
    .filter((entry) => entry.kind === "incoming-event" &&
      entry.request?.kind === "deflection" &&
      entry.battleId === currentBattle?.id &&
      entry.request.phaseAtOpen === currentBattle?.phase &&
      entry.request.ownTurnIdAtOpen === (currentBattle?.ownTurnId ?? null))
    .map((entry) => entry.id));
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
    if (unresolved) unresolvedSequences.push(sequence);
    else if (sequence.incomingReply) {
      if (currentParentReceipts.has(sequence.incomingReply.parentOperationId) &&
          sequence.incomingReply.parentOperationId) protectedReplies.push(sequence);
      else completedReplies.push(sequence);
    }
    else completedSequences.push(sequence);
  }
  assistant.activeSequences = [
    ...completedSequences.slice(-MAX_RECENT_COMBAT_SEQUENCES),
    ...completedReplies.slice(-MAX_RECENT_COMBAT_SEQUENCES),
    ...protectedReplies,
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

const INCOMING_REPLY_KINDS = new Set(["deflect-counter", "missile-return", "ebb-unarmed"]);

function normalizeIncomingReplyRequest(request) {
  if (!request || !INCOMING_REPLY_KINDS.has(request.replyKind) ||
      typeof request.eventId !== "string" || !request.eventId.trim() ||
      typeof request.battleId !== "string" || !request.battleId.trim() ||
      !["waiting", "own-turn"].includes(request.phaseAtOpen) ||
      (request.phaseAtOpen === "own-turn" &&
        (typeof request.ownTurnIdAtOpen !== "string" || !request.ownTurnIdAtOpen.trim())) ||
      (request.phaseAtOpen === "waiting" && request.ownTurnIdAtOpen != null) ||
      (request.parentOperationId != null &&
        (typeof request.parentOperationId !== "string" || !request.parentOperationId.trim())) ||
      (request.continuationId != null &&
        (typeof request.continuationId !== "string" || !request.continuationId.trim()))) {
    return { ok: false, reason: "Идентификаторы или вид ответного удара недопустимы." };
  }
  const attack = request.attack;
  if (!attack || !["normal", "advantage", "disadvantage"].includes(attack.rollMode)) {
    return { ok: false, reason: "Выберите режим физического броска." };
  }
  const ac = attack.targetArmorClass == null || String(attack.targetArmorClass).trim() === ""
    ? null : String(attack.targetArmorClass);
  const normalized = {
    eventId: request.eventId.trim(),
    battleId: request.battleId.trim(),
    phaseAtOpen: request.phaseAtOpen,
    ownTurnIdAtOpen: request.ownTurnIdAtOpen?.trim() ?? null,
    replyKind: request.replyKind,
    parentOperationId: request.parentOperationId?.trim() ?? null,
    continuationId: request.continuationId?.trim() ?? null,
    trigger: request.trigger === "melee-miss" ? "melee-miss" : null,
    attack: {
      rollMode: attack.rollMode,
      firstD20: String(attack.firstD20 ?? ""),
      secondD20: attack.secondD20 == null ? null : String(attack.secondD20),
      targetArmorClass: ac,
      dmHitResult: ["hit", "miss"].includes(attack.dmHitResult) ? attack.dmHitResult : null,
      targetLabel: String(attack.targetLabel ?? "").trim(),
    },
    damageRolls: Array.isArray(request.damageRolls)
      ? request.damageRolls.map((roll) => String(roll)) : [],
  };
  if (normalized.replyKind === "ebb-unarmed" &&
      (normalized.parentOperationId !== null || normalized.trigger !== "melee-miss")) {
    return { ok: false, reason: "Для безоружного ответа Ebb & Flow требуется промах вблизи." };
  }
  if (normalized.replyKind !== "ebb-unarmed" && !normalized.parentOperationId ||
      normalized.replyKind === "missile-return" && !normalized.continuationId) {
    return { ok: false, reason: "Не найдено подтверждённое родительское продолжение." };
  }
  return { ok: true, request: normalized };
}

function incomingReplyEvidence(state, request) {
  if (request.replyKind === "ebb-unarmed") {
    const alreadySaved = state?.monk?.combatAssistant?.recentlyCompletedSummaries?.some((entry) =>
      entry.kind === "incoming-event" && entry.eventId === request.eventId &&
      entry.request?.kind === "ebb-and-flow");
    const alreadyReplied = state?.monk?.combatAssistant?.activeSequences?.some((entry) =>
      entry.incomingReply?.eventId === request.eventId);
    return alreadySaved || alreadyReplied
      ? { ok: false, reason: "На это входящее событие уже выбран ответ Ebb & Flow." }
      : { ok: true };
  }
  const parent = readIncomingEventReceipt(state, request.parentOperationId);
  const expectedSource = request.replyKind === "missile-return" ? "projectile" : "melee";
  const outcome = parent?.outcome?.effects;
  if (!parent || parent.kind !== "incoming-event" ||
      parent.request?.kind !== "deflection" ||
      parent.request?.source !== expectedSource ||
      parent.eventId !== request.eventId ||
      parent.battleId !== request.battleId ||
      parent.request.phaseAtOpen !== request.phaseAtOpen ||
      parent.request.ownTurnIdAtOpen !== request.ownTurnIdAtOpen ||
      outcome?.finalRemainder !== 0 ||
      outcome?.rawRemainder !== 0 ||
      request.replyKind === "deflect-counter" &&
        outcome?.techniqueResult?.canCounterattack !== true) {
    return { ok: false, reason: "Нет подходящего завершённого отражения для этого ответа." };
  }
  if (request.replyKind === "missile-return") {
    const token = state.monk?.techniqueRuntime?.deflectContinuation;
    if (outcome?.techniqueResult?.canCatch !== true ||
        token?.kind !== "missile-return" || token.id !== request.continuationId ||
        token.id !== request.parentOperationId ||
        token.sourceSessionGeneration !== getSessionContext().sessionGeneration ||
        token.reactionAlreadyUsed !== true || token.consumed === true ||
        token.reservedBySequence) {
      return { ok: false, reason: "Токен поимки отсутствует или не соответствует отражению." };
    }
    if (token.battleId && (token.battleId !== request.battleId ||
        token.ownTurnId && token.ownTurnId !== request.ownTurnIdAtOpen)) {
      return { ok: false, reason: "Токен поимки устарел для этого боя или хода." };
    }
  }
  return { ok: true };
}

function incomingReplyReceiptFromState(state, operationId) {
  return state?.monk?.combatAssistant?.activeSequences?.find((sequence) =>
    sequence.incomingReply?.operationId === operationId)?.incomingReply ?? null;
}

export function readIncomingReplyReceipt(state, operationId) {
  return typeof operationId === "string" && operationId.trim()
    ? incomingReplyReceiptFromState(state, operationId) : null;
}

export function previewIncomingReplyAttack(state, request) {
  const normalized = normalizeIncomingReplyRequest(request);
  if (!normalized.ok) return normalized;
  const reply = normalized.request;
  const profileId = reply.replyKind === "missile-return" ? "returnedProjectile" : "unarmed";
  const attackInput = { ...reply.attack, profileId };
  const preview = calculateAttackPreview(state, attackInput);
  if (!preview.ok) return preview;
  if (preview.hitResult == null) {
    if (preview.naturalMiss || preview.critical) {
      preview.hitResult = preview.critical;
      preview.hitResolutionSource = "natural-rule";
    } else {
      return { ok: false, reason: "Укажите КД цели или выберите попадание/промах." };
    }
  }
  return {
    ok: true,
    request: reply,
    profileId,
    attack: preview,
    requiredDamageDice: preview.hitResult ? (preview.critical ? 2 : 1) : 0,
  };
}

export function previewIncomingReply(state, request) {
  const attackPreview = previewIncomingReplyAttack(state, request);
  if (!attackPreview.ok) return attackPreview;
  if (!attackPreview.attack.hitResult) {
    return { ...attackPreview, complete: true, damage: null };
  }
  const damage = calculateAttackDamage(
    attackPreview.attack.profile,
    attackPreview.request.damageRolls,
    attackPreview.attack.critical,
  );
  if (!damage.ok) {
    return {
      ...attackPreview,
      ok: false,
      complete: false,
      code: "invalid-damage",
      reason: damage.reason,
    };
  }
  return { ...attackPreview, complete: true, damage };
}

export function commitIncomingReply(context, request, operationId) {
  if (typeof operationId !== "string" || !operationId.trim()) {
    return reject("Для ответного удара требуется стабильный operation ID.");
  }
  if (!isCurrentSession(context)) return reject("stale-session");
  const normalized = normalizeIncomingReplyRequest(request);
  if (!normalized.ok) return reject(normalized.reason);
  const saved = readIncomingReplyReceipt(getState(), operationId);
  if (saved) {
    return JSON.stringify(saved.request) === JSON.stringify(normalized.request)
      ? { status: "replayed", receipt: structuredClone(saved) }
      : { status: "rejected", code: "operation-id-collision",
        reason: "ID ответного удара уже связан с другим запросом." };
  }
  const current = getState();
  const battle = current.battleConsole?.current;
  const phaseValid = battle?.id === normalized.request.battleId &&
    battle.phase === normalized.request.phaseAtOpen &&
    battle.ownTurnId === normalized.request.ownTurnIdAtOpen &&
    ["waiting", "own-turn"].includes(battle.phase);
  if (!phaseValid || !isSara(current)) return reject("Контекст боя или владелец изменился.");
  const eligibility = incomingReplyEvidence(current, normalized.request);
  if (!eligibility.ok) return reject(eligibility.reason);
  if (normalized.request.replyKind === "ebb-unarmed" &&
      (Number(current.profile?.level) < 6 || current.ui?.turn?.reactionUsed === true)) {
    return reject("Безоружный ответ недоступен: проверьте уровень и реакцию.");
  }
  if (normalized.request.replyKind === "deflect-counter" &&
      current.ui?.turn?.reactionUsed !== true) {
    return reject("Контратака требует уже применённой реакции отражения.");
  }
  const preview = previewIncomingReply(current, normalized.request);
  if (!preview.ok) return reject(preview.reason);
  if (normalized.request.replyKind === "missile-return" &&
      (!Number.isInteger(Number(current.combat?.ki?.current)) ||
        Number(current.combat.ki.current) < 1)) return reject("Для возврата требуется 1 ци.");
  if (normalized.request.replyKind === "missile-return" &&
      !(Array.isArray(current.combat?.proficiencies?.weapons) &&
        current.combat.proficiencies.weapons.includes("Simple weapons"))) {
    return reject("Для возврата снаряда требуется владение простым оружием.");
  }
  let receipt = null;
  const sequenceId = `incoming-reply:${operationId}`;
  const attackId = `${sequenceId}:attack:1`;
  const result = updateSessionState(context, (draft) => {
    const active = draft.battleConsole?.current;
    if (!isSara(draft) || active?.id !== normalized.request.battleId ||
        active.phase !== normalized.request.phaseAtOpen ||
        active.ownTurnId !== normalized.request.ownTurnIdAtOpen) {
      throw new Error("Контекст ответного удара устарел.");
    }
    const assistant = ensureCombatAssistant(draft);
    if (assistant.activeSequences.some((entry) => entry.id === sequenceId)) {
      throw new Error("ID завершённой последовательности уже занят.");
    }
    if (assistant.activeSequences.some((entry) =>
      entry.incomingReply?.parentOperationId === normalized.request.parentOperationId &&
      entry.incomingReply?.replyKind === normalized.request.replyKind) &&
      normalized.request.parentOperationId) {
      throw new Error("На это отражение уже дан ответ.");
    }
    const allowed = incomingReplyEvidence(draft, normalized.request);
    if (!allowed.ok) throw new Error(allowed.reason);
    const fresh = previewIncomingReply(draft, normalized.request);
    if (!fresh.ok) throw new Error(fresh.reason);
    if (normalized.request.replyKind === "ebb-unarmed") {
      if (draft.profile?.id !== "sara-velaris" || Number(draft.profile.level) < 6 ||
          draft.ui?.turn?.reactionUsed === true ||
          draft.monk?.combatAssistant?.activeSequences?.some((entry) =>
            entry.incomingReply?.eventId === normalized.request.eventId)) {
        throw new Error("Ответ Ebb & Flow для этого события уже недоступен.");
      }
      draft.ui.turn.reactionUsed = true;
    }
    if (normalized.request.replyKind === "missile-return") {
      const token = draft.monk.techniqueRuntime.deflectContinuation;
      const ki = Number(draft.combat?.ki?.current);
      if (!Number.isInteger(ki) || ki < 1) throw new Error("Для возврата требуется 1 ци.");
      if (!(Array.isArray(draft.combat?.proficiencies?.weapons) &&
          draft.combat.proficiencies.weapons.includes("Simple weapons"))) {
        throw new Error("Для возврата снаряда требуется владение простым оружием.");
      }
      draft.combat.ki.current = ki - 1;
      token.consumed = true;
    }
    const kind = normalized.request.replyKind === "missile-return"
      ? "returned-projectile" : "reaction-unarmed";
    const sequence = createSequenceRecord(draft, sequenceId, kind, {
      parentId: normalized.request.parentOperationId,
      parentFeature: normalized.request.replyKind,
    });
    sequence.maximumAttacks = 1;
    sequence.status = "complete";
    const attack = {
      id: attackId, slotNumber: 1, profileId: fresh.profileId,
      profileSnapshot: structuredClone(fresh.attack.profile),
      optionalTargetLabel: normalized.request.attack.targetLabel,
      rawD20Rolls: fresh.attack.rawD20Rolls,
      rollMode: fresh.attack.rollMode, chosenD20: fresh.attack.chosenD20,
      attackBonusSnapshot: fresh.attack.attackBonusSnapshot,
      attackTotal: fresh.attack.attackTotal,
      targetArmorClass: normalized.request.attack.targetArmorClass == null
        ? null : Number(normalized.request.attack.targetArmorClass),
      hitResolutionSource: fresh.attack.hitResolutionSource,
      hitResult: fresh.attack.hitResult ? "hit" : "miss",
      critical: fresh.attack.critical,
      damageRolls: fresh.damage?.damageRolls ?? null,
      damageModifierSnapshot: fresh.damage?.damageModifierSnapshot ?? null,
      damageTotalBeforeTargetModifiers: fresh.damage?.damageTotalBeforeTargetModifiers ?? null,
      damageStatus: fresh.attack.hitResult ? "recorded" : "not-applicable",
      techniqueApplicationId: null,
    };
    sequence.resolvedAttacks.push(attack);
    if (normalized.request.replyKind !== "deflect-counter") closeRestWindow(draft, "incoming-reply");
    sequence.incomingReply = {
      eventId: normalized.request.eventId,
      replyKind: normalized.request.replyKind,
      parentOperationId: normalized.request.parentOperationId,
      continuationId: normalized.request.continuationId,
      operationId,
      request: structuredClone(normalized.request),
      outcome: {
        hit: fresh.attack.hitResult,
        critical: fresh.attack.critical,
        attackTotal: fresh.attack.attackTotal,
        damageTotal: fresh.damage?.damageTotalBeforeTargetModifiers ?? null,
      },
    };
    assistant.activeSequences.push(sequence);
    pruneCombatHistory(assistant, draft);
    receipt = sequence.incomingReply;
    return draft;
  }, {
    operationId,
    metadata: { kind: "sara-incoming-reply", replyKind: normalized.request.replyKind },
  });
  if (result.reason === "duplicate-operation") {
    return { ...result, code: "duplicate-operation" };
  }
  if (result.status === "rejected") {
    return { ...result, code: "pre-commit-rejected" };
  }
  return result.status === "applied"
    ? { ...result, receipt: structuredClone(receipt) } : result;
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
      pruneCombatHistory(assistant, draft);
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

function normalizeCompletedNormalAttackRequest(request) {
  const attack = request?.attack;
  if (!request || !["sequenceId", "attackId"].every((key) =>
    typeof request[key] === "string" && request[key].trim()) ||
      !attack || typeof attack.profileId !== "string" ||
      !["normal", "advantage", "disadvantage"].includes(attack.rollMode) ||
      !Array.isArray(request.damageRolls)) {
    return { ok: false, reason: "Запрос завершённой атаки имеет неверный формат." };
  }
  const normalized = {
    sequenceId: request.sequenceId.trim(),
    attackId: request.attackId.trim(),
    battleId: request.battleId ?? null,
    ownTurnId: request.ownTurnId ?? null,
    turnMarker: Number(request.turnMarker),
    expectedUsedSlots: Number(request.expectedUsedSlots),
    attack: {
      profileId: attack.profileId,
      rollMode: attack.rollMode,
      firstD20: String(attack.firstD20 ?? ""),
      secondD20: String(attack.secondD20 ?? ""),
      targetArmorClass: attack.targetArmorClass == null ? "" : String(attack.targetArmorClass),
      dmHitResult: ["hit", "miss"].includes(attack.dmHitResult) ? attack.dmHitResult : null,
      targetLabel: String(attack.targetLabel ?? "").trim(),
      confirmSeparateAction: attack.confirmSeparateAction === true,
      dmExceptionConfirmed: attack.dmExceptionConfirmed === true,
    },
    damageRolls: request.damageRolls.map((roll) => String(roll)),
  };
  if (!Number.isInteger(normalized.turnMarker) ||
      !Number.isInteger(normalized.expectedUsedSlots) || normalized.expectedUsedSlots < 0) {
    return { ok: false, reason: "Контекст или номер слота атаки недопустим." };
  }
  return { ok: true, request: normalized };
}

function normalizeCompletedBonusAttackRequest(request) {
  const normal = normalizeCompletedNormalAttackRequest(request);
  if (!normal.ok || !["flurry", "bonus-unarmed"].includes(request?.sequenceKind)) {
    return { ok: false, reason: "Запрос завершённой бонусной атаки имеет неверный формат." };
  }
  const start = request.start ?? {};
  const normalized = {
    ...normal.request,
    sequenceKind: request.sequenceKind,
    start: {
      confirmed: start.confirmed === true,
      triggerConfirmed: start.triggerConfirmed === true,
      parentId: typeof start.parentId === "string" && start.parentId.trim()
        ? start.parentId.trim() : null,
      parentFeature: typeof start.parentFeature === "string" && start.parentFeature.trim()
        ? start.parentFeature.trim() : null,
    },
  };
  if (normalized.start.parentFeature != null) {
    return { ok: false, reason: "Новый бонусный удар не может быть ответной или continuation-атакой." };
  }
  return { ok: true, request: normalized };
}

function completedBonusReceiptFromState(state, operationId) {
  for (const sequence of state?.monk?.combatAssistant?.activeSequences ?? []) {
    const attack = sequence.resolvedAttacks?.find((entry) =>
      entry.completedOperation?.operationId === operationId);
    if (attack) return { sequence, attack, ...attack.completedOperation };
  }
  return null;
}

export function readCompletedBonusAttackReceipt(state, operationId) {
  return typeof operationId === "string" && operationId.trim()
    ? completedBonusReceiptFromState(state, operationId) : null;
}

export function previewCompletedBonusAttack(state, request) {
  const normalized = normalizeCompletedBonusAttackRequest(request);
  if (!normalized.ok) return normalized;
  const input = normalized.request;
  const existing = (state?.monk?.combatAssistant?.activeSequences ?? [])
    .find((entry) => entry.id === input.sequenceId);
  if (existing && existing.kind !== input.sequenceKind) {
    return { ok: false, reason: "Вид последовательности не совпадает с запросом." };
  }
  const preview = previewCompletedNormalAttack(state, input);
  return preview.ok ? { ...preview, request: input } : preview;
}

export function commitCompletedBonusAttack(context, request, operationId) {
  if (typeof operationId !== "string" || !operationId.trim()) {
    return reject("Для операции требуется стабильный идентификатор.");
  }
  if (!isCurrentSession(context)) return reject("stale-session");
  const normalized = normalizeCompletedBonusAttackRequest(request);
  if (!normalized.ok) return reject(normalized.reason);
  const input = normalized.request;
  const prior = readCompletedBonusAttackReceipt(getState(), operationId);
  if (prior) {
    return JSON.stringify(prior.request) === JSON.stringify(input)
      ? { status: "replayed", receipt: prior }
      : reject("operation-collision");
  }
  const initialPreview = previewCompletedBonusAttack(getState(), input);
  if (!initialPreview.ok || initialPreview.stage !== "complete") {
    return reject(initialPreview.reason ?? "Завершённый результат атаки не готов.");
  }
  let receipt;
  return commit(context, operationId, {
    kind: "sara-completed-bonus-attack",
    sequenceId: input.sequenceId,
    attackId: input.attackId,
    sequenceKind: input.sequenceKind,
  }, (draft) => {
    if (!isSara(draft)) throw new Error("Бонусная последовательность доступна только в листе Сары.");
    const fresh = previewCompletedBonusAttack(draft, input);
    if (!fresh.ok || fresh.stage !== "complete") {
      throw new Error(fresh.reason ?? "Завершённый результат атаки не готов.");
    }
    const assistant = ensureCombatAssistant(draft);
    let sequence = assistant.activeSequences.find((entry) => entry.id === input.sequenceId);
    const battle = draft.battleConsole?.current;
    if (Number(draft.ui?.turn?.turnNumber ?? 1) !== input.turnMarker ||
        (battle?.id ?? null) !== input.battleId ||
        (battle?.phase === "own-turn" ? battle.ownTurnId : null) !== input.ownTurnId ||
        validateBattleActionPhase(draft, input.sequenceKind)) {
      throw new Error("Контекст хода или боя изменился.");
    }
    const first = !sequence;
    if (first) {
      const level = Number(draft.profile?.level);
      if (assistant.activeSequences.some((entry) => entry.id === input.sequenceId) ||
          assistant.activeSequences.some((entry) => entry.status === "open" &&
            !mayRunAlongside(input.sequenceKind, entry.kind)) ||
          input.expectedUsedSlots !== 0 || level < 2 ||
          draft.ui?.turn?.bonusActionUsed === true) {
        throw new Error("Нельзя начать новую бонусную последовательность.");
      }
      if (input.sequenceKind === "flurry") {
        const ki = Number(draft.combat?.ki?.current);
        if (input.start.confirmed !== true || !Number.isInteger(ki) || ki < 1) {
          throw new Error("Для Шквала подтвердите начало и наличие 1 ци.");
        }
        draft.combat.ki.current = ki - 1;
      } else if (input.start.triggerConfirmed !== true) {
        throw new Error("Подтвердите условие бонусной атаки Боевых искусств.");
      }
      sequence = createSequenceRecord(draft, input.sequenceId, input.sequenceKind, {
        parentId: input.start.parentId ?? operationId,
        parentFeature: null,
      });
      sequence.resourcePaymentApplied = input.sequenceKind === "flurry";
      sequence.actionFlagApplied = true;
      assistant.activeSequences.push(sequence);
      draft.ui.turn.bonusActionUsed = true;
    } else {
      if (sequence.kind !== input.sequenceKind || sequence.status !== "open" ||
          sequence.battleId !== input.battleId || sequence.ownTurnId !== input.ownTurnId ||
          Number(sequence.turnMarker) !== input.turnMarker ||
          getUsedAttackSlots(sequence) !== input.expectedUsedSlots ||
          (input.sequenceKind === "flurry" &&
            (!sequence.resourcePaymentApplied || !sequence.actionFlagApplied)) ||
          (input.sequenceKind === "bonus-unarmed" &&
            (sequence.resourcePaymentApplied || !sequence.actionFlagApplied))) {
        throw new Error("Последовательность, оплата или ожидаемый слот устарели.");
      }
    }
    if (!isAttackProfileEligible(input.sequenceKind, input.attack.profileId,
        getDerivedStats(draft).saraAttackProfiles, draft)) {
      throw new Error("Этот профиль атаки недопустим для бонусной последовательности.");
    }
    if (sequence.resolvedAttacks.some((entry) => entry.id === input.attackId) ||
        getUsedAttackSlots(sequence) >= sequence.maximumAttacks) {
      throw new Error("Слот атаки уже занят или последовательность завершена.");
    }
    const attack = {
      id: input.attackId,
      profileId: input.attack.profileId,
      profileSnapshot: structuredClone(fresh.attack.profile),
      optionalTargetLabel: input.attack.targetLabel,
      rawD20Rolls: fresh.attack.rawD20Rolls,
      rollMode: fresh.attack.rollMode,
      chosenD20: fresh.attack.chosenD20,
      attackBonusSnapshot: fresh.attack.attackBonusSnapshot,
      targetArmorClass: input.attack.targetArmorClass.trim() === ""
        ? null : Number(input.attack.targetArmorClass),
      attackTotal: fresh.attack.attackTotal,
      hitResolutionSource: fresh.attack.hitResolutionSource,
      hitResult: fresh.attack.hitResult ? "hit" : "miss",
      critical: fresh.attack.critical,
      damageRolls: fresh.damage?.damageRolls ?? null,
      damageModifierSnapshot: fresh.damage?.damageModifierSnapshot ?? null,
      damageTotalBeforeTargetModifiers: fresh.damage?.damageTotalBeforeTargetModifiers ?? null,
      damageStatus: fresh.attack.hitResult ? "recorded" : "not-applicable",
      techniqueApplicationId: null,
      completedOperation: {
        operationId,
        request: structuredClone(input),
        outcome: fresh.attack.hitResult ? "hit" : "miss",
      },
    };
    closeRestWindow(draft, "recorded-attack");
    sequence.resolvedAttacks.push(attack);
    attack.slotNumber = getUsedAttackSlots(sequence);
    sequence.status = getUsedAttackSlots(sequence) >= sequence.maximumAttacks
      ? "complete" : "open";
    pruneCombatHistory(assistant, draft);
    receipt = { sequenceId: sequence.id, attackId: attack.id, outcome: attack.hitResult };
    return draft;
  }, (current) => {
    const fresh = previewCompletedBonusAttack(current, input);
    if (!fresh.ok || fresh.stage !== "complete") {
      return fresh.reason ?? "Завершённый результат атаки не готов.";
    }
    const sequence = (current.monk?.combatAssistant?.activeSequences ?? [])
      .find((entry) => entry.id === input.sequenceId);
    if (sequence && (sequence.status !== "open" ||
        getUsedAttackSlots(sequence) !== input.expectedUsedSlots)) {
      return "Последовательность или ожидаемый слот атаки устарел.";
    }
    return null;
  });
}

function completedNormalAttackReceiptFromState(state, operationId) {
  for (const sequence of state?.monk?.combatAssistant?.activeSequences ?? []) {
    const attack = sequence.resolvedAttacks?.find((entry) =>
      entry.completedOperation?.operationId === operationId);
    if (attack) return { sequence, attack, ...attack.completedOperation };
  }
  return null;
}

export function readCompletedNormalAttackReceipt(state, operationId) {
  return typeof operationId === "string" && operationId.trim()
    ? completedNormalAttackReceiptFromState(state, operationId) : null;
}

export function previewCompletedNormalAttack(state, request) {
  const normalized = normalizeCompletedNormalAttackRequest(request);
  if (!normalized.ok) return normalized;
  const input = normalized.request;
  const attackPreview = calculateAttackPreview(state, input.attack);
  if (!attackPreview.ok) return attackPreview;
  let outcome = attackPreview;
  if (outcome.hitResult == null) {
    if (outcome.naturalMiss || outcome.critical) {
      outcome = { ...outcome, hitResult: outcome.critical, hitResolutionSource: "natural-rule" };
    } else {
      return { ok: false, stage: "attack", reason: "Укажите КД или исход ведущего." };
    }
  }
  if (!outcome.hitResult) {
    return { ok: true, stage: "complete", request: input, attack: outcome, damage: null };
  }
  if (!input.damageRolls.length) {
    return { ok: true, stage: "damage", request: input, attack: outcome, damage: null };
  }
  const damage = calculateAttackDamage(
    outcome.profile, input.damageRolls, outcome.critical,
  );
  return damage.ok
    ? { ok: true, stage: "complete", request: input, attack: outcome, damage }
    : { ok: false, stage: "damage", reason: damage.reason };
}

export function commitCompletedNormalAttack(context, request, operationId) {
  if (typeof operationId !== "string" || !operationId.trim()) {
    return reject("Для операции требуется стабильный идентификатор.");
  }
  if (!isCurrentSession(context)) return reject("stale-session");
  const normalized = normalizeCompletedNormalAttackRequest(request);
  if (!normalized.ok) return reject(normalized.reason);
  const input = normalized.request;
  const prior = readCompletedNormalAttackReceipt(getState(), operationId);
  if (prior) {
    return JSON.stringify(prior.request) === JSON.stringify(input)
      ? { status: "replayed", receipt: prior }
      : reject("operation-collision");
  }
  const preview = previewCompletedNormalAttack(getState(), input);
  if (!preview.ok || preview.stage !== "complete") {
    return reject(preview.reason ?? "Завершённый результат атаки не готов.");
  }
  let receipt;
  return commit(context, operationId, {
    kind: "sara-completed-normal-attack", sequenceId: input.sequenceId, attackId: input.attackId,
  }, (draft) => {
    if (!isSara(draft)) throw new Error("Атака доступна только в листе Сары.");
    const fresh = previewCompletedNormalAttack(draft, input);
    if (!fresh.ok || fresh.stage !== "complete") {
      throw new Error(fresh.reason ?? "Завершённый результат атаки не готов.");
    }
    const assistant = ensureCombatAssistant(draft);
    let sequence = assistant.activeSequences.find((entry) =>
      entry.id === input.sequenceId && entry.kind === "attack-action");
    const battle = draft.battleConsole?.current;
    if (Number(draft.ui?.turn?.turnNumber ?? 1) !== input.turnMarker ||
        (battle?.id ?? null) !== input.battleId ||
        (battle?.phase === "own-turn" ? battle.ownTurnId : null) !== input.ownTurnId ||
        validateBattleActionPhase(draft, "attack-action")) {
      throw new Error("Контекст хода или боя изменился.");
    }
    if (sequence) {
      if (sequence.status !== "open" || sequence.battleId !== input.battleId ||
          sequence.ownTurnId !== input.ownTurnId ||
          Number(sequence.turnMarker) !== input.turnMarker ||
          getUsedAttackSlots(sequence) !== input.expectedUsedSlots) {
        throw new Error("Последовательность или ожидаемый слот атаки устарели.");
      }
    } else {
      if (assistant.activeSequences.some((entry) => entry.id === input.sequenceId) ||
          assistant.activeSequences.some((entry) => entry.status === "open" &&
            !mayRunAlongside("attack-action", entry.kind)) ||
          input.expectedUsedSlots !== 0 ||
          draft.ui?.turn?.actionUsed && !input.attack.confirmSeparateAction) {
        throw new Error("Нельзя начать новую последовательность Attack.");
      }
      sequence = createSequenceRecord(draft, input.sequenceId, "attack-action");
      assistant.activeSequences.push(sequence);
    }
    if (!isAttackProfileEligible("attack-action", input.attack.profileId,
        getDerivedStats(draft).saraAttackProfiles, draft)) {
      throw new Error("Этот профиль атаки недопустим для последовательности Attack.");
    }
    if (sequence.resolvedAttacks.some((entry) => entry.id === input.attackId) ||
        getUsedAttackSlots(sequence) >= sequence.maximumAttacks) {
      throw new Error("Слот атаки уже занят или последовательность завершена.");
    }
    const attack = {
      id: input.attackId,
      profileId: input.attack.profileId,
      profileSnapshot: structuredClone(fresh.attack.profile),
      optionalTargetLabel: input.attack.targetLabel,
      rawD20Rolls: fresh.attack.rawD20Rolls,
      rollMode: fresh.attack.rollMode,
      chosenD20: fresh.attack.chosenD20,
      attackBonusSnapshot: fresh.attack.attackBonusSnapshot,
      targetArmorClass: input.attack.targetArmorClass.trim() === ""
        ? null : Number(input.attack.targetArmorClass),
      attackTotal: fresh.attack.attackTotal,
      hitResolutionSource: fresh.attack.hitResolutionSource,
      hitResult: fresh.attack.hitResult ? "hit" : "miss",
      critical: fresh.attack.critical,
      damageRolls: fresh.damage?.damageRolls ?? null,
      damageModifierSnapshot: fresh.damage?.damageModifierSnapshot ?? null,
      damageTotalBeforeTargetModifiers: fresh.damage?.damageTotalBeforeTargetModifiers ?? null,
      damageStatus: fresh.attack.hitResult ? "recorded" : "not-applicable",
      techniqueApplicationId: null,
      completedOperation: {
        operationId,
        request: structuredClone(input),
        outcome: fresh.attack.hitResult ? "hit" : "miss",
      },
    };
    const dartId = draft.inventory?.starterManifest?.bindings?.darts;
    if (input.attack.profileId === dartId) {
      attack.ammunitionSpend = {
        itemId: dartId,
        quantityAfter: spendBoundDart(draft, dartId),
      };
    }
    closeRestWindow(draft, "recorded-attack");
    sequence.resolvedAttacks.push(attack);
    attack.slotNumber = getUsedAttackSlots(sequence);
    if (!sequence.actionFlagApplied) {
      draft.ui.turn.actionUsed = true;
      sequence.actionFlagApplied = true;
    }
    sequence.status = getUsedAttackSlots(sequence) >= sequence.maximumAttacks ? "complete" : "open";
    pruneCombatHistory(assistant, draft);
    receipt = { sequenceId: sequence.id, attackId: attack.id, outcome: attack.hitResult };
    return draft;
  }, (current) => {
    const currentPreview = previewCompletedNormalAttack(current, input);
    if (!currentPreview.ok || currentPreview.stage !== "complete") {
      return currentPreview.reason ?? "Завершённый результат атаки не готов.";
    }
    const sequence = getNormalAttackSequenceForAction(current, input.sequenceId);
    if (sequence && (sequence.status !== "open" ||
        getUsedAttackSlots(sequence) !== input.expectedUsedSlots)) {
      return "Последовательность или ожидаемый слот атаки устарели.";
    }
    return null;
  });
}

function getNormalAttackSequenceForAction(state, sequenceId) {
  return state.monk?.combatAssistant?.activeSequences?.find((entry) =>
    entry.id === sequenceId && entry.kind === "attack-action") ?? null;
}

export function beginSeekingStrike(context, actionId, attackId, operationId) {
  if (!operationId) return reject("Для операции требуется стабильный идентификатор.");
  if (!isCurrentSession(context)) return reject("stale-session");
  const state = getState();
  const sequences = state.monk?.combatAssistant?.activeSequences ?? [];
  const selectedSequence = sequences.find((sequence) => sequence.id === actionId);
  const selectedAttack = selectedSequence?.resolvedAttacks?.find((attack) =>
    attack.id === attackId);
  if (!selectedAttack) {
    return reject("Записанный удар для Seeking Strike не найден.");
  }
  let selectedHistory;
  try {
    selectedHistory = readSeekingHistory(selectedAttack, { actionId, attackId });
  } catch (error) {
    return reject(`История Seeking Strike противоречива; применение заблокировано. ${error.message}`);
  }
  const selectedInvocation = selectedHistory.find((entry) =>
    entry.id === operationId || entry.paidOperationId === operationId);

  const candidateParents = new Map();
  for (const sequence of sequences) {
    for (const attack of sequence.resolvedAttacks ?? []) {
      if (sequence.id === actionId && attack.id === attackId) continue;
      const entries = [
        ...(Array.isArray(attack.seekingAmendments)
          ? attack.seekingAmendments : []),
        ...(attack.seekingAmendment ? [attack.seekingAmendment] : []),
      ];
      if (entries.some((entry) =>
        entry?.paidOperationId === operationId || entry?.id === operationId)) {
        const key = JSON.stringify([sequence.id, attack.id]);
        candidateParents.set(key, { sequence, attack });
      }
    }
  }
  for (const { sequence, attack } of candidateParents.values()) {
    try {
      const history = readSeekingHistory(attack, {
        actionId: sequence.id,
        attackId: attack.id,
      });
      if (history.some((entry) =>
        entry.id === operationId || entry.paidOperationId === operationId)) {
        return reject("Идентификатор Seeking Strike уже использован для другого родителя.");
      }
    } catch (error) {
      return reject(`Конфликт идентификатора Seeking Strike: совпадающая запись другого удара противоречива. ${error.message}`);
    }
  }
  if (selectedInvocation) {
    return { status: "applied", replayed: true, result: structuredClone(selectedInvocation) };
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

function canonicalSeekingBasisValue(value) {
  if (Array.isArray(value)) return value.map(canonicalSeekingBasisValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, canonicalSeekingBasisValue(value[key])]));
  }
  return value;
}

export function buildSeekingParentBasis(sequence, attack, history) {
  return JSON.stringify(canonicalSeekingBasisValue({
    parent: {
      actionId: sequence?.id ?? null,
      attackId: attack?.id ?? null,
      kind: sequence?.kind ?? null,
      status: sequence?.status ?? null,
      maximumAttacks: sequence?.maximumAttacks ?? null,
      usedSlots: getUsedAttackSlots(sequence),
      battleId: sequence?.battleId ?? null,
      ownTurnId: sequence?.ownTurnId ?? null,
      turnMarker: sequence?.turnMarker ?? null,
    },
    effectiveAttack: {
      rawD20Rolls: attack?.rawD20Rolls ?? null,
      rollMode: attack?.rollMode ?? null,
      targetArmorClass: attack?.targetArmorClass ?? null,
      dmHitResult: attack?.dmHitResult ?? null,
      chosenD20: attack?.chosenD20 ?? null,
      attackTotal: attack?.attackTotal ?? null,
      attackBonusSnapshot: attack?.attackBonusSnapshot ?? null,
      hitResult: attack?.hitResult ?? null,
      critical: attack?.critical ?? null,
      hitResolutionSource: attack?.hitResolutionSource ?? null,
      profileId: attack?.profileId ?? null,
      profileSnapshot: attack?.profileSnapshot ?? null,
      damageStatus: attack?.damageStatus ?? null,
      damageRolls: attack?.damageRolls ?? null,
      damageTotalBeforeTargetModifiers: attack?.damageTotalBeforeTargetModifiers ?? null,
      techniqueApplicationId: attack?.techniqueApplicationId ?? null,
    },
    history: (history ?? []).map((entry) => ({
      invocationId: entry.id ?? entry.paidOperationId ?? null,
      parent: entry.parent ?? null,
      status: entry.status,
      kiPaid: entry.kiPaid,
      original: entry.original,
      replacement: entry.replacement ?? null,
      resolutionOperationId: entry.resolutionOperationId ?? null,
    })),
  }));
}

function normalizeCompletedSeekingRequest(request) {
  const replacement = request?.replacement;
  if (!request || !["actionId", "attackId", "invocationId", "expectedParentBasis"]
    .every((key) => typeof request[key] === "string" && request[key].trim()) ||
      !replacement || !["normal", "advantage", "disadvantage"].includes(replacement.rollMode) ||
      !Array.isArray(request.damageRolls) ||
      !["waiting", "own-turn"].includes(request.phaseAtOpen) ||
      !Number.isInteger(Number(request.turnMarker)) ||
      (request.phaseAtOpen === "own-turn" &&
        (typeof request.ownTurnId !== "string" || !request.ownTurnId.trim())) ||
      (request.phaseAtOpen === "waiting" && request.ownTurnId != null)) {
    return { ok: false, reason: "Запрос завершённого Seeking Strike имеет неверный формат." };
  }
  return {
    ok: true,
    request: {
      actionId: request.actionId.trim(),
      attackId: request.attackId.trim(),
      invocationId: request.invocationId.trim(),
      battleId: request.battleId ?? null,
      phaseAtOpen: request.phaseAtOpen,
      ownTurnId: request.ownTurnId ?? null,
      turnMarker: Number(request.turnMarker),
      expectedParentBasis: request.expectedParentBasis,
      replacement: {
        rollMode: replacement.rollMode,
        firstD20: String(replacement.firstD20 ?? ""),
        secondD20: String(replacement.secondD20 ?? ""),
        targetArmorClass: replacement.targetArmorClass == null
          ? "" : String(replacement.targetArmorClass),
        dmHitResult: ["hit", "miss"].includes(replacement.dmHitResult)
          ? replacement.dmHitResult : null,
        dmExceptionConfirmed: replacement.dmExceptionConfirmed === true,
      },
      damageRolls: request.damageRolls.map((roll) => String(roll)),
    },
  };
}

function completedSeekingPreviewFromParent(state, input, sequence, attack, history) {
  if (!isSara(state) || !sequence || !attack ||
      attack.hitResult !== "miss" || attack.damageStatus === "awaiting-damage" ||
      !seekingParentWindowIsCurrent(state, sequence) ||
      !(attack.profileId === "unarmed" || attack.profileSnapshot?.martialArtsEligible === true) ||
      !attack.profileSnapshot || !Number.isFinite(Number(attack.attackBonusSnapshot)) ||
      pendingSeeking(history) ||
      !getEffectiveSelectedTechniqueIds(state).has("ll-monk:seeking-strike")) {
    return { ok: false, reason: "Нет допустимого текущего промаха для Seeking Strike." };
  }
  const basis = buildSeekingParentBasis(sequence, attack, history);
  if (basis !== input.expectedParentBasis) {
    return { ok: false, reason: "Исходный промах или контекст изменился. Проверьте Seeking Strike заново." };
  }
  const battle = state.battleConsole?.current;
  if ((battle?.id ?? null) !== input.battleId ||
      (battle?.phase ?? "waiting") !== input.phaseAtOpen ||
      (input.phaseAtOpen === "own-turn" ? battle?.ownTurnId ?? null : null) !== input.ownTurnId ||
      Number(state.ui?.turn?.turnNumber ?? 1) !== input.turnMarker) {
    return { ok: false, reason: "Контекст хода или боя изменился." };
  }
  const ki = Number(state.combat?.ki?.current);
  if (!Number.isInteger(ki) || ki < 1) {
    return { ok: false, reason: "Для Seeking Strike требуется 1 ци." };
  }
  const replacementInput = {
    profileId: attack.profileId,
    rollMode: input.replacement.rollMode,
    firstD20: input.replacement.firstD20,
    secondD20: input.replacement.secondD20,
    targetArmorClass: input.replacement.targetArmorClass,
    dmHitResult: input.replacement.dmHitResult,
  };
  const preview = calculateAttackPreviewFromSnapshot(
    state, replacementInput, attack.profileSnapshot, attack.attackBonusSnapshot,
  );
  if (!preview.ok) return { ok: false, stage: "replacement", reason: preview.reason };
  const contradictsNaturalRule = preview.naturalMiss && input.replacement.dmHitResult === "hit" ||
    preview.critical && input.replacement.dmHitResult === "miss";
  if (contradictsNaturalRule && !input.replacement.dmExceptionConfirmed) {
    return {
      ok: false,
      stage: "replacement",
      reason: "Подтвердите исключение ведущего для натурального результата.",
    };
  }
  if (preview.hitResult == null) {
    return { ok: false, stage: "replacement", reason: "Для замены укажите КД либо явное попадание/промах." };
  }
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
  if (!preview.hitResult) {
    return input.damageRolls.length
      ? { ok: false, stage: "complete", reason: "Промах Seeking Strike не принимает кости урона." }
      : { ok: true, stage: "complete", request: input, replacement, damage: null, parentBasis: basis };
  }
  if (!input.damageRolls.length) {
    return { ok: true, stage: "damage", request: input, replacement, damage: null, parentBasis: basis };
  }
  const damage = calculateAttackDamage(
    attack.profileSnapshot, input.damageRolls, preview.critical,
  );
  return damage.ok
    ? { ok: true, stage: "complete", request: input, replacement, damage, parentBasis: basis }
    : { ok: false, stage: "damage", reason: damage.reason };
}

function completedSeekingParent(state, actionId, attackId) {
  const sequence = state?.monk?.combatAssistant?.activeSequences?.find((entry) =>
    entry.id === actionId);
  return {
    sequence: sequence ?? null,
    attack: sequence?.resolvedAttacks?.find((entry) => entry.id === attackId) ?? null,
  };
}

export function previewCompletedSeekingStrike(state, request) {
  const normalized = normalizeCompletedSeekingRequest(request);
  if (!normalized.ok) return normalized;
  const input = normalized.request;
  const { sequence, attack } = completedSeekingParent(state, input.actionId, input.attackId);
  if (!attack) return { ok: false, reason: "Записанный удар для Seeking Strike не найден." };
  let history;
  try {
    history = readSeekingHistory(attack, { actionId: input.actionId, attackId: input.attackId });
  } catch (error) {
    return { ok: false, reason: `История Seeking Strike противоречива. ${error.message}` };
  }
  return completedSeekingPreviewFromParent(state, input, sequence, attack, history);
}

export function readCompletedSeekingStrikeReceipt(state, operationId) {
  if (typeof operationId !== "string" || !operationId.trim()) return null;
  for (const sequence of state?.monk?.combatAssistant?.activeSequences ?? []) {
    for (const attack of sequence.resolvedAttacks ?? []) {
      const parent = { actionId: sequence.id, attackId: attack.id };
      try {
        const history = readSeekingHistory(attack, parent);
        const invocation = history.find((entry) =>
          entry.completedSeekingOperation?.operationId === operationId);
        if (invocation) return { sequence, attack, invocation, ...invocation.completedSeekingOperation };
      } catch {
        const rawEntries = [
          ...(Array.isArray(attack.seekingAmendments) ? attack.seekingAmendments : []),
          ...(attack.seekingAmendment ? [attack.seekingAmendment] : []),
        ];
        if (rawEntries.some((entry) =>
          entry?.completedSeekingOperation?.operationId === operationId)) {
          return { sequence, attack, malformed: true };
        }
      }
    }
  }
  return null;
}

export function commitCompletedSeekingStrike(context, request, operationId) {
  if (typeof operationId !== "string" || !operationId.trim()) {
    return reject("Для операции требуется стабильный идентификатор.");
  }
  if (!isCurrentSession(context)) return reject("stale-session");
  const normalized = normalizeCompletedSeekingRequest(request);
  if (!normalized.ok) return reject(normalized.reason);
  const input = normalized.request;
  if (input.invocationId !== operationId) {
    return reject("Идентификаторы применения и операции не совпадают.");
  }
  const prior = readCompletedSeekingStrikeReceipt(getState(), operationId);
  if (prior) {
    return !prior.malformed && sameSeekingData(prior.request, input)
      ? { status: "replayed", receipt: prior }
      : reject("operation-collision");
  }
  const allSequences = getState()?.monk?.combatAssistant?.activeSequences ?? [];
  for (const sequence of allSequences) {
    for (const attack of sequence.resolvedAttacks ?? []) {
      const entries = [
        ...(Array.isArray(attack.seekingAmendments) ? attack.seekingAmendments : []),
        ...(attack.seekingAmendment ? [attack.seekingAmendment] : []),
      ];
      if (sequence.id !== input.actionId || attack.id !== input.attackId) {
        if (entries.some((entry) => entry?.id === input.invocationId ||
            entry?.paidOperationId === input.invocationId ||
            entry?.resolutionOperationId === operationId ||
            entry?.completedSeekingOperation?.operationId === operationId)) {
          return reject("Идентификатор Seeking Strike уже использован для другого родителя.");
        }
      }
      if (entries.some((entry) => entry?.resolutionOperationId === operationId)) {
        return reject("operation-collision");
      }
    }
  }
  const preview = previewCompletedSeekingStrike(getState(), input);
  if (!preview.ok || preview.stage !== "complete") {
    return reject(preview.reason ?? "Завершённый результат Seeking Strike не готов.");
  }
  let receipt;
  return commit(context, operationId, {
    kind: "sara-completed-seeking-strike",
    actionId: input.actionId,
    attackId: input.attackId,
    invocationId: input.invocationId,
  }, (draft) => {
    const { sequence, attack } = completedSeekingParent(draft, input.actionId, input.attackId);
    let history;
    try {
      history = attack
        ? readSeekingHistory(attack, { actionId: input.actionId, attackId: input.attackId })
        : [];
    } catch (error) {
      throw new Error(`История Seeking Strike противоречива. ${error.message}`);
    }
    const fresh = completedSeekingPreviewFromParent(draft, input, sequence, attack, history);
    if (!fresh.ok || fresh.stage !== "complete") {
      throw new Error(fresh.reason ?? "Завершённый результат Seeking Strike не готов.");
    }
    if (history.some((entry) => entry.id === input.invocationId ||
        entry.paidOperationId === input.invocationId)) {
      throw new Error("Идентификатор применения Seeking Strike уже использован.");
    }
    draft.combat.ki.current = Number(draft.combat.ki.current) - 1;
    const original = {
      rawD20Rolls: structuredClone(attack.rawD20Rolls),
      rollMode: attack.rollMode,
      chosenD20: attack.chosenD20,
      attackTotal: attack.attackTotal,
      attackBonusSnapshot: attack.attackBonusSnapshot,
      hitResult: attack.hitResult,
      critical: attack.critical,
      hitResolutionSource: attack.hitResolutionSource,
    };
    const replacement = {
      ...fresh.replacement,
      damageRolls: fresh.damage?.damageRolls ?? null,
      damageModifierSnapshot: fresh.damage?.damageModifierSnapshot ?? null,
      damageTotalBeforeTargetModifiers:
        fresh.damage?.damageTotalBeforeTargetModifiers ?? null,
    };
    const resolutionRequest = structuredClone(input);
    history.push({
      id: input.invocationId,
      paidOperationId: input.invocationId,
      parent: { actionId: input.actionId, attackId: input.attackId },
      status: "resolved",
      kiPaid: 1,
      original,
      replacement,
      resolutionOperationId: operationId,
      resolutionRequest,
      completedSeekingOperation: {
        operationId,
        request: structuredClone(input),
        outcome: fresh.replacement.hitResult,
      },
    });
    writeSeekingHistory(attack, history, {
      actionId: input.actionId, attackId: input.attackId,
    });
    attack.rawD20Rolls = structuredClone(fresh.replacement.rawD20Rolls);
    attack.rollMode = fresh.replacement.rollMode;
    attack.chosenD20 = fresh.replacement.chosenD20;
    attack.attackTotal = fresh.replacement.attackTotal;
    attack.attackBonusSnapshot = fresh.replacement.attackBonusSnapshot;
    attack.hitResolutionSource = fresh.replacement.hitResolutionSource;
    attack.hitResult = fresh.replacement.hitResult;
    attack.critical = fresh.replacement.critical;
    attack.damageRolls = fresh.damage?.damageRolls ?? null;
    attack.damageModifierSnapshot = fresh.damage?.damageModifierSnapshot ?? null;
    attack.damageTotalBeforeTargetModifiers =
      fresh.damage?.damageTotalBeforeTargetModifiers ?? null;
    attack.damageStatus = fresh.replacement.hitResult === "hit" ? "recorded" : "not-applicable";
    attack.techniqueApplicationId = null;
    attack.historicalResolution = false;
    closeRestWindow(draft, "seeking-strike-completed");
    receipt = { actionId: sequence.id, attackId: attack.id, outcome: attack.hitResult };
    pruneCombatHistory(draft.monk.combatAssistant, draft);
    return draft;
  }, (current) => {
    const currentPreview = previewCompletedSeekingStrike(current, input);
    return currentPreview.ok && currentPreview.stage === "complete"
      ? null : currentPreview.reason ?? "Завершённый результат Seeking Strike не готов.";
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

function normalizeCompletedGentlingTouchRequest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "Запрос Gentling Touch имеет неверный формат." };
  }
  const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
  if (!nonempty(raw.sequenceId) || raw.sequenceKind !== "attack-action" ||
      !(raw.battleId === null || nonempty(raw.battleId)) ||
      !["waiting", "own-turn"].includes(raw.phaseAtOpen) ||
      !(raw.ownTurnId === null || nonempty(raw.ownTurnId)) ||
      typeof raw.expectedSequenceExists !== "boolean" ||
      typeof raw.confirmSeparateAction !== "boolean" ||
      !nonempty(raw.expectedMechanicsBasis)) {
    return { ok: false, reason: "Идентификаторы или контекст Gentling Touch недопустимы." };
  }
  let turnMarker;
  let expectedUsedSlots;
  let extraKi;
  let targetHp;
  let sum;
  try {
    turnMarker = integer(raw.turnMarker, 0);
    expectedUsedSlots = integer(raw.expectedUsedSlots, 0);
    for (const key of ["extraKi", "targetHp", "sum"]) {
      if (raw[key] === null || raw[key] === undefined ||
          typeof raw[key] === "string" && raw[key].trim() === "") {
        throw new Error("Missing physical input.");
      }
    }
    extraKi = integer(raw.extraKi, 0);
    targetHp = integer(raw.targetHp, 0);
    sum = integer(raw.sum, 0);
  } catch {
    return { ok: false, reason: "Gentling Touch требует целые значения ци, HP цели и физической суммы." };
  }
  return {
    ok: true,
    request: {
      sequenceId: raw.sequenceId.trim(),
      sequenceKind: "attack-action",
      battleId: raw.battleId?.trim() ?? null,
      phaseAtOpen: raw.phaseAtOpen,
      ownTurnId: raw.ownTurnId?.trim() ?? null,
      turnMarker,
      expectedSequenceExists: raw.expectedSequenceExists,
      expectedUsedSlots,
      expectedMechanicsBasis: raw.expectedMechanicsBasis,
      confirmSeparateAction: raw.confirmSeparateAction,
      extraKi,
      targetHp,
      sum,
    },
  };
}

export function buildGentlingMechanicsBasis(state, sequenceOrNull = null) {
  const derived = getDerivedStats(state);
  const sequence = sequenceOrNull;
  const basis = {
    martialDieSides: derived.monk.martialDieSides,
    wisdomModifier: derived.abilityModifiers.wisdom,
    derivedAttackCount: getSaraAttackCount(state),
    sequenceMaximumAttacks: sequence?.maximumAttacks ?? getSaraAttackCount(state),
    unpaidActionContext: !sequence || sequence.actionFlagApplied !== true
      ? { actionUsed: state.ui?.turn?.actionUsed === true }
      : null,
  };
  return JSON.stringify(basis);
}

function completedGentlingReceiptFromState(state, operationId) {
  const matches = [];
  for (const sequence of state?.monk?.combatAssistant?.activeSequences ?? []) {
    for (const result of sequence.replacementResults ?? []) {
      const evidence = result.completedGentlingOperation;
      if (result.operationId === operationId || result.id === operationId ||
          evidence?.operationId === operationId) matches.push({ sequence, result, evidence });
    }
  }
  if (!matches.length) return null;
  if (matches.length !== 1) {
    return { conflict: true, reason: "ambiguous-completed-gentling-receipt" };
  }
  const { sequence, result, evidence } = matches[0];
  if (!evidence || evidence.operationId !== operationId ||
      result.operationId !== operationId || result.id !== operationId ||
      result.kind !== "gentling-touch" || sequence.id !== evidence.request?.sequenceId ||
      result.slotNumber !== evidence.request?.expectedUsedSlots + 1 ||
      !Number.isInteger(evidence.request?.expectedUsedSlots) ||
      evidence.request?.sequenceKind !== "attack-action" ||
      evidence.outcome?.operationId !== operationId ||
      evidence.outcome?.slotNumber !== result.slotNumber ||
      evidence.outcome?.cost !== result.cost ||
      evidence.outcome?.dice !== result.dice ||
      evidence.outcome?.sides !== result.sides ||
      evidence.outcome?.sum !== result.sum ||
      evidence.outcome?.targetHp !== result.targetHp ||
      evidence.outcome?.thresholdMet !== result.thresholdMet ||
      result.cost !== 1 + evidence.request?.extraKi ||
      result.dice !== 5 + evidence.request?.extraKi ||
      result.sum !== evidence.request?.sum ||
      result.targetHp !== evidence.request?.targetHp ||
      result.thresholdMet !== (result.targetHp <= result.sum) ||
      result.sides < 1 || result.sum < result.dice ||
      result.sum > result.dice * result.sides) {
    return { conflict: true, reason: "malformed-completed-gentling-receipt" };
  }
  const normalized = normalizeCompletedGentlingTouchRequest(evidence.request);
  if (!normalized.ok || JSON.stringify(normalized.request) !== JSON.stringify(evidence.request)) {
    return { conflict: true, reason: "malformed-completed-gentling-request" };
  }
  return { sequence, result, ...evidence };
}

export function readCompletedGentlingTouchReceipt(state, operationId) {
  return typeof operationId === "string" && operationId.trim()
    ? completedGentlingReceiptFromState(state, operationId) : null;
}

export function previewCompletedGentlingTouch(state, raw) {
  const normalized = normalizeCompletedGentlingTouchRequest(raw);
  if (!normalized.ok) return { ...normalized, stage: "input", code: "invalid-input" };
  const request = normalized.request;
  const sequences = state?.monk?.combatAssistant?.activeSequences ?? [];
  const sequenceMatches = sequences.filter((entry) => entry.id === request.sequenceId);
  const sequence = sequenceMatches[0] ?? null;
  if (!isSara(state) || !getEffectiveSelectedTechniqueIds(state).has("ll-monk:gentling-touch")) {
    return { ok: false, stage: "context", code: "unavailable", reason: "Gentling Touch сейчас недоступен." };
  }
  const battle = state.battleConsole?.current ?? null;
  const phaseAtOpen = battle?.phase ?? "waiting";
  const ownTurnId = battle?.phase === "own-turn" ? battle.ownTurnId : null;
  if (validateBattleActionPhase(state, "attack-action") ||
      (battle?.id ?? null) !== request.battleId ||
      phaseAtOpen !== request.phaseAtOpen || ownTurnId !== request.ownTurnId ||
      Number(state.ui?.turn?.turnNumber ?? 1) !== request.turnMarker) {
    return { ok: false, stage: "context", code: "stale-context", reason: "Контекст хода или боя изменился." };
  }
  if (request.expectedSequenceExists) {
    if (sequenceMatches.length !== 1 || !sequence ||
        sequence.kind !== "attack-action" || sequence.status !== "open" ||
        sequence.battleId !== request.battleId || sequence.ownTurnId !== request.ownTurnId ||
        Number(sequence.turnMarker) !== request.turnMarker ||
        getUsedAttackSlots(sequence) !== request.expectedUsedSlots ||
        request.expectedUsedSlots >= sequence.maximumAttacks) {
      return { ok: false, stage: "context", code: "stale-slot", reason: "Последовательность или ожидаемый слот Gentling Touch устарели." };
    }
  } else if (sequenceMatches.length || request.expectedUsedSlots !== 0 ||
      sequences.some((entry) => entry.status === "open" &&
        !mayRunAlongside("attack-action", entry.kind))) {
    return { ok: false, stage: "context", code: "sequence-conflict", reason: "Нельзя начать новую последовательность Attack." };
  }
  if ((!sequence || sequence.actionFlagApplied !== true) &&
      state.ui?.turn?.actionUsed === true && !request.confirmSeparateAction) {
    return { ok: false, stage: "context", code: "action-confirmation", reason: "Подтвердите отдельное действие Attack." };
  }
  const mechanicsBasis = buildGentlingMechanicsBasis(state, sequence);
  if (mechanicsBasis !== request.expectedMechanicsBasis) {
    return { ok: false, stage: "context", code: "revalidation-required", reason: "Параметры Gentling Touch изменились. Начните новый ввод." };
  }
  let result;
  try {
    result = gentlingPreview({
      extraKi: request.extraKi,
      targetHp: request.targetHp,
      sum: request.sum,
      martialDieSides: getDerivedStats(state).monk.martialDieSides,
      wisdomModifier: getDerivedStats(state).abilityModifiers.wisdom,
    });
  } catch {
    return { ok: false, stage: "input", code: "invalid-input", reason: "Проверьте значения ци, HP и физической суммы." };
  }
  const ki = Number(state.combat?.ki?.current);
  if (!Number.isInteger(ki) || ki < result.cost) {
    return { ok: false, stage: "resource", code: "insufficient-ki", reason: `Недостаточно ци для Gentling Touch (требуется ${result.cost}).` };
  }
  return {
    ok: true,
    stage: "complete",
    request,
    slotNumber: request.expectedUsedSlots + 1,
    createsSequence: !request.expectedSequenceExists,
    mechanicsBasis,
    result,
  };
}

export function commitCompletedGentlingTouch(context, raw, operationId) {
  if (typeof operationId !== "string" || !operationId.trim()) {
    return reject("Для операции требуется стабильный идентификатор.");
  }
  if (!isCurrentSession(context)) return reject("stale-session");
  const normalized = normalizeCompletedGentlingTouchRequest(raw);
  if (!normalized.ok) return reject(normalized.reason);
  const request = normalized.request;
  const prior = readCompletedGentlingTouchReceipt(getState(), operationId);
  if (prior?.conflict) return reject("operation-collision");
  if (prior) {
    return JSON.stringify(prior.request) === JSON.stringify(request)
      ? { status: "replayed", receipt: prior }
      : reject("operation-collision");
  }
  if ((getState().monk?.combatAssistant?.activeSequences ?? []).some((sequence) =>
    (sequence.replacementResults ?? []).some((entry) =>
      entry.operationId === operationId || entry.id === operationId))) {
    return reject("operation-collision");
  }
  const initial = previewCompletedGentlingTouch(getState(), request);
  if (!initial.ok) return reject(initial.reason);
  let receipt = null;
  return commit(context, operationId, {
    kind: "sara-completed-gentling-touch",
    sequenceId: request.sequenceId,
    expectedUsedSlots: request.expectedUsedSlots,
  }, (draft) => {
    const fresh = previewCompletedGentlingTouch(draft, request);
    if (!fresh.ok || fresh.stage !== "complete") {
      throw new Error(fresh.reason ?? "Gentling Touch result is not ready.");
    }
    const assistant = ensureCombatAssistant(draft);
    let sequence = assistant.activeSequences.find((entry) =>
      entry.id === request.sequenceId);
    if (fresh.createsSequence) {
      if (sequence || assistant.activeSequences.some((entry) => entry.status === "open" &&
          !mayRunAlongside("attack-action", entry.kind))) {
        throw new Error("Нельзя создать последовательность Gentling Touch.");
      }
      sequence = createSequenceRecord(draft, request.sequenceId, "attack-action");
      assistant.activeSequences.push(sequence);
    }
    if (!sequence || sequence.kind !== "attack-action" ||
        sequence.status !== "open" ||
        getUsedAttackSlots(sequence) !== request.expectedUsedSlots ||
        fresh.slotNumber !== getUsedAttackSlots(sequence) + 1) {
      throw new Error("Ожидаемый слот Gentling Touch устарел.");
    }
    const ki = Number(draft.combat?.ki?.current);
    if (!Number.isInteger(ki) || ki < fresh.result.cost) {
      throw new Error("Недостаточно ци для Gentling Touch.");
    }
    draft.combat.ki.current = ki - fresh.result.cost;
    sequence.replacementResults ??= [];
    const entry = {
      id: operationId,
      operationId,
      kind: "gentling-touch",
      slotNumber: fresh.slotNumber,
      request: {
        extraKi: request.extraKi,
        targetHp: request.targetHp,
        sum: request.sum,
      },
      ...fresh.result,
      completedGentlingOperation: {
        operationId,
        request: structuredClone(request),
        outcome: { operationId, slotNumber: fresh.slotNumber, ...fresh.result },
      },
    };
    sequence.replacementResults.push(entry);
    if (!sequence.actionFlagApplied) {
      draft.ui.turn.actionUsed = true;
      sequence.actionFlagApplied = true;
    }
    sequence.status = getUsedAttackSlots(sequence) >= sequence.maximumAttacks
      ? "complete" : "open";
    closeRestWindow(draft, "gentling-touch-completed");
    pruneCombatHistory(assistant, draft);
    receipt = { sequenceId: sequence.id, operationId, slotNumber: entry.slotNumber };
    return draft;
  }, (current) => {
    const currentPreview = previewCompletedGentlingTouch(current, request);
    return currentPreview.ok && currentPreview.stage === "complete"
      ? null : currentPreview.reason ?? "Завершённый Gentling Touch не готов.";
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
      pruneCombatHistory(assistant, draft);
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
