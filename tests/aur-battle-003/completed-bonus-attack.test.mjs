import test from "node:test";
import assert from "node:assert/strict";
import {
  getSessionContext,
  getState,
  openCharacterSession,
} from "../../scripts/state.js";
import {
  commitCompletedBonusAttack,
  previewCompletedBonusAttack,
  readCompletedBonusAttackReceipt,
  startAttackSequence,
} from "../../scripts/actions/sara-combat.js";

function request(kind = "flurry", overrides = {}) {
  return {
    sequenceId: `bonus-${kind}-sequence`,
    attackId: `bonus-${kind}-attack-1`,
    sequenceKind: kind,
    battleId: null,
    ownTurnId: null,
    turnMarker: Number(getState().ui?.turn?.turnNumber ?? 1),
    expectedUsedSlots: 0,
    start: {
      confirmed: kind === "flurry",
      triggerConfirmed: kind === "bonus-unarmed",
      parentId: "ordinary-bonus-command",
      parentFeature: null,
    },
    attack: {
      profileId: "unarmed",
      rollMode: "normal",
      firstD20: "10",
      secondD20: "",
      targetArmorClass: "",
      dmHitResult: "hit",
      targetLabel: "",
      confirmSeparateAction: false,
      dmExceptionConfirmed: false,
    },
    damageRolls: ["3"],
    ...overrides,
  };
}

function openSara() {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
}

test("first completed flurry hit pays once and records attack plus damage in one revision", () => {
  openSara();
  const req = request();
  const revision = getSessionContext().stateRevision;
  const ki = getState().combat.ki.current;
  const preview = previewCompletedBonusAttack(getState(), req);
  assert.equal(preview.ok, true);
  assert.equal(preview.stage, "complete");
  assert.equal(preview.request.sequenceKind, "flurry");
  assert.equal(getSessionContext().stateRevision, revision);
  const result = commitCompletedBonusAttack(getSessionContext(), req, "bonus-flurry-hit");
  assert.equal(result.status, "applied");
  assert.equal(getSessionContext().stateRevision, revision + 1);
  const sequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === req.sequenceId);
  assert.equal(sequence.kind, "flurry");
  assert.equal(sequence.resourcePaymentApplied, true);
  assert.equal(sequence.actionFlagApplied, true);
  assert.equal(sequence.resolvedAttacks.length, 1);
  assert.equal(sequence.resolvedAttacks[0].damageStatus, "recorded");
  assert.equal(getState().combat.ki.current, ki - 1);
  assert.equal(getState().ui.turn.bonusActionUsed, true);
  assert.equal(getState().ui.turn.actionUsed, false);
  assert.equal(readCompletedBonusAttackReceipt(getState(), "bonus-flurry-hit").outcome, "hit");
});

test("first flurry miss pays once and records damage as not applicable", () => {
  openSara();
  const req = request("flurry", {
    attackId: "bonus-flurry-miss",
    attack: {
      profileId: "unarmed", rollMode: "normal", firstD20: "1",
      secondD20: "", targetArmorClass: "", dmHitResult: null, targetLabel: "",
      confirmSeparateAction: false, dmExceptionConfirmed: false,
    },
    damageRolls: [],
  });
  const ki = getState().combat.ki.current;
  const result = commitCompletedBonusAttack(getSessionContext(), req, "bonus-flurry-miss-op");
  assert.equal(result.status, "applied");
  const sequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === req.sequenceId);
  assert.equal(sequence.resolvedAttacks[0].hitResult, "miss");
  assert.equal(sequence.resolvedAttacks[0].damageStatus, "not-applicable");
  assert.equal(getState().combat.ki.current, ki - 1);
  assert.equal(getState().ui.turn.bonusActionUsed, true);
});

test("bonus-unarmed commits without ki payment and a hit missing damage is mutation-free", () => {
  openSara();
  const revision = getSessionContext().stateRevision;
  const before = structuredClone(getState());
  const invalid = commitCompletedBonusAttack(
    getSessionContext(), request("bonus-unarmed", { damageRolls: [] }), "bonus-empty-hit",
  );
  assert.equal(invalid.status, "rejected");
  assert.equal(getSessionContext().stateRevision, revision);
  assert.deepEqual(getState(), before);

  const req = request("bonus-unarmed");
  const ki = getState().combat.ki.current;
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), req, "bonus-unarmed-hit",
  ).status, "applied");
  assert.equal(getState().combat.ki.current, ki);
  assert.equal(getState().ui.turn.bonusActionUsed, true);
});

test("completed flurry continuation uses the paid sequence without charging ki again", () => {
  openSara();
  const first = request();
  const ki = getState().combat.ki.current;
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), first, "bonus-flurry-first",
  ).status, "applied");
  const stateAfterFirst = getState();
  const second = request("flurry", {
    attackId: "bonus-flurry-attack-2",
    expectedUsedSlots: 1,
  });
  const result = commitCompletedBonusAttack(
    getSessionContext(), second, "bonus-flurry-second",
  );
  assert.equal(result.status, "applied");
  const sequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === first.sequenceId);
  assert.equal(sequence.resolvedAttacks.length, 2);
  assert.equal(sequence.status, "complete");
  assert.equal(getState().combat.ki.current, ki - 1);
  assert.equal(stateAfterFirst.ui.turn.bonusActionUsed, true);
});

test("completed bonus receipt replays canonical request and rejects collisions", () => {
  openSara();
  const req = request();
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), req, "bonus-replay",
  ).status, "applied");
  const revision = getSessionContext().stateRevision;
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), req, "bonus-replay",
  ).status, "replayed");
  assert.equal(getSessionContext().stateRevision, revision);
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), request("bonus-unarmed"), "bonus-replay",
  ).reason, "operation-collision");
});

test("legacy paid flurry can continue through completed path without another payment", () => {
  openSara();
  const first = request();
  const start = startAttackSequence(getSessionContext(), {
    kind: "flurry",
    sequenceId: first.sequenceId,
    confirmed: true,
    triggerConfirmed: false,
  }, "legacy-paid-flurry");
  assert.equal(start.status, "applied");
  const paidKi = getState().combat.ki.current;
  const legacySequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === first.sequenceId);
  assert.equal(legacySequence.resourcePaymentApplied, true);
  assert.equal(legacySequence.actionFlagApplied, true);
  assert.equal(legacySequence.resolvedAttacks.length, 0);

  const continuation = request("flurry", {
    attackId: "legacy-flurry-completed-hit",
    expectedUsedSlots: 0,
  });
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), continuation, "legacy-flurry-completed-op",
  ).status, "applied");
  assert.equal(getState().combat.ki.current, paidKi);
  assert.equal(getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === first.sequenceId).resolvedAttacks.length, 1);
});

test("slot and sequence-kind conflicts reject without applying bonus payment", () => {
  openSara();
  const first = request();
  const initialRevision = getSessionContext().stateRevision;
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), first, "bonus-slot-first",
  ).status, "applied");
  const afterFirst = structuredClone(getState());
  const conflict = commitCompletedBonusAttack(
    getSessionContext(),
    request("bonus-unarmed", { sequenceId: first.sequenceId }),
    "bonus-kind-conflict",
  );
  assert.equal(conflict.status, "rejected");
  assert.deepEqual(getState(), afterFirst);
  assert.equal(getSessionContext().stateRevision, initialRevision + 1);
  const before = structuredClone(getState());
  const stale = request("flurry", {
    attackId: "bonus-slot-stale",
    expectedUsedSlots: 0,
  });
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), stale, "bonus-slot-stale-op",
  ).status, "rejected");
  assert.deepEqual(getState(), before);
});
