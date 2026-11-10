import test from "node:test";
import assert from "node:assert/strict";
import {
  getState,
  getSessionContext,
  openCharacterSession,
  subscribe,
  updateState,
} from "../../scripts/state.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import { getWorkspaceAttackFingerprint } from "../../scripts/workspace/attack-adapter.js";
import { executeBattleCommand } from "../../scripts/battle/commands.js";
import {
  getWorkspaceRecoverySessions,
  getWorkspaceSessions,
  getWorkspaceSessionForTests,
  disposeWorkspaceOwner,
  requestEndBattle,
  openSaraBattleCommand,
  openNormalAttack,
  reconcileWorkspaceAfterStateChange,
} from "../../scripts/workspace/controller.js";
import {
  fireWorkspaceAction,
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
    const sequenceId = draft.opportunityIntent.sequenceId;
    const attackId = draft.opportunityIntent.attackId;
    assert.equal(stateBefore.ui.turn.reactionUsed, getState().ui.turn.reactionUsed);
    assert.deepEqual(getState(), stateBefore);
    assert.equal(getSessionContext().stateRevision, revisionBefore);
    assert.deepEqual(window.localStorage.values, storageBefore);
    assert.doesNotMatch(dialog.body.innerHTML, /triggerConfirmed|Подтверждаю провоцированный триггер/);
    assert.equal(dialog.footer.querySelector('[data-workspace-action="attack-miss"]').isConnected, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "10", secondD20: "",
      dmExceptionConfirmed: false,
    });
    const beforeCommit = getSessionContext().stateRevision;
    fireWorkspaceActionStrict(dialog, "attack-miss", { apply: true });
    assert.equal(getSessionContext().stateRevision, beforeCommit + 1);
    assert.equal(getState().ui.turn.reactionUsed, true);
    const sequence = getState().monk.combatAssistant.activeSequences.find((entry) =>
      entry.id === sequenceId);
    assert.equal(sequence.parentFeature, "opportunity-attack");
    assert.equal(sequence.status, "complete");
    assert.equal(sequence.resolvedAttacks[0].id, attackId);
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

test("cancelling an opportunity child restores the exact suspended parent workspace", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    const parentOpened = openSaraBattleCommand("character-roll");
    assert.equal(parentOpened.ok, true);
    const parent = getWorkspaceSessionForTests();
    const parentIdentity = {
      id: parent.workspaceSessionId,
      attackId: parent.attackId,
      sequenceId: parent.sequenceId,
      form: dialog.forms.command,
    };
    const childOpened = openSaraBattleCommand("opportunity-unarmed");
    assert.equal(childOpened.ok, true, childOpened.reason);
    const child = getWorkspaceSessionForTests();
    assert.notEqual(child.workspaceSessionId, parentIdentity.id);
    assert.equal(getWorkspaceSessions().some((entry) =>
      entry.workspaceSessionId === parentIdentity.id && entry.suspended), true,
    JSON.stringify(getWorkspaceSessions()));
    fireWorkspaceActionStrict(dialog, "cancel-attack-draft");
    const restored = getWorkspaceSessionForTests();
    assert.equal(restored?.workspaceSessionId, parentIdentity.id,
      JSON.stringify(getWorkspaceSessions()));
    assert.equal(restored.attackId, parentIdentity.attackId);
    assert.equal(restored.sequenceId, parentIdentity.sequenceId);
    assert.equal(restored.scenarioId, "character-roll");
  } finally {
    unsubscribe();
  }
});

test("finishing a completed opportunity restores the same permissible parent", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    assert.equal(openSaraBattleCommand("character-roll").ok, true);
    const parent = getWorkspaceSessionForTests();
    const parentId = parent.workspaceSessionId;
    const parentStep = parent.currentStep;
    const parentInputs = structuredClone(parent.rawInputsByStep);
    assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "10", secondD20: "",
    });
    fireWorkspaceActionStrict(dialog, "attack-miss", { apply: true });
    assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
    fireWorkspaceActionStrict(dialog, "summary");
    assert.equal(getWorkspaceSessionForTests().currentStep, "summary");
    fireWorkspaceActionStrict(dialog, "finish-workspace");
    const restored = getWorkspaceSessionForTests();
    assert.equal(restored.workspaceSessionId, parentId);
    assert.equal(restored.currentStep, parentStep);
    assert.deepEqual(restored.rawInputsByStep, parentInputs);
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

test("opportunity storage failure applies once and retry-save persists without gameplay mutation", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  const storage = window.localStorage;
  const originalSetItem = storage.setItem;
  let failOnce = true;
  try {
    assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "10", secondD20: "",
    });
    storage.setItem = (key, value) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("injected opportunity storage failure");
      }
      return originalSetItem.call(storage, key, value);
    };
    fireWorkspaceActionStrict(dialog, "attack-miss", { apply: true });
    storage.setItem = originalSetItem;
    const session = getWorkspaceSessionForTests();
    assert.equal(session.appliedUnsaved, true);
    assert.equal(Boolean(session.operationVerificationRequired), false);
    const savedWorkspaceId = session.workspaceSessionId;
    assert.equal(openSaraBattleCommand("character-roll").ok, false);
    assert.equal(getWorkspaceSessionForTests().workspaceSessionId, savedWorkspaceId);
    assert.equal(getState().ui.turn.reactionUsed, true);
    assert.equal(getState().monk.combatAssistant.activeSequences.filter((entry) =>
      entry.parentFeature === "opportunity-attack").length, 1);
    const stateBeforeRetry = structuredClone(getState());
    const revisionBeforeRetry = getSessionContext().stateRevision;
    fireWorkspaceActionStrict(dialog, "retry-save", { apply: true });
    assert.deepEqual(getState(), stateBeforeRetry);
    assert.equal(getSessionContext().stateRevision, revisionBeforeRetry);
    assert.equal(getState().ui.turn.reactionUsed, true);
    assert.equal(getState().monk.combatAssistant.activeSequences.filter((entry) =>
      entry.parentFeature === "opportunity-attack").length, 1);
    assert.equal(getWorkspaceSessionForTests().appliedUnsaved, false);
    assert.equal(storage.values.size > 0, true);
  } finally {
    storage.setItem = originalSetItem;
    unsubscribe();
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

test("unknown opportunity result survives unmatched persistence reconcile and synthetic lifecycle actions", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  let removeFailure;
  let restoreState;
  let sequenceList;
  try {
    assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "10", secondD20: "",
    });
    let throwOnInspection = true;
    removeFailure = subscribe((state) => {
      restoreState = state;
      sequenceList = state.monk.combatAssistant.activeSequences;
      Object.defineProperty(state.monk.combatAssistant, "activeSequences", {
        configurable: true,
        enumerable: true,
        get() {
          if (throwOnInspection) {
            throwOnInspection = false;
            throw new Error("unknown opportunity inspection result");
          }
          return sequenceList;
        },
      });
      throw new Error("force unknown opportunity recovery");
    });
    fireWorkspaceActionStrict(dialog, "attack-miss", { apply: true });
    removeFailure();
    removeFailure = null;
    Object.defineProperty(restoreState.monk.combatAssistant, "activeSequences", {
      configurable: true, enumerable: true, writable: true, value: sequenceList,
    });
    const verification = getWorkspaceSessionForTests();
    assert.equal(verification.operationVerificationRequired, true);
    const verificationWorkspaceId = verification.workspaceSessionId;
    assert.equal(openSaraBattleCommand("character-roll").ok, false);
    assert.equal(getWorkspaceSessionForTests().workspaceSessionId, verificationWorkspaceId);
    const expected = {
      workspaceSessionId: verification.workspaceSessionId,
      operationId: verification.opportunityIntent.operationId,
      sequenceId: verification.opportunityIntent.sequenceId,
      attackId: verification.opportunityIntent.attackId,
      request: structuredClone(verification.opportunityIntent.normalizedRequest),
      rawInputs: structuredClone(verification.rawInputsByStep),
    };
    const beforeReconcile = structuredClone(getState());
    const revisionBeforeReconcile = getSessionContext().stateRevision;
    const storageBeforeReconcile = new Map(window.localStorage.values);
    reconcileWorkspaceAfterStateChange(getState(), {
      kind: "persistence-retry",
      persistenceResult: { ok: true },
    });
    assert.equal(getWorkspaceSessionForTests().operationVerificationRequired, true);
    assert.deepEqual(getState(), beforeReconcile);
    assert.equal(getSessionContext().stateRevision, revisionBeforeReconcile);
    assert.deepEqual(window.localStorage.values, storageBeforeReconcile);
    for (const action of [
      "close", "confirm-close", "finish-workspace", "back", "cancel-attack-draft",
      "cancel-seeking-draft", "outside-damage", "submit-damage",
      "discard-workspace-draft", "remainder", "confirm",
    ]) fireWorkspaceAction(dialog, action);
    const after = getWorkspaceSessionForTests();
    assert.equal(after.operationVerificationRequired, true);
    assert.equal(after.workspaceSessionId, expected.workspaceSessionId);
    assert.equal(after.opportunityIntent.operationId, expected.operationId);
    assert.equal(after.opportunityIntent.sequenceId, expected.sequenceId);
    assert.equal(after.opportunityIntent.attackId, expected.attackId);
    assert.deepEqual(after.opportunityIntent.normalizedRequest, expected.request);
    assert.deepEqual(after.rawInputsByStep, expected.rawInputs);
    assert.deepEqual(getState(), beforeReconcile);
    assert.equal(getSessionContext().stateRevision, revisionBeforeReconcile);
    assert.deepEqual(window.localStorage.values, storageBeforeReconcile);
    assert.equal(sequenceList.length, 1);
  } finally {
    removeFailure?.();
    if (restoreState?.monk?.combatAssistant && sequenceList) {
      Object.defineProperty(restoreState.monk.combatAssistant, "activeSequences", {
        configurable: true, enumerable: true, writable: true, value: sequenceList,
      });
    }
    unsubscribe();
  }
});

test("same-owner workspace replacement during opportunity commit is isolated from old recovery", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  let removeReplacement;
  let replaced = false;
  let replacementIdentity;
  try {
    assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
    const old = getWorkspaceSessionForTests();
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "10", secondD20: "",
    });
    removeReplacement = subscribe(() => {
      if (replaced) return;
      replaced = true;
      disposeWorkspaceOwner(old.owner, "same-owner-workspace-replacement");
      assert.equal(openSaraBattleCommand("character-roll").ok, true);
      const replacement = getWorkspaceSessionForTests();
      replacementIdentity = {
        workspaceSessionId: replacement.workspaceSessionId,
        scenarioId: replacement.scenarioId,
      };
      throw new Error("replace workspace after committed opportunity");
    });
    fireWorkspaceActionStrict(dialog, "attack-miss", { apply: true });
    removeReplacement();
    removeReplacement = null;
    const replacement = getWorkspaceSessionForTests();
    assert.equal(replaced, true);
    assert.notEqual(replacement.workspaceSessionId, old.workspaceSessionId);
    assert.equal(replacement.workspaceSessionId, replacementIdentity.workspaceSessionId);
    assert.equal(replacement.scenarioId, replacementIdentity.scenarioId);
    assert.equal(getState().monk.combatAssistant.activeSequences.filter((entry) =>
      entry.parentFeature === "opportunity-attack").length, 1);
    assert.equal(getState().ui.turn.reactionUsed, true);
  } finally {
    removeReplacement?.();
    unsubscribe();
  }
});

test("session-generation replacement during opportunity commit preserves the replacement session", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  const originalClone = globalThis.structuredClone;
  let removeReplacement;
  let replaced = false;
  let inspectionAttempted = false;
  let replacementSnapshot;
  let replacementSession;
  try {
    assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
    const old = getWorkspaceSessionForTests();
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "10", secondD20: "",
    });
    removeReplacement = subscribe(() => {
      if (replaced) return;
      replaced = true;
      disposeWorkspaceOwner(old.owner, "opportunity-session-generation-replacement");
      openCharacterSession("sara-velaris", () => ({ status: "missing" }));
      replacementSnapshot = structuredClone(getState());
      assert.notEqual(getSessionContext().sessionGeneration, old.owner.sessionGeneration);
      assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
      replacementSession = getWorkspaceSessionForTests();
      const oldOperationId = old.opportunityIntent.operationId;
      globalThis.structuredClone = (value) => {
        if (value && typeof value === "object" &&
            (value.completedOperation?.operationId === oldOperationId ||
             value.operationId === oldOperationId)) {
          inspectionAttempted = true;
        }
        return originalClone(value);
      };
      throw new Error("replace session generation after opportunity commit");
    });
    fireWorkspaceActionStrict(dialog, "attack-miss", { apply: true });
    removeReplacement();
    removeReplacement = null;
    globalThis.structuredClone = originalClone;
    assert.equal(replaced, true);
    assert.equal(inspectionAttempted, false);
    assert.deepEqual(getState(), replacementSnapshot);
    assert.equal(getWorkspaceSessionForTests().workspaceSessionId,
      replacementSession.workspaceSessionId);
    assert.equal(getWorkspaceSessionForTests().owner.sessionGeneration,
      replacementSession.owner.sessionGeneration);
    assert.notEqual(getWorkspaceSessionForTests().workspaceSessionId, old.workspaceSessionId);
  } finally {
    globalThis.structuredClone = originalClone;
    removeReplacement?.();
    unsubscribe();
  }
});

test("end-battle from opportunity attack and damage steps removes stale workspace controls", () => {
  for (const step of ["attack-input", "damage-input"]) {
    const { dialog, unsubscribe } = installWorkspaceFixture();
    try {
      assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
      const baselineSequences = structuredClone(
        getState().monk.combatAssistant.activeSequences,
      );
      assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
      if (step === "damage-input") {
        dialog.forms.attack = new FixtureForm("attack", {
          profileId: "unarmed", rollMode: "normal", firstD20: "12", secondD20: "",
        });
        fireWorkspaceActionStrict(dialog, "attack-hit", { apply: true });
      }
      const active = getWorkspaceSessionForTests();
      assert.equal(active.currentStep, step);
      const staleAction = step === "attack-input" ? "attack-hit" : "submit-damage";
      const staleButton = dialog.footer.querySelector(
        `[data-workspace-action="${staleAction}"]`,
      ) ?? dialog.body.querySelector(`[data-workspace-action="${staleAction}"]`);
      assert.ok(staleButton?.isConnected);
      assert.equal(requestEndBattle({
        owner: getSessionContext(),
        battleId: getState().battleConsole.current.id,
      }, { confirm: () => true }).status, "applied");
      assert.equal(getWorkspaceSessionForTests(), null);
      assert.equal(getWorkspaceSessions().some((entry) =>
        entry.workspaceSessionId === active.workspaceSessionId), false);
      assert.deepEqual(getState().monk.combatAssistant.activeSequences, baselineSequences);
      const endedState = structuredClone(getState());
      const endedRevision = getSessionContext().stateRevision;
      const endedStorage = new Map(window.localStorage.values);
      dialog.fire("click", { target: staleButton });
      assert.deepEqual(getState(), endedState);
      assert.equal(getSessionContext().stateRevision, endedRevision);
      assert.deepEqual(window.localStorage.values, endedStorage);
    } finally {
      unsubscribe();
    }
  }
});

test("end-battle does not restore an opportunity child or its suspended parent", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
    assert.equal(openSaraBattleCommand("character-roll").ok, true);
    const parentId = getWorkspaceSessionForTests().workspaceSessionId;
    assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
    const childId = getWorkspaceSessionForTests().workspaceSessionId;
    assert.notEqual(childId, parentId);
    assert.equal(getWorkspaceSessions().some((entry) =>
      entry.workspaceSessionId === parentId && entry.suspended), true);
    assert.equal(requestEndBattle({
      owner: getSessionContext(),
      battleId: getState().battleConsole.current.id,
    }, { confirm: () => true }).status, "applied");
    assert.equal(getWorkspaceSessionForTests(), null);
    assert.equal(getWorkspaceSessions().some((entry) =>
      [parentId, childId].includes(entry.workspaceSessionId)), false);
    const state = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const storage = new Map(window.localStorage.values);
    fireWorkspaceAction(dialog, "attack-miss");
    fireWorkspaceAction(dialog, "cancel-attack-draft");
    assert.deepEqual(getState(), state);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.deepEqual(window.localStorage.values, storage);
    assert.equal(getWorkspaceSessionForTests(), null);
  } finally {
    unsubscribe();
  }
});

test("opportunity handler rejects a stale app-instance owner without committing", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
    const active = getWorkspaceSessionForTests();
    assert.ok(active.owner.appInstanceId);
    active.owner.appInstanceId = "stale-opportunity-app-instance";
    const before = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const storage = new Map(window.localStorage.values);
    fireWorkspaceActionStrict(dialog, "attack-miss");
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.deepEqual(window.localStorage.values, storage);
    assert.equal(getState().ui.turn.reactionUsed, false);
  } finally {
    unsubscribe();
  }
});

test("busy opportunity mutation cannot be bypassed by opening another workspace", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  let removeProbe;
  let openingResult;
  let busyWorkspaceId;
  try {
    assert.equal(openSaraBattleCommand("opportunity-unarmed").ok, true);
    const active = getWorkspaceSessionForTests();
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "10", secondD20: "",
    });
    removeProbe = subscribe(() => {
      if (openingResult) return;
      busyWorkspaceId = getWorkspaceSessionForTests()?.workspaceSessionId;
      openingResult = openSaraBattleCommand("character-roll");
    });
    fireWorkspaceActionStrict(dialog, "attack-miss", { apply: true });
    removeProbe();
    removeProbe = null;
    assert.equal(busyWorkspaceId, active.workspaceSessionId);
    assert.equal(openingResult.ok, false);
    assert.equal(getWorkspaceSessionForTests().workspaceSessionId, active.workspaceSessionId);
    assert.equal(getState().monk.combatAssistant.activeSequences.filter((entry) =>
      entry.parentFeature === "opportunity-attack").length, 1);
  } finally {
    removeProbe?.();
    unsubscribe();
  }
});
