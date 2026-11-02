import { getActiveBattle, getActionBudget } from "./model.js";
import { getSaraBattleCommandRegistry } from "./command-registry.js";
import { isRollConsequencePending } from "../rolls/commands.js";

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

export function getOwnTurnContinuationTasks(character) {
  if (getPlayerScenePhase(character) !== "own-turn") return [];
  const battle = getActiveBattle(character);
  const turnNumber = Number(character.ui?.turn?.turnNumber ?? 1);
  return (character.monk?.combatAssistant?.activeSequences ?? [])
    .filter((sequence) => {
      const remaining = Number(sequence.maximumAttacks) -
        (sequence.resolvedAttacks?.length ?? 0);
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
        (sequence.resolvedAttacks?.length ?? 0)),
      label: sequence.kind === "flurry" ? "Продолжить Шквал ударов"
        : sequence.kind === "attack-action" ? "Продолжить атаку"
          : sequence.kind === "bonus-unarmed" ? "Продолжить бонусный удар"
            : sequence.kind === "returned-projectile" ? "Продолжить возвращённый снаряд"
              : "Продолжить ответный удар",
    }));
}

export function getUnfinishedPlayerWork(character, workspaceSessions = []) {
  const assistant = character.monk?.combatAssistant ?? {};
  const work = [];
  const liveDamageTasks = new Set(workspaceSessions
    .filter((workspace) => workspace.stage === "damage-input" &&
      workspace.sequenceId && workspace.attackId)
    .map((workspace) => `${workspace.sequenceId}:${workspace.attackId}`));
  for (const sequence of assistant.activeSequences ?? []) {
    for (const attack of sequence.resolvedAttacks ?? []) {
      if (attack.damageStatus === "awaiting-damage" &&
          !liveDamageTasks.has(`${sequence.id}:${attack.id}`)) {
        work.push({
          id: `damage:${sequence.id}:${attack.id}`,
          kind: "historical-damage",
          label: "Записать урон по сохранённому попаданию",
          sequenceId: sequence.id,
          attackId: attack.id,
        });
      }
    }
  }
  for (const application of assistant.pendingApplications ?? []) {
    if (!["success", "failure"].includes(application.targetOutcome)) {
      work.push({
        id: `save:${application.id}`,
        kind: "pending-save",
        label: `Записать полученный исход спасброска · СЛ ${application.dc ?? "—"}`,
        commandId: `pending-save:${application.id}`,
      });
    }
  }
  for (const record of character.characterRolls?.records ?? []) {
    if (isRollConsequencePending(record)) {
      work.push({
        id: `roll:${record.id}`,
        kind: "pending-roll",
        label: record.consequence?.status === "awaiting-outcome"
          ? `Указать исход · ${record.label ?? "бросок"}`
          : `Продолжить последствие · ${record.label ?? "бросок"}`,
        commandId: `pending-roll:${record.id}`,
      });
    }
  }
  for (const workspace of workspaceSessions) {
    if (workspace.dirty || workspace.appliedUnsaved ||
        workspace.minimized || workspace.suspended) {
      work.push({
        id: `workspace:${workspace.workspaceSessionId}`,
        kind: "workspace",
        label: workspace.label ?? "Продолжить рабочую панель",
        workspaceSessionId: workspace.workspaceSessionId,
        dirty: workspace.dirty === true,
        appliedUnsaved: workspace.appliedUnsaved === true,
      });
    }
  }
  return work;
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
  for (const workspace of workspaceSessions) {
    if (workspace.dirty) {
      advice.push({
        id: `draft:${workspace.workspaceSessionId}`,
        kind: "draft",
        label: "Есть незавершённый ввод, который станет устаревшим после конца хода",
        workspaceSessionId: workspace.workspaceSessionId,
      });
    }
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
    unfinishedWork: getUnfinishedPlayerWork(character, workspaceSessions),
    endTurnAdvice: getEndTurnAdvice(character, workspaceSessions),
  };
}
