import test from "node:test";
import assert from "node:assert/strict";
import { getState, getSessionContext, updateState } from "../../scripts/state.js";
import {
  getWorkspaceSessionForTests,
  openSaraBattleCommand,
  openNormalAttack,
} from "../../scripts/workspace/controller.js";
import {
  fireWorkspaceActionStrict,
  fireWorkspaceInput,
  FixtureForm,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";

test("opportunity reopen returns the same draft and no-dice cancellation is free", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    const stateBefore = structuredClone(getState());
    const revisionBefore = getSessionContext().stateRevision;
    const storageBefore = new Map(window.localStorage.values);
    const opened = openSaraBattleCommand("opportunity-unarmed");
    const original = getWorkspaceSessionForTests();
    assert.equal(openSaraBattleCommand("opportunity-unarmed").sessionId, opened.sessionId);
    assert.equal(getWorkspaceSessionForTests().opportunityIntent.operationId,
      original.opportunityIntent.operationId);
    fireWorkspaceActionStrict(dialog, "cancel-attack-draft");
    assert.deepEqual(getState(), stateBefore);
    assert.equal(getSessionContext().stateRevision, revisionBefore);
    assert.deepEqual(window.localStorage.values, storageBefore);
    assert.equal(getState().ui.turn.reactionUsed, false);
  } finally {
    unsubscribe();
  }
});

test("opportunity opens as a free attack draft and miss commits only on completed submit", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    const stateBefore = structuredClone(getState());
    const revisionBefore = getSessionContext().stateRevision;
    const storageBefore = new Map(window.localStorage.values);
    assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
    const draft = getWorkspaceSessionForTests();
    assert.equal(draft.workspaceType, "attack");
    assert.equal(draft.currentStep, "attack-input");
    assert.equal(draft.opportunityIntent.opportunityEntry, true);
    assert.equal(stateBefore.ui.turn.reactionUsed, getState().ui.turn.reactionUsed);
    assert.deepEqual(getState(), stateBefore);
    assert.equal(getSessionContext().stateRevision, revisionBefore);
    assert.deepEqual(window.localStorage.values, storageBefore);
    assert.doesNotMatch(dialog.body.innerHTML, /triggerConfirmed|Подтверждаю провоцированный триггер/);
    assert.equal(dialog.footer.querySelector('[data-workspace-action="attack-hit"]').isConnected, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "10", secondD20: "",
      dmExceptionConfirmed: false,
    });
    const beforeCommit = getSessionContext().stateRevision;
    fireWorkspaceActionStrict(dialog, "attack-miss", { apply: true });
    assert.equal(getSessionContext().stateRevision, beforeCommit + 1);
    assert.equal(getState().ui.turn.reactionUsed, true);
    const sequence = getState().monk.combatAssistant.activeSequences.find((entry) =>
      entry.parentFeature === "opportunity-attack");
    assert.equal(sequence.status, "complete");
    assert.equal(sequence.resolvedAttacks[0].hitResult, "miss");
  } finally {
    unsubscribe();
  }
});

test("opportunity hit remains transient through back and cancel, then atomically commits damage", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
    const sessionId = getWorkspaceSessionForTests().workspaceSessionId;
    const attackId = getWorkspaceSessionForTests().attackId;
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "12", secondD20: "",
      dmExceptionConfirmed: false,
    });
    const revision = getSessionContext().stateRevision;
    fireWorkspaceActionStrict(dialog, "attack-hit", { apply: true });
    assert.equal(getWorkspaceSessionForTests().currentStep, "damage-input");
    assert.equal(getWorkspaceSessionForTests().pendingAttackIntent.operationId.length > 0, true);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.equal(getState().monk?.combatAssistant?.activeSequences?.length ?? 0, 0);
    fireWorkspaceActionStrict(dialog, "back");
    assert.equal(getWorkspaceSessionForTests().workspaceSessionId, sessionId);
    assert.equal(getWorkspaceSessionForTests().attackId, attackId);
    assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
    assert.equal(getWorkspaceSessionForTests().opportunityIntent.operationId.length > 0, true);
    fireWorkspaceActionStrict(dialog, "attack-hit", { apply: true });
    dialog.forms.damage = new FixtureForm("damage", { damage1: "" });
    fireWorkspaceInput(dialog, "damage1", "3");
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    assert.equal(getSessionContext().stateRevision, revision + 1);
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.resolvedAttacks.length, 1);
    assert.equal(sequence.resolvedAttacks[0].damageStatus, "recorded");
    assert.equal(sequence.status, "complete");
    assert.equal(getState().ui.turn.reactionUsed, true);
  } finally {
    unsubscribe();
  }
});

test("cancelling an opportunity transient hit is free and does not create a sequence", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "12", secondD20: "",
    });
    fireWorkspaceActionStrict(dialog, "attack-hit");
    dialog.forms.damage = new FixtureForm("damage", { damage1: "3" });
    const stateBefore = structuredClone(getState());
    const revisionBefore = getSessionContext().stateRevision;
    const storageBefore = new Map(window.localStorage.values);
    fireWorkspaceActionStrict(dialog, "cancel-attack-draft");
    assert.deepEqual(getState(), stateBefore);
    assert.equal(getSessionContext().stateRevision, revisionBefore);
    assert.deepEqual(window.localStorage.values, storageBefore);
    assert.equal(getState().ui.turn.reactionUsed, false);
    assert.equal(getState().monk?.combatAssistant?.activeSequences?.length ?? 0, 0);
  } finally {
    unsubscribe();
  }
});

test("irrelevant updates retain the transient opportunity attack and damage controls", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
    const sessionId = getWorkspaceSessionForTests().workspaceSessionId;
    const initialFingerprint = getWorkspaceSessionForTests().opportunityIntent.previewFingerprint;
    const attackInput = dialog.body.querySelector('input[name="firstD20"]');
    attackInput.value = "14";
    attackInput.focus();
    attackInput.setSelectionRange(1, 2);
    fireWorkspaceInput(dialog, "firstD20", "14");
    updateState((state) => { state.ui.unrelatedOpportunityTest = true; });
    assert.equal(getWorkspaceSessionForTests().opportunityIntent.previewFingerprint,
      initialFingerprint);
    assert.equal(getWorkspaceSessionForTests().workspaceSessionId, sessionId);
    assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
    assert.equal(Boolean(getWorkspaceSessionForTests().confirmationRequired), false);
    assert.equal(dialog.body.querySelector('input[name="firstD20"]'), attackInput);
    assert.equal(attackInput.isConnected, true);
    assert.equal(globalThis.document.activeElement, attackInput);
    assert.deepEqual([attackInput.selectionStart, attackInput.selectionEnd], [1, 2]);
    assert.equal(attackInput.value, "14");
    assert.equal(getWorkspaceSessionForTests().rawInputsByStep[
      getWorkspaceSessionForTests().currentStepKey].firstD20, "14");
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "14", secondD20: "",
    });
    fireWorkspaceActionStrict(dialog, "attack-hit", { apply: true });
    const damageInput = dialog.body.querySelector('input[name="damage1"]');
    damageInput.value = "3";
    damageInput.focus();
    damageInput.setSelectionRange(0, 1);
    fireWorkspaceInput(dialog, "damage1", "3");
    updateState((state) => { state.ui.unrelatedOpportunityTest = false; });
    assert.equal(getWorkspaceSessionForTests().workspaceSessionId, sessionId);
    assert.equal(getWorkspaceSessionForTests().currentStep, "damage-input");
    assert.equal(dialog.body.querySelector('input[name="damage1"]'), damageInput);
    assert.equal(damageInput.isConnected, true);
    assert.equal(globalThis.document.activeElement, damageInput);
    assert.deepEqual([damageInput.selectionStart, damageInput.selectionEnd], [0, 1]);
    assert.equal(damageInput.value, "3");
    assert.equal(getWorkspaceSessionForTests().rawInputsByStep[
      getWorkspaceSessionForTests().currentStepKey].damage1, "3");
    assert.equal(getState().monk?.combatAssistant?.activeSequences?.length ?? 0, 0);
  } finally {
    unsubscribe();
  }
});

test("normal attack remains unavailable while opportunity is available in waiting", () => {
  const { unsubscribe } = installWorkspaceFixture();
  try {
    updateState((state) => {
      state.battleConsole.current = {
        id: "opportunity-waiting-window",
        phase: "waiting",
        ownTurnId: null,
      };
    });
    assert.equal(openNormalAttack().ok, false);
    assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
    assert.equal(getWorkspaceSessionForTests().opportunityIntent.phaseAtOpen, "waiting");
  } finally {
    unsubscribe();
  }
});

test("relevant profile change on transient damage blocks stale preview submission", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
    const intent = getWorkspaceSessionForTests().opportunityIntent;
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "12", secondD20: "",
    });
    fireWorkspaceActionStrict(dialog, "attack-hit", { apply: true });
    dialog.forms.damage = new FixtureForm("damage", { damage1: "3" });
    const pending = getWorkspaceSessionForTests().pendingAttackIntent;
    updateState((state) => { state.abilities.strength = 18; });
    const beforeSubmit = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const storage = new Map(window.localStorage.values);
    fireWorkspaceActionStrict(dialog, "submit-damage");
    const current = getWorkspaceSessionForTests();
    assert.equal(current.currentStep, "checkpoint");
    assert.equal(current.opportunityIntent.sequenceId, intent.sequenceId);
    assert.equal(current.opportunityIntent.attackId, intent.attackId);
    assert.equal(current.pendingAttackIntent, null);
    assert.equal(current.rawInputsByStep[`damage-input:${intent.attackId}`].damage1, "3");
    assert.deepEqual(getState(), beforeSubmit);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.deepEqual(window.localStorage.values, storage);
    assert.ok(pending);
  } finally {
    unsubscribe();
  }
});

test("critical opportunity damage requires two physical dice before enabling the connected submit", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "20", secondD20: "",
    });
    fireWorkspaceActionStrict(dialog, "attack-hit", { apply: true });
    dialog.forms.damage = new FixtureForm("damage", { damage1: "", damage2: "" });
    const firstDamage = dialog.footer.querySelector('[data-workspace-action="submit-damage"]');
    assert.equal(firstDamage.isConnected, true);
    assert.equal(firstDamage.disabled, true);
    fireWorkspaceInput(dialog, "damage1", "3");
    assert.equal(dialog.footer.querySelector('[data-workspace-action="submit-damage"]').disabled, true);
    fireWorkspaceInput(dialog, "damage2", "4");
    const enabledSubmit = dialog.footer.querySelector('[data-workspace-action="submit-damage"]');
    assert.equal(enabledSubmit.isConnected, true);
    assert.equal(enabledSubmit.disabled, false);
    const before = getSessionContext().stateRevision;
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    assert.equal(getSessionContext().stateRevision, before + 1);
    assert.equal(getState().monk.combatAssistant.activeSequences[0]
      .resolvedAttacks[0].damageRolls.length, 2);
  } finally {
    unsubscribe();
  }
});
