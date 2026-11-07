import test from "node:test";
import assert from "node:assert/strict";
import {
  getSessionContext,
  getState,
  subscribe,
  updateState,
} from "../../scripts/state.js";
import {
  getWorkspaceSessionForTests,
  openNormalAttack,
} from "../../scripts/workspace/controller.js";
import { previewWorkspaceCompletedSeekingStrike } from "../../scripts/workspace/attack-adapter.js";
import {
  fireWorkspaceActionStrict,
  fireWorkspaceInput,
  fireWorkspaceAction,
  FixtureForm,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";
import { readSeekingHistory } from "../../scripts/combat/seeking-history.js";

function openMissCheckpoint(dialog) {
  updateState((draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    return draft;
  });
  assert.equal(openNormalAttack().ok, true);
  dialog.forms.attack = new FixtureForm("attack", {
    profileId: "unarmed", rollMode: "normal", firstD20: "2",
    secondD20: "", confirmSeparateAction: false,
  });
  fireWorkspaceActionStrict(dialog, "attack-miss", { apply: true });
  assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
}

function beginSeeking(dialog) {
  const ki = getState().combat.ki.current;
  const revision = getSessionContext().stateRevision;
  fireWorkspaceActionStrict(dialog, "begin-seeking");
  assert.equal(getWorkspaceSessionForTests().currentStep, "seeking-input");
  assert.equal(getSessionContext().stateRevision, revision);
  assert.equal(getState().combat.ki.current, ki);
  assert.equal(getState().monk.combatAssistant.activeSequences[0]
    .resolvedAttacks[0].seekingAmendments, undefined);
}

function submitSeekingInput(dialog, { roll = "10", outcome = "miss", ac = "" } = {}) {
  dialog.forms.attack = null;
  dialog.forms.seeking = new FixtureForm("seeking", {
    rollMode: "normal",
    firstD20: roll,
    secondD20: "",
    targetArmorClass: ac,
    dmHitResult: outcome,
    dmExceptionConfirmed: false,
  });
  fireWorkspaceInput(dialog, "firstD20", roll);
  fireWorkspaceInput(dialog, "dmHitResult", outcome, "select");
  if (ac) fireWorkspaceInput(dialog, "targetArmorClass", ac);
  const session = getWorkspaceSessionForTests();
  assert.equal(session.rawInputsByStep[session.currentStepKey].firstD20, roll);
  const intent = session.seekingIntent;
  const values = session.rawInputsByStep[session.currentStepKey];
  const preview = previewWorkspaceCompletedSeekingStrike(getState(), {
    actionId: intent.actionId, attackId: intent.attackId,
    invocationId: intent.invocationId, battleId: intent.battleId,
    phaseAtOpen: intent.phaseAtOpen, ownTurnId: intent.ownTurnId,
    turnMarker: intent.turnMarker, expectedParentBasis: intent.expectedParentBasis,
    replacement: { rollMode: values.rollMode ?? "normal", firstD20: values.firstD20,
      secondD20: values.secondD20, targetArmorClass: values.targetArmorClass,
      dmHitResult: values.dmHitResult, dmExceptionConfirmed: false },
    damageRolls: [],
  });
  assert.equal(preview.ok, true, JSON.stringify({ preview, intent, values }));
  fireWorkspaceActionStrict(dialog, "submit-seeking", { apply: true });
}

test("new Seeking input and cancel return to exact miss checkpoint without payment or history", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    openMissCheckpoint(dialog);
    const savedState = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const storage = new Map(window.localStorage.values);
    const attackId = getWorkspaceSessionForTests().attackId;
    beginSeeking(dialog);
    fireWorkspaceActionStrict(dialog, "cancel-seeking-draft");
    assert.deepEqual(getState(), savedState);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.deepEqual(window.localStorage.values, storage);
    assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
    assert.equal(getWorkspaceSessionForTests().attackId, attackId);
  } finally {
    unsubscribe();
  }
});

test("replacement miss commits one receipt and one ki payment at the parent checkpoint", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    openMissCheckpoint(dialog);
    const beforeKi = getState().combat.ki.current;
    const revision = getSessionContext().stateRevision;
    beginSeeking(dialog);
    submitSeekingInput(dialog);
    assert.equal(getSessionContext().stateRevision, revision + 1);
    assert.equal(getState().combat.ki.current, beforeKi - 1);
    assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.resolvedAttacks.length, 1);
    const attack = sequence.resolvedAttacks[0];
    assert.equal(attack.hitResult, "miss");
    assert.equal(attack.damageStatus, "not-applicable");
    const history = readSeekingHistory(attack, { actionId: sequence.id, attackId: attack.id });
    assert.equal(history.length, 1);
    assert.equal(history[0].status, "resolved");
  } finally {
    unsubscribe();
  }
});

test("replacement hit stays transient through damage then commits attack replacement atomically", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    openMissCheckpoint(dialog);
    const before = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    beginSeeking(dialog);
    submitSeekingInput(dialog, { roll: "19", outcome: "", ac: "10" });
    assert.equal(getWorkspaceSessionForTests().currentStep, "damage-input");
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.equal(getState().monk.combatAssistant.activeSequences[0]
      .resolvedAttacks[0].hitResult, "miss");
    dialog.forms.seeking = null;
    dialog.forms.damage = new FixtureForm("damage", { damage1: "" });
    fireWorkspaceInput(dialog, "damage1", "3");
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    assert.equal(getSessionContext().stateRevision, revision + 1);
    const attack = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
    assert.equal(attack.hitResult, "hit");
    assert.equal(attack.damageStatus, "recorded");
    assert.deepEqual(attack.damageRolls, [3]);
    assert.equal(getState().combat.ki.current, before.combat.ki.current - 1);
  } finally {
    unsubscribe();
  }
});

test("Back from replacement damage retains both forms and cancel preserves original miss", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    openMissCheckpoint(dialog);
    beginSeeking(dialog);
    submitSeekingInput(dialog, { roll: "19", outcome: "", ac: "10" });
    dialog.forms.seeking = new FixtureForm("seeking", {
      rollMode: "normal", firstD20: "19", secondD20: "",
      targetArmorClass: "10", dmHitResult: "", dmExceptionConfirmed: false,
    });
    dialog.forms.damage = new FixtureForm("damage", { damage1: "" });
    fireWorkspaceInput(dialog, "damage1", "5");
    const intent = getWorkspaceSessionForTests().pendingSeekingIntent;
    const damageDraft = structuredClone(getWorkspaceSessionForTests()
      .rawInputsByStep[`damage-input:${intent.attackId}:${intent.invocationId}`]);
    fireWorkspaceActionStrict(dialog, "back");
    assert.equal(getWorkspaceSessionForTests().currentStep, "seeking-input");
    assert.equal(getWorkspaceSessionForTests().pendingSeekingIntent, null);
    assert.equal(getWorkspaceSessionForTests()
      .rawInputsByStep[`seeking-input:${intent.attackId}:${intent.invocationId}`].firstD20, "19");
    assert.deepEqual(getWorkspaceSessionForTests()
      .rawInputsByStep[`damage-input:${intent.attackId}:${intent.invocationId}`], damageDraft);
    const stateBeforeCancel = structuredClone(getState());
    fireWorkspaceActionStrict(dialog, "cancel-seeking-draft");
    assert.deepEqual(getState(), stateBeforeCancel);
    assert.equal(getState().monk.combatAssistant.activeSequences[0]
      .resolvedAttacks[0].hitResult, "miss");
  } finally {
    unsubscribe();
  }
});

test("parent change before replacement commit prevents spending or changing the new parent", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    openMissCheckpoint(dialog);
    beginSeeking(dialog);
    dialog.forms.attack = null;
    dialog.forms.seeking = new FixtureForm("seeking", {
      rollMode: "normal", firstD20: "10", targetArmorClass: "",
      secondD20: "", dmHitResult: "miss",
    });
    updateState((draft) => {
      draft.monk.combatAssistant.activeSequences[0].resolvedAttacks[0].targetArmorClass = 20;
      return draft;
    });
    const changed = structuredClone(getState());
    const ki = getState().combat.ki.current;
    fireWorkspaceAction(dialog, "submit-seeking");
    assert.deepEqual(getState(), changed);
    assert.equal(getState().combat.ki.current, ki);
    assert.equal(getState().monk.combatAssistant.activeSequences[0]
      .resolvedAttacks[0].hitResult, "miss");
  } finally {
    unsubscribe();
  }
});

test("post-commit subscriber exception recovers a completed Seeking miss as applied-unsaved", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  let removeFailure;
  try {
    openMissCheckpoint(dialog);
    beginSeeking(dialog);
    dialog.forms.attack = null;
    dialog.forms.seeking = new FixtureForm("seeking", {
      rollMode: "normal", firstD20: "10", secondD20: "",
      targetArmorClass: "30", dmHitResult: "", dmExceptionConfirmed: false,
    });
    fireWorkspaceInput(dialog, "firstD20", "10");
    fireWorkspaceInput(dialog, "targetArmorClass", "30");
    const beforeKi = getState().combat.ki.current;
    let throwOnce = true;
    removeFailure = subscribe(() => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error("seeking subscriber exception");
      }
    });
    fireWorkspaceActionStrict(dialog, "submit-seeking", { apply: true });
    removeFailure();
    removeFailure = null;
    assert.equal(getState().combat.ki.current, beforeKi - 1);
    assert.equal(getState().monk.combatAssistant.activeSequences[0]
      .resolvedAttacks[0].seekingAmendments.length, 1);
    assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
    assert.equal(getWorkspaceSessionForTests().appliedUnsaved, true);
  } finally {
    removeFailure?.();
    unsubscribe();
  }
});
