import test from "node:test";
import assert from "node:assert/strict";
import {
  getState,
  getSessionContext,
  openCharacterSession,
} from "../../scripts/state.js";
import {
  commitCompletedNormalAttack,
  previewCompletedNormalAttack,
  readCompletedNormalAttackReceipt,
} from "../../scripts/actions/sara-combat.js";

const request = (overrides = {}) => ({
  sequenceId: "completed-normal-sequence",
  attackId: "completed-normal-attack",
  battleId: null,
  ownTurnId: null,
  turnMarker: 1,
  expectedUsedSlots: 0,
  attack: {
    profileId: "unarmed",
    rollMode: "normal",
    firstD20: "10",
    secondD20: "",
    targetArmorClass: "",
    dmHitResult: "hit",
    targetLabel: "",
  },
  damageRolls: ["3"],
  ...overrides,
});

test("completed normal hit commits attack, damage, slot and action flag atomically", () => {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const before = getSessionContext().stateRevision;
  const preview = previewCompletedNormalAttack(getState(), request());
  assert.equal(preview.ok, true);
  assert.equal(preview.stage, "complete");
  assert.equal(getSessionContext().stateRevision, before);
  const result = commitCompletedNormalAttack(getSessionContext(), request(), "completed-hit-op");
  assert.equal(result.status, "applied");
  assert.equal(getSessionContext().stateRevision, before + 1);
  const sequence = getState().monk.combatAssistant.activeSequences.find((entry) =>
    entry.id === "completed-normal-sequence");
  assert.equal(sequence.resolvedAttacks.length, 1);
  assert.equal(sequence.resolvedAttacks[0].damageStatus, "recorded");
  assert.equal(sequence.resolvedAttacks[0].damageTotalBeforeTargetModifiers,
    3 + sequence.resolvedAttacks[0].profileSnapshot.damageModifier);
  assert.equal(sequence.resolvedAttacks[0].completedOperation.operationId, "completed-hit-op");
  assert.equal(getState().ui.turn.actionUsed, true);
  assert.equal(readCompletedNormalAttackReceipt(getState(), "completed-hit-op").outcome, "hit");
});

test("completed normal attack rejects invalid hit damage before mutation and commits misses without damage", () => {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const before = getSessionContext().stateRevision;
  const invalid = commitCompletedNormalAttack(
    getSessionContext(), request({ damageRolls: ["99"] }), "invalid-hit-op",
  );
  assert.equal(invalid.status, "rejected");
  assert.equal(getSessionContext().stateRevision, before);
  assert.equal(getState().monk.combatAssistant.activeSequences.length, 0);

  const missRequest = request({
    sequenceId: "completed-miss-sequence",
    attackId: "completed-miss-attack",
    attack: {
      profileId: "unarmed", rollMode: "normal", firstD20: "1",
      targetArmorClass: "", dmHitResult: null,
    },
    damageRolls: [],
  });
  const miss = commitCompletedNormalAttack(getSessionContext(), missRequest, "completed-miss-op");
  assert.equal(miss.status, "applied");
  const attack = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === missRequest.sequenceId).resolvedAttacks[0];
  assert.equal(attack.hitResult, "miss");
  assert.equal(attack.damageStatus, "not-applicable");
  assert.equal(attack.damageRolls, null);
});

test("completed normal operation replay is canonical and rejects request collisions", () => {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const req = request();
  assert.equal(commitCompletedNormalAttack(getSessionContext(), req, "completed-replay-op").status, "applied");
  const revision = getSessionContext().stateRevision;
  assert.equal(commitCompletedNormalAttack(getSessionContext(), req, "completed-replay-op").status, "replayed");
  assert.equal(getSessionContext().stateRevision, revision);
  const collision = commitCompletedNormalAttack(
    getSessionContext(), request({ damageRolls: ["4"] }), "completed-replay-op",
  );
  assert.equal(collision.status, "rejected");
  assert.equal(collision.reason, "operation-collision");
});
