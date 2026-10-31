import { getSessionContext, getState, updateSessionState } from "../state.js";
import {
  beginOwnTurn,
  correctInitiative,
  closeBattleForRest,
  endBattle,
  endOwnTurn,
  pauseBattle,
  resumeBattle,
  startBattle,
} from "./transitions.js";

const transitions = {
  "start-battle": (draft, input) => startBattle(draft, input),
  "correct-initiative": (draft, input) => correctInitiative(draft, input),
  "begin-own-turn": (draft) => beginOwnTurn(draft),
  "end-own-turn": (draft) => endOwnTurn(draft),
  "pause-battle": (draft) => pauseBattle(draft),
  "resume-battle": (draft) => resumeBattle(draft),
  "end-battle": (draft) => endBattle(draft),
};

export function executeBattleCommand(command, input = {}) {
  const character = getState();
  if (character?.profile?.id !== "sara-velaris") {
    return { status: "rejected", reason: "Боевой журнал для этого персонажа не подключён." };
  }
  const transition = transitions[command];
  if (!transition) return { status: "rejected", reason: "Неизвестная команда боя." };
  const context = getSessionContext();
  let transitionResult = null;
  const result = updateSessionState(context, (draft) => {
    transitionResult = transition(draft, input);
    if (!transitionResult.ok) return false;
    return draft;
  }, { metadata: { kind: "battle-command", command } });
  if (transitionResult && !transitionResult.ok) {
    return { status: "rejected", reason: transitionResult.reason };
  }
  return result.status === "applied"
    ? { ...result, ...transitionResult }
    : result;
}

export function executeBattleBoundaryInDraft(character, reason) {
  if (character?.profile?.id !== "sara-velaris") return { ok: true, changed: false };
  const active = character.battleConsole?.current;
  if (!active) return { ok: true, changed: false };
  const result = closeBattleForRest(character, reason);
  character.ui.turn.actionUsed = true;
  character.ui.turn.bonusActionUsed = true;
  character.ui.turn.reactionUsed = true;
  return result;
}
