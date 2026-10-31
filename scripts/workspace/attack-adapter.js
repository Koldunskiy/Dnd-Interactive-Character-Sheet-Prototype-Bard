import { getDerivedStats } from "../calculations.js";
import {
  closeAttackSequence,
  getSaraAttackCount,
  markAttackDamageOutside,
  recordAttackDamage,
  recordAttackOutcome,
} from "../actions/sara-combat.js";
import { calculateAttackDamage, calculateAttackPreview } from "../combat/sara-combat.js";
import { getSessionContext, getState, isCurrentSession } from "../state.js";

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

export function getNormalAttackFingerprint(state, sequenceId, isFirstAttempt) {
  const derived = getDerivedStats(state);
  const sequence = getNormalAttackSequence(state, sequenceId);
  const battle = state.battleConsole?.current;
  const profile = derived.saraAttackProfiles?.unarmed;
  return JSON.stringify({
    profile,
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

export function calculateWorkspaceAttackPreview(state, input) {
  return calculateAttackPreview(state, { ...input, profileId: "unarmed" });
}

export function calculateWorkspaceDamagePreview(profile, rolls, critical) {
  return calculateAttackDamage(profile, rolls, critical);
}

export function submitWorkspaceAttack(owner, sequenceId, attackId, input, operationId) {
  if (!isWorkspaceOwnerCurrent(owner)) return { status: "rejected", reason: "stale-session" };
  return recordAttackOutcome(
    getWorkspaceAttackContext(),
    sequenceId,
    attackId,
    { ...input, kind: "attack-action", profileId: "unarmed" },
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
