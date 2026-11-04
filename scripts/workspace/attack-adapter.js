import { getDerivedStats } from "../calculations.js";
import {
  closeAttackSequence,
  commitCompletedNormalAttack,
  getSaraAttackCount,
  markAttackDamageOutside,
  previewCompletedNormalAttack,
  readCompletedNormalAttackReceipt,
  recordAttackDamage,
  recordAttackOutcome,
} from "../actions/sara-combat.js";
import { calculateAttackDamage, calculateAttackPreview } from "../combat/sara-combat.js";
import { getSessionContext, getState, isCurrentSession } from "../state.js";

export { getSaraAttackCount };

export function getWorkspaceAttackContext() {
  return getSessionContext();
}

export function isWorkspaceOwnerCurrent(owner) {
  return isCurrentSession(owner) && getState().profile?.id === owner.characterId;
}

export function getNormalAttackSequence(state, sequenceId) {
  return (state.monk?.combatAssistant?.activeSequences ?? []).find((sequence) =>
    sequence.id === sequenceId && sequence.kind === "attack-action") ?? null;
}

export function getWorkspaceAttackSequence(state, sequenceId) {
  return (state.monk?.combatAssistant?.activeSequences ?? []).find((sequence) =>
    sequence.id === sequenceId &&
    ["attack-action", "flurry", "bonus-unarmed", "reaction-unarmed", "returned-projectile"]
      .includes(sequence.kind)) ?? null;
}

export function getCurrentWorkspaceStrikeParent(state, sequenceId, attackId) {
  const sequence = getWorkspaceAttackSequence(state, sequenceId);
  const attack = sequence?.resolvedAttacks?.find((entry) => entry.id === attackId);
  if (!sequence || !attack || attack.hitResult !== "hit" ||
      !(attack.profileId === "unarmed" ||
        attack.profileSnapshot?.attackKind === "weapon" &&
        attack.profileSnapshot?.melee === true &&
        attack.profileSnapshot?.martialArtsEligible === true) ||
      !["recorded", "recorded-outside-app"].includes(attack.damageStatus) ||
      attack.techniqueApplicationId ||
      attack.historicalResolution ||
      !["open", "complete"].includes(sequence.status) ||
      Number(sequence.turnMarker) !== Number(state.ui?.turn?.turnNumber ?? 1)) return null;
  const battle = state.battleConsole?.current;
  const reactionParent = ["reaction-unarmed", "returned-projectile"].includes(sequence.kind);
  if (sequence.battleId && sequence.battleId !== battle?.id) return null;
  if (battle && (battle.phase === "paused" || battle.phase === "ended" ||
      reactionParent && !["waiting", "own-turn"].includes(battle.phase) ||
      !reactionParent && battle.phase !== "own-turn" ||
      sequence.ownTurnId && sequence.ownTurnId !== battle.ownTurnId)) return null;
  return { sequence, attack };
}

export function findAwaitingNormalDamage(state, { sequenceId = null, attackId = null } = {}) {
  const sequences = state.monk?.combatAssistant?.activeSequences ?? [];
  for (const sequence of sequences) {
    if (sequence.kind !== "attack-action" ||
        sequenceId && sequence.id !== sequenceId) continue;
    const attack = (sequence.resolvedAttacks ?? []).find((entry) =>
      entry.damageStatus === "awaiting-damage" &&
      (!attackId || entry.id === attackId));
    if (attack) return { sequence, attack };
  }
  return null;
}

export function findAwaitingWorkspaceDamage(state, { sequenceId = null, attackId = null } = {}) {
  const sequences = state.monk?.combatAssistant?.activeSequences ?? [];
  for (const sequence of sequences) {
    if (!["attack-action", "flurry", "bonus-unarmed", "reaction-unarmed", "returned-projectile"]
      .includes(sequence.kind) || sequenceId && sequence.id !== sequenceId) continue;
    const attack = (sequence.resolvedAttacks ?? []).find((entry) =>
      entry.damageStatus === "awaiting-damage" &&
      (!attackId || entry.id === attackId));
    if (attack) return { sequence, attack };
  }
  return null;
}

export function getNormalAttackFingerprint(state, sequenceId, isFirstAttempt) {
  const derived = getDerivedStats(state);
  const sequence = getNormalAttackSequence(state, sequenceId);
  const battle = state.battleConsole?.current;
  return JSON.stringify({
    profiles: derived.saraAttackProfiles,
    maximumAttacks: sequence?.maximumAttacks ?? getSaraAttackCount(state),
    sequence: sequence ? {
      id: sequence.id,
      kind: sequence.kind,
      status: sequence.status,
      turnMarker: sequence.turnMarker,
      battleId: sequence.battleId,
      ownTurnId: sequence.ownTurnId,
      resolvedAttackIds: sequence.resolvedAttacks.map((attack) => attack.id),
    } : null,
    turnNumber: state.ui?.turn?.turnNumber,
    battle: battle ? {
      id: battle.id,
      phase: battle.phase,
      ownTurnId: battle.ownTurnId,
    } : null,
    ...(isFirstAttempt && !sequence ? { actionUsed: state.ui?.turn?.actionUsed === true } : {}),
  });
}

export function getWorkspaceAttackFingerprint(state, sequenceId, kind, isFirstAttempt) {
  const derived = getDerivedStats(state);
  const sequence = getWorkspaceAttackSequence(state, sequenceId);
  const battle = state.battleConsole?.current;
  return JSON.stringify({
    kind,
    profiles: derived.saraAttackProfiles,
    sequence: sequence ? {
      id: sequence.id,
      kind: sequence.kind,
      status: sequence.status,
      maximumAttacks: sequence.maximumAttacks,
      turnMarker: sequence.turnMarker,
      battleId: sequence.battleId,
      ownTurnId: sequence.ownTurnId,
      resolvedAttackIds: sequence.resolvedAttacks.map((attack) => attack.id),
    } : null,
    turnNumber: state.ui?.turn?.turnNumber,
    battle: battle ? { id: battle.id, phase: battle.phase, ownTurnId: battle.ownTurnId } : null,
    ...(isFirstAttempt && !sequence ? {
      actionUsed: state.ui?.turn?.actionUsed === true,
      bonusActionUsed: state.ui?.turn?.bonusActionUsed === true,
      reactionUsed: state.ui?.turn?.reactionUsed === true,
    } : {}),
  });
}

export function calculateWorkspaceAttackPreview(state, input) {
  return calculateAttackPreview(state, { ...input, profileId: input.profileId ?? "unarmed" });
}

export function calculateWorkspaceDamagePreview(profile, rolls, critical) {
  return calculateAttackDamage(profile, rolls, critical);
}

export function previewWorkspaceCompletedNormalAttack(state, request) {
  return previewCompletedNormalAttack(state, request);
}

export function submitWorkspaceCompletedNormalAttack(owner, request, operationId) {
  if (!isWorkspaceOwnerCurrent(owner)) return { status: "rejected", reason: "stale-session" };
  return commitCompletedNormalAttack(getWorkspaceAttackContext(), request, operationId);
}

export function readWorkspaceCompletedNormalAttackReceipt(state, operationId) {
  return readCompletedNormalAttackReceipt(state, operationId);
}

export function submitWorkspaceAttack(owner, sequenceId, attackId, input, operationId) {
  if (!isWorkspaceOwnerCurrent(owner)) return { status: "rejected", reason: "stale-session" };
  return recordAttackOutcome(
    getWorkspaceAttackContext(),
    sequenceId,
    attackId,
    { ...input, kind: "attack-action", profileId: input.profileId ?? "unarmed" },
    operationId,
  );
}

export function submitWorkspaceSequenceAttack(owner, sequenceId, attackId, kind, input, operationId) {
  if (!isWorkspaceOwnerCurrent(owner)) return { status: "rejected", reason: "stale-session" };
  return recordAttackOutcome(
    getWorkspaceAttackContext(),
    sequenceId,
    attackId,
    { ...input, kind, profileId: input.profileId ?? "unarmed" },
    operationId,
  );
}

export function submitWorkspaceDamage(owner, sequenceId, attackId, rolls, operationId) {
  if (!isWorkspaceOwnerCurrent(owner)) return { status: "rejected", reason: "stale-session" };
  return recordAttackDamage(
    getWorkspaceAttackContext(),
    sequenceId,
    attackId,
    rolls,
    operationId,
  );
}

export function markWorkspaceDamageOutside(owner, sequenceId, attackId, operationId) {
  if (!isWorkspaceOwnerCurrent(owner)) return { status: "rejected", reason: "stale-session" };
  return markAttackDamageOutside(
    getWorkspaceAttackContext(),
    sequenceId,
    attackId,
    operationId,
  );
}

export function abandonWorkspaceSequence(owner, sequenceId, operationId) {
  if (!isWorkspaceOwnerCurrent(owner)) return { status: "rejected", reason: "stale-session" };
  return closeAttackSequence(getWorkspaceAttackContext(), sequenceId, operationId);
}
