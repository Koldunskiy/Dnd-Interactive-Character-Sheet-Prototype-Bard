import { parsePhysicalInteger } from "../combat/physical-input.js";
import { BATTLE_HISTORY_LIMIT, getBattleConsole } from "./model.js";
import { getSaraInitiativeSnapshot } from "./providers/sara.js";

let battleSequence = 0;
let ownTurnSequence = 0;

function reject(reason) {
  return { ok: false, reason };
}

function getCurrent(character) {
  return getBattleConsole(character).current;
}

function closeUnusedAttacks(character) {
  const sequences = character.monk?.combatAssistant?.activeSequences;
  if (!Array.isArray(sequences)) return;
  for (const sequence of sequences) {
    if (sequence?.turnMarker !== Number(character.ui?.turn?.turnNumber) ||
        sequence.status !== "open") continue;
    sequence.status = sequence.resolvedAttacks?.length ? "abandoned" : "closed";
    sequence.closedReason = "turn-ended";
  }
}

function invalidateTurnContinuations(character, ownTurnId) {
  const runtime = character.monk?.techniqueRuntime;
  if (!runtime) return;
  for (const entry of Object.values(runtime)) {
    if (entry && typeof entry === "object" &&
        (entry.ownTurnId === ownTurnId || entry.turnMarker === Number(character.ui?.turn?.turnNumber))) {
      if (entry.status === "pending") {
        entry.status = "expired";
        entry.expiredReason = "turn-ended";
      }
    }
  }
  if (runtime.deflectContinuation) runtime.deflectContinuation = null;
}

function closeAllOpenAttacks(character, reason) {
  const sequences = character.monk?.combatAssistant?.activeSequences;
  if (!Array.isArray(sequences)) return;
  for (const sequence of sequences) {
    if (sequence?.status !== "open") continue;
    sequence.status = sequence.resolvedAttacks?.length ? "abandoned" : "closed";
    sequence.closedReason = reason;
  }
}

function archiveCurrent(character, reason) {
  const state = getBattleConsole(character);
  if (!state.current) return;
  state.current.phase = "ended";
  state.current.endedReason = reason;
  state.current.endedAt = new Date().toISOString();
  state.history = [...(Array.isArray(state.history) ? state.history : []), state.current]
    .slice(-BATTLE_HISTORY_LIMIT);
  state.current = null;
  character.battleConsole = state;
}

export function startBattle(character, input, { id = null, now = new Date().toISOString() } = {}) {
  const existing = getCurrent(character);
  if (existing && existing.phase !== "ended") return reject("Сначала завершите текущую сцену боя.");
  const raw = parsePhysicalInteger(input?.rawD20, 1, 20, "Инициатива к20");
  if (!raw.ok) return raw;
  const initiativeSnapshot = getSaraInitiativeSnapshot(character);
  if (!initiativeSnapshot.ok) return reject(initiativeSnapshot.reason);
  const initiativeSources = initiativeSnapshot.sources;
  closeAllOpenAttacks(character, "battle-started");
  if (character.monk?.techniqueRuntime?.deflectContinuation) {
    character.monk.techniqueRuntime.deflectContinuation = null;
  }
  const battleId = id ?? `battle-${Date.now()}-${++battleSequence}`;
  const battleConsole = getBattleConsole(character);
  battleConsole.current = {
    id: battleId,
    phase: "waiting",
    phaseBeforePause: null,
    startedAt: now,
    initiative: {
      rawD20: raw.value,
      sources: initiativeSources,
      total: raw.value + initiativeSources.reduce((sum, source) => sum + source.value, 0),
    },
    ownTurnNumber: 0,
    ownTurnId: null,
    events: [],
  };
  character.battleConsole = battleConsole;
  return { ok: true, battleId, initiative: character.battleConsole.current.initiative };
}

export function correctInitiative(character, input) {
  const battle = getCurrent(character);
  if (!battle || battle.phase === "ended") return reject("Нет активной сцены боя.");
  const raw = parsePhysicalInteger(input?.rawD20, 1, 20, "Инициатива к20");
  if (!raw.ok) return raw;
  battle.initiative = {
    ...battle.initiative,
    rawD20: raw.value,
    total: raw.value + battle.initiative.sources.reduce((sum, source) => sum + source.value, 0),
    correctedAt: new Date().toISOString(),
  };
  return { ok: true, initiative: battle.initiative };
}

export function beginOwnTurn(character, { now = new Date().toISOString(), id = null } = {}) {
  const battle = getCurrent(character);
  if (!battle || battle.phase !== "waiting") {
    return reject("Начать свой ход можно только в ожидании.");
  }
  const ownTurnId = id ?? `turn-${Date.now()}-${++ownTurnSequence}`;
  battle.phase = "own-turn";
  battle.ownTurnNumber += 1;
  battle.ownTurnId = ownTurnId;
  battle.ownTurnStartedAt = now;
  const turn = character.ui.turn;
  turn.actionUsed = false;
  turn.bonusActionUsed = false;
  turn.reactionUsed = false;
  turn.turnNumber = battle.ownTurnNumber;
  for (const runtime of Object.values(character.monk?.techniqueRuntime ?? {})) {
    if (runtime && typeof runtime === "object") delete runtime.usedThisTurn;
  }
  if (character.monk?.techniqueRuntime) {
    delete character.monk.techniqueRuntime.practicedUsedThisTurn;
    character.monk.techniqueRuntime.deflectContinuation = null;
  }
  return { ok: true, ownTurnId, ownTurnNumber: battle.ownTurnNumber };
}

export function endOwnTurn(character, { now = new Date().toISOString() } = {}) {
  const battle = getCurrent(character);
  if (!battle || battle.phase !== "own-turn") return reject("Сейчас не идёт ваш ход.");
  closeUnusedAttacks(character);
  invalidateTurnContinuations(character, battle.ownTurnId);
  battle.phase = "waiting";
  battle.ownTurnEndedAt = now;
  battle.ownTurnId = null;
  return { ok: true };
}

export function pauseBattle(character) {
  const battle = getCurrent(character);
  if (!battle || !["waiting", "own-turn"].includes(battle.phase)) {
    return reject("Приостановить можно только активную сцену боя.");
  }
  battle.phaseBeforePause = battle.phase;
  battle.phase = "paused";
  return { ok: true };
}

export function resumeBattle(character) {
  const battle = getCurrent(character);
  if (!battle || battle.phase !== "paused" ||
      !["waiting", "own-turn"].includes(battle.phaseBeforePause)) {
    return reject("Нет приостановленной сцены боя.");
  }
  battle.phase = battle.phaseBeforePause;
  battle.phaseBeforePause = null;
  return { ok: true };
}

export function endBattle(character, reason = "manual") {
  const battle = getCurrent(character);
  if (!battle) return reject("Нет активной сцены боя.");
  if (battle.phase === "own-turn" ||
      battle.phase === "paused" && battle.phaseBeforePause === "own-turn") {
    invalidateTurnContinuations(character, battle.ownTurnId);
  }
  closeAllOpenAttacks(character, "battle-ended");
  if (character.monk?.techniqueRuntime?.deflectContinuation) {
    character.monk.techniqueRuntime.deflectContinuation = null;
  }
  character.ui.turn.actionUsed = true;
  character.ui.turn.bonusActionUsed = true;
  character.ui.turn.reactionUsed = true;
  archiveCurrent(character, reason);
  return { ok: true };
}

export function closeBattleForRest(character, reason = "rest") {
  const battle = getCurrent(character);
  if (!battle) return { ok: true, changed: false };
  if (battle.phase === "own-turn" ||
      battle.phase === "paused" && battle.phaseBeforePause === "own-turn") {
    invalidateTurnContinuations(character, battle.ownTurnId);
  }
  closeAllOpenAttacks(character, reason);
  if (character.monk?.techniqueRuntime?.deflectContinuation) {
    character.monk.techniqueRuntime.deflectContinuation = null;
  }
  archiveCurrent(character, reason);
  return { ok: true, changed: true };
}
