import test from "node:test";
import assert from "node:assert/strict";
import {
  getSessionContext,
  getState,
} from "../../scripts/state.js";
import {
  getWorkspaceSessionForTests,
  openSaraBattleCommand,
} from "../../scripts/workspace/controller.js";
import {
  fireWorkspaceActionStrict,
  fireWorkspaceInput,
  FixtureForm,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";

function openCommand(dialog, kind) {
  assert.equal(openSaraBattleCommand(kind).ok, true);
  dialog.forms.command = new FixtureForm("command", kind === "flurry"
    ? { confirmed: true }
    : { triggerConfirmed: true });
  fireWorkspaceActionStrict(dialog, "apply-command", { apply: true });
  assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
}

function enterAttack(dialog, die, action) {
  dialog.forms.attack = new FixtureForm("attack", {
    profileId: "unarmed",
    rollMode: "normal",
    firstD20: String(die),
    secondD20: "",
    confirmSeparateAction: false,
  });
  fireWorkspaceActionStrict(dialog, action, { apply: true });
}

test("flurry command prepares a free draft; canceling initial input leaves state and storage untouched", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    assert.equal(openSaraBattleCommand("flurry").ok, true);
    dialog.forms.command = new FixtureForm("command", { confirmed: true });
    const before = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const storage = new Map(window.localStorage.values);
    fireWorkspaceActionStrict(dialog, "apply-command", { apply: true });
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.deepEqual(window.localStorage.values, storage);
    assert.equal(getWorkspaceSessionForTests().workspaceType, "attack");
    assert.equal(getWorkspaceSessionForTests().isExistingSequence, false);
    fireWorkspaceActionStrict(dialog, "cancel-attack-draft");
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.deepEqual(window.localStorage.values, storage);
    assert.equal(getWorkspaceSessionForTests(), null);
  } finally {
    unsubscribe();
  }
});

test("first completed flurry hit atomically records damage and pays once", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    openCommand(dialog, "flurry");
    const beforeRevision = getSessionContext().stateRevision;
    const beforeKi = getState().combat.ki.current;
    enterAttack(dialog, 10, "attack-hit");
    assert.equal(getSessionContext().stateRevision, beforeRevision);
    assert.equal(getState().monk?.combatAssistant?.activeSequences?.length ?? 0, 0);
    dialog.forms.damage = new FixtureForm("damage", { damage1: "3" });
    fireWorkspaceInput(dialog, "damage1", "3");
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    assert.equal(getSessionContext().stateRevision, beforeRevision + 1);
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.kind, "flurry");
    assert.equal(sequence.resolvedAttacks.length, 1);
    assert.equal(sequence.resolvedAttacks[0].damageStatus, "recorded");
    assert.equal(getState().combat.ki.current, beforeKi - 1);
    assert.equal(getState().ui.turn.bonusActionUsed, true);
    assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
  } finally {
    unsubscribe();
  }
});

test("first completed bonus-unarmed miss pays bonus action only when the miss is recorded", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    openCommand(dialog, "bonus-unarmed");
    const before = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    enterAttack(dialog, 1, "attack-miss");
    assert.equal(getSessionContext().stateRevision, revision + 1);
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.kind, "bonus-unarmed");
    assert.equal(sequence.resolvedAttacks[0].hitResult, "miss");
    assert.equal(sequence.resolvedAttacks[0].damageStatus, "not-applicable");
    assert.equal(getState().ui.turn.bonusActionUsed, true);
    assert.equal(getState().combat.ki.current, before.combat.ki.current);
  } finally {
    unsubscribe();
  }
});

test("hit damage cancellation is free and Back preserves attack input for a fresh miss", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    openCommand(dialog, "bonus-unarmed");
    enterAttack(dialog, 12, "attack-hit");
    dialog.forms.damage = new FixtureForm("damage", { damage1: "4" });
    const before = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    fireWorkspaceActionStrict(dialog, "cancel-attack-draft");
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.equal(getWorkspaceSessionForTests(), null);

    openCommand(dialog, "bonus-unarmed");
    enterAttack(dialog, 12, "attack-hit");
    fireWorkspaceActionStrict(dialog, "back");
    assert.equal(getWorkspaceSessionForTests().pendingAttackIntent, null);
    enterAttack(dialog, 1, "attack-miss");
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.resolvedAttacks[0].hitResult, "miss");
  } finally {
    unsubscribe();
  }
});

test("canceling a later flurry draft returns to the actual previous checkpoint without refund", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    openCommand(dialog, "flurry");
    enterAttack(dialog, 1, "attack-miss");
    const savedState = structuredClone(getState());
    const savedRevision = getSessionContext().stateRevision;
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    const firstAttackId = sequence.resolvedAttacks[0].id;
    const paidKi = getState().combat.ki.current;
    fireWorkspaceActionStrict(dialog, "next-attack");
    const draftId = getWorkspaceSessionForTests().attackId;
    assert.notEqual(draftId, firstAttackId);
    fireWorkspaceActionStrict(dialog, "cancel-attack-draft");
    assert.deepEqual(getState(), savedState);
    assert.equal(getSessionContext().stateRevision, savedRevision);
    assert.equal(getState().combat.ki.current, paidKi);
    assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
    assert.equal(getWorkspaceSessionForTests().attackId, firstAttackId);
    assert.notEqual(getWorkspaceSessionForTests().attackId, draftId);
  } finally {
    unsubscribe();
  }
});
