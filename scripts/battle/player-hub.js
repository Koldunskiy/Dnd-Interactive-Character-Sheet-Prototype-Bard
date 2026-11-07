import { getActiveBattle, getActionBudget } from "./model.js";
import { getSaraBattleCommandRegistry } from "./command-registry.js";
import { isRollConsequencePending } from "../rolls/commands.js";
import { getUsedAttackSlots } from "../actions/sara-combat.js";
import { readSeekingHistory } from "../combat/seeking-history.js";

const ATTACK_SEQUENCE_KINDS = new Set([
  "attack-action",
  "flurry",
  "bonus-unarmed",
  "reaction-unarmed",
  "returned-projectile",
]);

export function getPlayerScenePhase(character) {
  const battle = getActiveBattle(character);
  if (!battle) return "outside";
  if (["waiting", "own-turn", "paused"].includes(battle.phase)) return battle.phase;
  return "outside";
}

export function getSavedPlayerRecords(character) {
  const assistant = character?.monk?.combatAssistant ?? {};
  const sequences = (assistant.activeSequences ?? []).map((sequence) => ({
    sequenceId: sequence.id,
    kind: sequence.kind,
    status: sequence.status,
    maximumAttacks: sequence.maximumAttacks,
    usedSlots: getUsedAttackSlots(sequence),
    attacks: (sequence.resolvedAttacks ?? []).map((attack) => {
      let seeking = [];
      let seekingConflict = false;
      if (attack.seekingAmendments !== undefined || attack.seekingAmendment != null) {
        try {
          seeking = readSeekingHistory(attack, {
            actionId: sequence.id,
            attackId: attack.id,
          }).map((entry) => ({
            amendmentId: entry.paidOperationId,
            status: entry.status,
            kiPaid: entry.kiPaid,
            result: entry.replacement ? {
              attackTotal: entry.replacement.attackTotal,
              hitResult: entry.replacement.hitResult,
              critical: entry.replacement.critical,
            } : null,
          }));
        } catch {
          seekingConflict = true;
        }
      }
      return {
        attackId: attack.id,
        slotNumber: attack.slotNumber,
        hitResult: attack.hitResult,
        attackTotal: attack.attackTotal,
        chosenD20: attack.chosenD20,
        critical: attack.critical,
        damageStatus: attack.damageStatus,
        recordedDamage: attack.damageTotalBeforeTargetModifiers ?? null,
        profileSnapshot: attack.profileSnapshot ?? null,
        attackBonusSnapshot: attack.attackBonusSnapshot ?? null,
        seeking,
        seekingConflict,
      };
    }),
    replacementResults: (sequence.replacementResults ?? []).map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      slotNumber: entry.slotNumber,
      sum: entry.sum,
      targetHp: entry.targetHp,
      cost: entry.cost,
      dice: entry.dice,
      sides: entry.sides,
      thresholdMet: entry.thresholdMet,
    })),
  }));
  const applications = (assistant.pendingApplications ?? []).map((application) => ({
    applicationId: application.id,
    parentAttackId: application.parentAttackId,
    techniqueId: application.techniqueId,
    dc: application.dc,
    targetOutcome: application.targetOutcome,
    status: application.status,
  }));
  const rolls = (character?.characterRolls?.records ?? []).map((record) => ({
    rollId: record.id,
    kind: record.kind,
    label: record.label,
    total: record.total,
    chosenD20: record.chosenD20,
    dcResult: record.dcResult,
    outcome: record.outcome ?? record.manualOutcome ?? null,
    consequenceStatus: record.consequence?.status ?? null,
    consequencePending: isRollConsequencePending(record),
  }));
  return { sequences, applications, rolls };
}

export function getOwnTurnContinuationTasks(character) {
  if (getPlayerScenePhase(character) !== "own-turn") return [];
  const battle = getActiveBattle(character);
  const turnNumber = Number(character.ui?.turn?.turnNumber ?? 1);
  return (character.monk?.combatAssistant?.activeSequences ?? [])
    .filter((sequence) => {
      const remaining = Number(sequence.maximumAttacks) - getUsedAttackSlots(sequence);
      return ATTACK_SEQUENCE_KINDS.has(sequence.kind) &&
        sequence.status === "open" && remaining > 0 &&
        Number(sequence.turnMarker) === turnNumber &&
        (!sequence.battleId || sequence.battleId === battle?.id) &&
        (!sequence.ownTurnId || sequence.ownTurnId === battle?.ownTurnId);
    })
    .map((sequence) => ({
      id: sequence.id,
      sequenceId: sequence.id,
      kind: sequence.kind,
      remaining: Math.max(0, Number(sequence.maximumAttacks) -
        getUsedAttackSlots(sequence)),
      label: sequence.kind === "flurry" ? "Продолжить Шквал ударов"
        : sequence.kind === "attack-action" ? "Продолжить атаку"
          : sequence.kind === "bonus-unarmed" ? "Продолжить бонусный удар"
            : sequence.kind === "returned-projectile" ? "Продолжить возвращённый снаряд"
              : "Продолжить ответный удар",
    }));
}

export function getEndTurnAdvice(character, workspaceSessions = []) {
  if (getPlayerScenePhase(character) !== "own-turn") return [];
  const advice = getOwnTurnContinuationTasks(character).map((task) => ({
    id: `sequence:${task.sequenceId}`,
    kind: "sequence",
    label: `${task.label} · осталось ${task.remaining}`,
    sequenceId: task.sequenceId,
  }));
  const budget = getActionBudget(character);
  const commands = getSaraBattleCommandRegistry(character);
  if (budget.actionAvailable && commands.some((entry) =>
    entry.activationBudget === "action" && entry.availability.enabled)) {
    advice.push({
      id: "action",
      kind: "menu",
      label: "Действие ещё доступно",
      menu: "action",
    });
  }
  if (budget.bonusActionAvailable && commands.some((entry) =>
    entry.activationBudget === "bonus-action" && entry.availability.enabled)) {
    advice.push({
      id: "bonus",
      kind: "menu",
      label: "Бонусное действие ещё доступно",
      menu: "bonus",
    });
  }
  return advice;
}

export function getPlayerHubViewModel(character, workspaceSessions = []) {
  const phase = getPlayerScenePhase(character);
  const battle = getActiveBattle(character);
  return {
    phase,
    battle,
    budget: ["waiting", "own-turn"].includes(phase) ? getActionBudget(character) : null,
    continuations: getOwnTurnContinuationTasks(character),
    endTurnAdvice: getEndTurnAdvice(character, workspaceSessions),
  };
}
