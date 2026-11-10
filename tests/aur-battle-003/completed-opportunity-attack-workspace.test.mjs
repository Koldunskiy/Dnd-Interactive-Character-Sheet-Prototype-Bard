import test from "node:test";
import assert from "node:assert/strict";
import { getState, getSessionContext, subscribe, updateState } from "../../scripts/state.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import { getWorkspaceAttackFingerprint } from "../../scripts/workspace/attack-adapter.js";
import {
  getWorkspaceRecoverySessions,
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
    const initial = getWorkspaceSessionForTests();
    const intent = initial.opportunityIntent;
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "19", secondD20: "",
    });
    fireWorkspaceActionStrict(dialog, "attack-hit", { apply: true });
    const session = getWorkspaceSessionForTests();
    dialog.forms.damage = new FixtureForm("damage", { damage1: "" });
    const damageInput = dialog.body.querySelector('input[name="damage1"]');
    assert.ok(damageInput?.isConnected);
    fireWorkspaceInput(dialog, "damage1", "3");
    const sourceProfile = structuredClone(getDerivedStats(getState()).saraAttackProfiles.unarmed);
    const identity = {
      workspaceSessionId: session.workspaceSessionId,
      sequenceId: intent.sequenceId,
      attackId: intent.attackId,
      operationId: intent.operationId,
    };
    const rawAttack = structuredClone(session.rawInputsByStep[`attack-input:${intent.attackId}`]);
    const rawDamage = Object.fromEntries(dialog.forms.damage.elements.map((entry) =>
      [entry.name, entry.value]));
    const pendingFingerprint = session.pendingAttackIntent.previewFingerprint;
    const currentDexterity = getState().abilities.dexterity;
    const changedDexterity = currentDexterity <= 10 ? 20 : 8;
    updateState((state) => { state.abilities.dexterity = changedDexterity; });
    const changedProfile = getDerivedStats(getState()).saraAttackProfiles.unarmed;
    assert.notEqual(changedProfile.attackBonus, sourceProfile.attackBonus);
    assert.notEqual(getWorkspaceAttackFingerprint(
      getState(), intent.sequenceId, "reaction-unarmed", true,
    ), pendingFingerprint);
    const beforeSubmit = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const storage = new Map(window.localStorage.values);
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    const current = getWorkspaceSessionForTests();
    assert.equal(current.currentStep, "attack-input");
    assert.equal(current.workspaceSessionId, identity.workspaceSessionId);
    assert.equal(current.opportunityIntent.sequenceId, identity.sequenceId);
    assert.equal(current.opportunityIntent.attackId, identity.attackId);
    assert.equal(current.opportunityIntent.operationId, identity.operationId);
    assert.equal(current.pendingAttackIntent, null);
    assert.equal(current.selectedDamage, null);
    assert.deepEqual(current.rawInputsByStep[`attack-input:${intent.attackId}`], rawAttack);
    assert.equal(current.rawInputsByStep[`damage-input:${intent.attackId}`].damage1, "3");
    assert.deepEqual(rawDamage, { damage1: "3" });
    assert.match(dialog.body.innerHTML, /Профиль или боевой контекст изменился/);
    assert.equal(getState().monk?.combatAssistant?.activeSequences?.length ?? 0, 0);
    assert.equal(getState().ui.turn.reactionUsed, false);
    assert.deepEqual(getState(), beforeSubmit);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.deepEqual(window.localStorage.values, storage);

    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "19", secondD20: "",
    });
    fireWorkspaceActionStrict(dialog, "attack-hit", { apply: true });
    const updatedDamageInput = dialog.body.querySelector('input[name="damage1"]');
    assert.ok(updatedDamageInput?.isConnected);
    assert.equal(getWorkspaceSessionForTests().currentStep, "damage-input");
    assert.equal(getWorkspaceSessionForTests().opportunityIntent.operationId, identity.operationId);
    assert.ok(dialog.body.innerHTML.includes(
      `${changedProfile.damageDice} ${changedProfile.damageModifier >= 0 ? "+" : "-"} ${Math.abs(changedProfile.damageModifier)}`,
    ));
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    assert.equal(getState().ui.turn.reactionUsed, true);
    const sequence = getState().monk.combatAssistant.activeSequences.find((entry) =>
      entry.parentFeature === "opportunity-attack");
    assert.equal(sequence.resolvedAttacks.length, 1);
    const recordedAttack = sequence.resolvedAttacks[0];
    assert.equal(recordedAttack.damageStatus, "recorded");
    assert.deepEqual(recordedAttack.profileSnapshot, changedProfile);
    assert.equal(recordedAttack.attackBonusSnapshot, changedProfile.attackBonus);
    assert.equal(recordedAttack.damageModifierSnapshot, changedProfile.damageModifier);
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

test("opportunity miss and hit-damage recover matching receipts after subscriber failures", () => {
  for (const outcome of ["miss", "hit"]) {
    const { dialog, unsubscribe } = installWorkspaceFixture();
    let removeThrowingSubscriber;
    try {
      assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
      dialog.forms.attack = new FixtureForm("attack", {
        profileId: "unarmed",
        rollMode: "normal",
        firstD20: "10",
        secondD20: "",
        confirmSeparateAction: false,
      });
      if (outcome === "miss") {
        removeThrowingSubscriber = subscribe(() => {
          throw new Error("opportunity miss post-commit subscriber failure");
        });
        fireWorkspaceActionStrict(dialog, "attack-miss", { apply: true });
      } else {
        fireWorkspaceActionStrict(dialog, "attack-hit", { apply: true });
        dialog.forms.damage = new FixtureForm("damage", { damage1: "" });
        fireWorkspaceInput(dialog, "damage1", "3");
        removeThrowingSubscriber = subscribe(() => {
          throw new Error("opportunity hit post-commit subscriber failure");
        });
        fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
      }
      removeThrowingSubscriber();
      removeThrowingSubscriber = null;
      const session = getWorkspaceSessionForTests();
      const sequence = getState().monk.combatAssistant.activeSequences.find((entry) =>
        entry.parentFeature === "opportunity-attack");
      assert.equal(sequence.resolvedAttacks.length, 1);
      assert.equal(sequence.resolvedAttacks[0].hitResult, outcome);
      assert.equal(getState().ui.turn.reactionUsed, true);
      assert.equal(session.appliedUnsaved, true);
      assert.equal(Boolean(session.operationVerificationRequired), false);
      assert.equal(session.pendingAttackIntent, null);
    } finally {
      removeThrowingSubscriber?.();
      unsubscribe();
    }
  }
});

test("opportunity receipt inspection failure requires read-only verification", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  let removeThrowingSubscriber;
  let stateForRestore;
  let savedSequences;
  try {
    assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed",
      rollMode: "normal",
      firstD20: "10",
      secondD20: "",
    });
    let throwOnRead = true;
    removeThrowingSubscriber = subscribe((state) => {
      stateForRestore = state;
      savedSequences = state.monk.combatAssistant.activeSequences;
      Object.defineProperty(state.monk.combatAssistant, "activeSequences", {
        configurable: true,
        enumerable: true,
        get() {
          if (throwOnRead) {
            throwOnRead = false;
            throw new Error("opportunity receipt inspection failure");
          }
          return savedSequences;
        },
      });
      throw new Error("opportunity post-commit subscriber failure");
    });
    fireWorkspaceActionStrict(dialog, "attack-miss", { apply: true });
    removeThrowingSubscriber();
    removeThrowingSubscriber = null;
    Object.defineProperty(stateForRestore.monk.combatAssistant, "activeSequences", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: savedSequences,
    });
    const session = getWorkspaceSessionForTests();
    assert.equal(savedSequences.length, 1);
    assert.equal(session.readOnly, true);
    assert.equal(session.operationVerificationRequired, true);
    assert.ok(session.opportunityIntent);
    assert.equal(session.opportunityIntent.normalizedRequest.sequenceId,
      session.opportunityIntent.sequenceId);
    assert.equal(session.opportunityIntent.operationId.length > 0, true);
    assert.equal(session.rawInputsByStep[`attack-input:${session.opportunityIntent.attackId}`].firstD20, "10");
    assert.equal(getWorkspaceRecoverySessions().some((entry) =>
      entry.workspaceSessionId === session.workspaceSessionId &&
      entry.recoveryKind === "verification"), true);
  } finally {
    removeThrowingSubscriber?.();
    if (stateForRestore?.monk?.combatAssistant && savedSequences) {
      Object.defineProperty(stateForRestore.monk.combatAssistant, "activeSequences", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: savedSequences,
      });
    }
    unsubscribe();
  }
});
