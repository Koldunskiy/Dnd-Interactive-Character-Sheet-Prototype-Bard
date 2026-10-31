export const BATTLE_PHASES = Object.freeze([
  "waiting",
  "own-turn",
  "paused",
  "ended",
]);

export const BATTLE_HISTORY_LIMIT = 20;

export function getBattleConsole(character) {
  const value = character?.battleConsole;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { current: null, history: [] };
  }
  if ((value.current == null || typeof value.current === "object" && !Array.isArray(value.current)) &&
      Array.isArray(value.history)) {
    return value;
  }
  return {
    ...value,
    current: null,
    history: Array.isArray(value.history) ? value.history : [],
  };
}

export function getActiveBattle(character) {
  const battle = getBattleConsole(character).current;
  return battle && battle.phase !== "ended" ? battle : null;
}

export function getActionBudget(character) {
  const turn = character?.ui?.turn ?? {};
  return {
    actionAvailable: turn.actionUsed !== true,
    bonusActionAvailable: turn.bonusActionUsed !== true,
    reactionAvailable: turn.reactionUsed !== true,
  };
}
