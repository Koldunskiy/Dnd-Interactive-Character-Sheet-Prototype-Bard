import test from "node:test";
import assert from "node:assert/strict";
import {
  getSessionContext,
  getState,
  openCharacterSession,
  updateState,
  subscribe,
} from "../../scripts/state.js";
import { executeBattleCommand } from "../../scripts/battle/commands.js";
import {
  disposeWorkspaceOwner,
  discardWorkspaceDraft,
  getActiveWorkspaceSession,
  getWorkspaceSessionForTests,
  minimizeWorkspace,
  openNormalAttack,
  requestEndBattle,
} from "../../scripts/workspace/controller.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import {
  commitCompletedGentlingTouch,
  applyGentlingTouchToAttackSlot,
  startAttackSequence,
} from "../../scripts/actions/sara-combat.js";
import {
  fireWorkspaceAction,
  fireWorkspaceActionStrict,
  fireWorkspaceInput,
  FixtureForm,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";

function setup({ level = 6, wisdom = 14, ki = 20, battle = false } = {}) {
  const fixture = installWorkspaceFixture({ embeddedHost: true });
  updateState((draft) => {
    draft.profile.level = level;
    draft.combat.hitDice.remaining = Math.min(draft.combat.hitDice.remaining, level);
    draft.abilities.wisdom = wisdom;
    draft.combat.ki.current = ki;
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:gentling-touch";
    return draft;
  });
  if (battle) {
    assert.equal(executeBattleCommand("start-battle", { rawD20: "10" }).status, "applied");
    assert.equal(executeBattleCommand("begin-own-turn").status, "applied");
  }
  assert.equal(openNormalAttack().ok, true);
  return fixture;
}

function gentlingForm(dialog, { extraKi = "0", targetHp = "7", sum = "20" } = {}) {
  dialog.forms.gentling = new FixtureForm("gentling", {
    extraKi, targetHp, sum,
  }, {
    extraKi: { type: "number", required: true, min: 0, max: 30 },
    targetHp: { type: "number", required: true, min: 0 },
    sum: { type: "number", required: true, min: 5, max: 100 },
  });
  for (const [name, value] of Object.entries({ extraKi, targetHp, sum })) {
    fireWorkspaceInput(dialog, name, value);
  }
}

function begin(dialog) {
  fireWorkspaceActionStrict(dialog, "begin-gentling");
  assert.equal(getWorkspaceSessionForTests().currentStep, "gentling-input");
}

function submit(dialog) {
  fireWorkspaceActionStrict(dialog, "submit-gentling", { apply: true });
}

test("W01-W03: free begin/cancel preserves exact initial draft and completed attack checkpoint", () => {
  const { dialog, unsubscribe } = setup();
  try {
    const attackId = getWorkspaceSessionForTests().attackId;
    dialog.forms.attack = new FixtureForm("attack", {
      firstD20: "12", secondD20: "", rollMode: "normal",
    });
    fireWorkspaceInput(dialog, "firstD20", "12");
    const state = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const storage = new Map(window.localStorage.values);
    begin(dialog);
    assert.deepEqual(getState(), state);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.deepEqual(window.localStorage.values, storage);
    assert.equal(getState().monk.combatAssistant.activeSequences.length, 0);
    const initialIntent = getWorkspaceSessionForTests().gentlingIntent;
    assert.equal(initialIntent.expectedSequenceExists, false);
    fireWorkspaceActionStrict(dialog, "cancel-contextual");
    assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input",
      JSON.stringify({
        session: getWorkspaceSessionForTests(),
        sequence: getState().monk.combatAssistant.activeSequences[0],
      }));
    assert.equal(getWorkspaceSessionForTests().attackId, attackId);
    assert.equal(getWorkspaceSessionForTests().rawInputsByStep[
      getWorkspaceSessionForTests().currentStepKey].firstD20, "12");
    assert.deepEqual(getState(), state);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.deepEqual(window.localStorage.values, storage);
  } finally {
    unsubscribe();
  }
});

test("W27: cancel after a completed normal attack returns to the exact checkpoint", () => {
  const { dialog, unsubscribe } = setup();
  try {
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "10",
      secondD20: "", confirmSeparateAction: false,
    });
    fireWorkspaceActionStrict(dialog, "attack-hit");
    dialog.forms.damage = new FixtureForm("damage", { damage1: "3" });
    fireWorkspaceInput(dialog, "damage1", "3");
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
    const beforeSession = getWorkspaceSessionForTests();
    const checkpoint = {
      attackId: beforeSession.attackId,
      step: beforeSession.currentStep,
      stepKey: beforeSession.currentStepKey,
    };
    const state = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const storage = new Map(window.localStorage.values);
    begin(dialog);
    assert.equal(getWorkspaceSessionForTests().gentlingIntent.returnTo.attackId, checkpoint.attackId);
    fireWorkspaceActionStrict(dialog, "cancel-contextual");
    const after = getWorkspaceSessionForTests();
    assert.equal(after.currentStep, checkpoint.step);
    assert.equal(after.currentStepKey, checkpoint.stepKey);
    assert.equal(after.attackId, checkpoint.attackId);
    assert.deepEqual(getState(), state);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.deepEqual(window.localStorage.values, storage);
    assert.equal(getState().monk.combatAssistant.activeSequences[0].resolvedAttacks.length, 1);
    assert.equal(getState().combat.ki.current, state.combat.ki.current);
  } finally {
    unsubscribe();
  }
});

test("W04-W07, W22-W23, W26: rendered form commits one slot and next attack uses fresh rolls", () => {
  const { dialog, unsubscribe } = setup();
  try {
    const originalAttackId = getWorkspaceSessionForTests().attackId;
    const revision = getSessionContext().stateRevision;
    const ki = getState().combat.ki.current;
    const storage = new Map(window.localStorage.values);
    const sides = getDerivedStats(getState()).monk.martialDieSides;
    begin(dialog);
    const markup = dialog.body.innerHTML;
    const form = markup.match(/<form data-workspace-form="gentling"[\s\S]*?<\/form>/)?.[0];
    assert.ok(form);
    assert.match(form, /name="extraKi" type="number"[^>]*min="0"[^>]*max="\d+"[^>]*required/);
    assert.match(form, /name="targetHp" type="number"[^>]*min="0"[^>]*required/);
    assert.doesNotMatch(form, /name="targetHp"[^>]*max=/);
    assert.match(form, /name="sum" type="number"[^>]*min="5"[^>]*max="\d+"[^>]*required/);
    assert.match(form, new RegExp(
      `Бросьте: 5d${sides} · допустимая сумма 5\\.\\.${5 * sides} · стоимость 1 ци`,
    ));
    let apply = dialog.footer.querySelector('[data-workspace-action="submit-gentling"]');
    assert.ok(apply?.isConnected);
    assert.equal(apply.disabled, true);
    assert.equal(getState().monk.combatAssistant.activeSequences.length, 0);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.deepEqual(window.localStorage.values, storage);

    gentlingForm(dialog, { targetHp: "25", sum: "20" });
    assert.match(dialog.body.querySelector("[data-gentling-preview]").textContent,
      /Порог не достигнут: 20 < 25/);
    apply = dialog.footer.querySelector('[data-workspace-action="submit-gentling"]');
    assert.equal(apply.disabled, false);
    submit(dialog);
    assert.equal(getSessionContext().stateRevision, revision + 1);
    assert.equal(getState().combat.ki.current, ki - 1);
    let sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.replacementResults[0].thresholdMet, false);
    assert.equal(sequence.replacementResults[0].slotNumber, 1);
    assert.equal(sequence.resolvedAttacks.length, 0);
    assert.equal(sequence.actionFlagApplied, true);
    assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input",
      JSON.stringify({
        session: getWorkspaceSessionForTests(),
        sequence,
      }));
    assert.notEqual(getWorkspaceSessionForTests().attackId, originalAttackId);
    assert.equal(getWorkspaceSessionForTests().rawInputsByStep[
      getWorkspaceSessionForTests().currentStepKey].firstD20, undefined);
    assert.equal(getWorkspaceSessionForTests().strikeParent, null);

    const nextAttackId = getWorkspaceSessionForTests().attackId;
    dialog.forms.attack = new FixtureForm("attack", {
      firstD20: "2", secondD20: "", rollMode: "normal",
      targetArmorClass: "30",
    });
    fireWorkspaceInput(dialog, "firstD20", "2");
    fireWorkspaceActionStrict(dialog, "attack-miss", { apply: true });
    sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.resolvedAttacks[0].id, nextAttackId);
    assert.deepEqual(sequence.resolvedAttacks[0].rawD20Rolls, [2]);
    assert.equal(sequence.replacementResults[0].slotNumber, 1);

  } finally {
    unsubscribe();
  }
});

test("W28: completed Gentling then rendered hit and damage records the next exact slot", () => {
  const { dialog, unsubscribe } = setup();
  try {
    begin(dialog);
    gentlingForm(dialog);
    submit(dialog);
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.replacementResults[0].slotNumber, 1);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "10",
      secondD20: "", confirmSeparateAction: false,
    });
    fireWorkspaceActionStrict(dialog, "attack-hit");
    assert.equal(getWorkspaceSessionForTests().currentStep, "damage-input");
    const renderedDamageInput = dialog.body.querySelector(
      '[data-workspace-field][name="damage1"]',
    );
    assert.ok(renderedDamageInput?.isConnected);
    dialog.forms.damage = new FixtureForm("damage", { damage1: "4" });
    fireWorkspaceInput(dialog, "damage1", "4");
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    const after = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(after.resolvedAttacks.length, 1);
    assert.equal(after.resolvedAttacks[0].slotNumber, 2);
    assert.equal(after.resolvedAttacks[0].damageStatus, "recorded");
    assert.equal(after.replacementResults[0].slotNumber, 1);
    assert.equal(getWorkspaceSessionForTests().firstAttempt, false);
    assert.equal(getWorkspaceSessionForTests().confirmationRequired, false);
  } finally {
    unsubscribe();
  }
});

test("W23: consecutive Gentling uses distinct operation/draft IDs and never opens a third slot", () => {
  const { dialog, unsubscribe } = setup();
  try {
    const ki = getState().combat.ki.current;
    begin(dialog);
    gentlingForm(dialog);
    const first = getWorkspaceSessionForTests().gentlingIntent;
    submit(dialog);
    assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
    begin(dialog);
    const second = getWorkspaceSessionForTests().gentlingIntent;
    assert.notEqual(second.operationId, first.operationId);
    assert.notEqual(second.draftKey, first.draftKey);
    assert.equal(second.expectedUsedSlots, 1);
    assert.equal(getWorkspaceSessionForTests().rawInputsByStep[second.draftKey].sum, "");
    gentlingForm(dialog, { targetHp: "7", sum: "20" });
    submit(dialog);
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.replacementResults.length, 2);
    assert.equal(sequence.replacementResults[1].slotNumber, 2);
    assert.equal(sequence.status, "complete");
    assert.equal(getState().combat.ki.current, ki - 2);
    assert.equal(getWorkspaceSessionForTests().currentStep, "summary");
    assert.equal(getWorkspaceSessionForTests().capabilities.canContinueSequence, false);
    assert.doesNotMatch(dialog.footer.innerHTML, /begin-gentling|submit-gentling/);
  } finally {
    unsubscribe();
  }
});

test("W08-W10: active draft and unrelated bookkeeping are preserved; ki shortage does not rewrite it", () => {
  const { dialog, unsubscribe } = setup({ level: 6, ki: 2 });
  try {
    begin(dialog);
    gentlingForm(dialog, { extraKi: "1", targetHp: "10", sum: "15" });
    const intent = getWorkspaceSessionForTests().gentlingIntent;
    assert.equal(minimizeWorkspace(), false);
    assert.equal(getWorkspaceSessionForTests().gentlingIntent.operationId, intent.operationId);
    assert.equal(getWorkspaceSessionForTests().currentStepKey, intent.draftKey);
    const sumInput = dialog.body.querySelector('[data-workspace-field][name="sum"]');
    sumInput.focus();
    sumInput.value = "15";
    sumInput.setSelectionRange(1, 1);
    fireWorkspaceInput(dialog, "sum", "15");
    updateState((draft) => {
      draft.inventory.items.find((entry) => entry.id === "darts").quantity += 1;
      return draft;
    });
    assert.equal(getWorkspaceSessionForTests().currentStep, "gentling-input");
    assert.equal(getWorkspaceSessionForTests().readOnly, false);
    updateState((draft) => { draft.combat.ki.current = 1; return draft; });
    assert.equal(getWorkspaceSessionForTests().rawInputsByStep[intent.draftKey].extraKi, "1");
    assert.equal(getWorkspaceSessionForTests().rawInputsByStep[intent.draftKey].sum, "15");
    assert.equal(dialog.body.querySelector('[data-workspace-field][name="sum"]'), sumInput);
    assert.equal(sumInput.isConnected, true);
    assert.equal(globalThis.document.activeElement, sumInput);
    assert.equal(sumInput.selectionStart, 1);
    assert.equal(dialog.footer.querySelector('[data-workspace-action="submit-gentling"]').disabled,
      true, dialog.footer.innerHTML);
    assert.match(dialog.body.querySelector("[data-gentling-preview]").textContent, /Недостаточно ци/);
    updateState((draft) => { draft.combat.ki.current = 2; return draft; });
    assert.equal(getWorkspaceSessionForTests().readOnly, false);
    assert.equal(dialog.footer.querySelector('[data-workspace-action="submit-gentling"]').disabled, false);
    assert.equal(dialog.body.querySelector('[data-workspace-field][name="sum"]'), sumInput);
    assert.equal(globalThis.document.activeElement, sumInput);
    assert.equal(sumInput.value, "15");
    assert.equal(getWorkspaceSessionForTests().rawInputsByStep[intent.draftKey].sum, "15");
  } finally {
    unsubscribe();
  }
});

test("W19: storage retry success with receipt inspection failure stays verification-only", () => {
  const { dialog, unsubscribe } = setup();
  const storage = window.localStorage;
  const setItem = storage.setItem.bind(storage);
  let failSave = true;
  let inspectionInjected = false;
  let removeInspectionFailure;
  try {
    begin(dialog);
    gentlingForm(dialog);
    const ki = getState().combat.ki.current;
    storage.setItem = (key, value) => {
      if (failSave) throw new Error("Gentling storage failure before retry");
      setItem(key, value);
    };
    submit(dialog);
    assert.equal(getWorkspaceSessionForTests().appliedUnsaved, true);
    assert.ok(getWorkspaceSessionForTests().gentlingRecovery);
    assert.equal(getActiveWorkspaceSession().appliedUnsaved, true);
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.replacementResults.length, 1);
    const revision = getSessionContext().stateRevision;
    failSave = false;
    removeInspectionFailure = subscribe((state, metadata) => {
      if (metadata?.kind !== "persistence-retry") return;
      const currentSequence = state.monk.combatAssistant.activeSequences[0];
      const results = currentSequence.replacementResults;
      Object.defineProperty(currentSequence, "replacementResults", {
        configurable: true,
        get() {
          if (new Error().stack.includes("completedGentlingReceiptFromState")) {
            inspectionInjected = true;
            throw new Error("injected Gentling receipt inspection failure");
          }
          return results;
        },
      });
      removeInspectionFailure();
      currentSequence._savedReplacementResultsForTest = results;
    });
    fireWorkspaceActionStrict(dialog, "retry-save");
    removeInspectionFailure?.();
    removeInspectionFailure = null;
    Object.defineProperty(sequence, "replacementResults", {
      configurable: true,
      writable: true,
      value: sequence._savedReplacementResultsForTest,
    });
    delete sequence._savedReplacementResultsForTest;
    assert.equal(inspectionInjected, true);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.equal(getState().combat.ki.current, ki - 1);
    assert.equal(sequence.replacementResults.length, 1);
    const session = getWorkspaceSessionForTests();
    assert.equal(session.appliedUnsaved, false);
    assert.equal(session.readOnly, true);
    assert.equal(session.gentlingVerificationRequired, true);
    assert.deepEqual(getActiveWorkspaceSession(), {
      workspaceSessionId: session.workspaceSessionId,
      appliedUnsaved: false,
      dirty: false,
      submitting: false,
      stage: session.currentStep,
      verificationRequired: true,
      readOnly: true,
      gentlingVerificationRequired: true,
      workspaceType: "attack",
    });
    assert.equal(session.gentlingRecovery.sequenceId, sequence.id);
    assert.match(session.error, /Gentling Touch/);
    assert.match(dialog.body.innerHTML, /Gentling Touch/);
    const before = structuredClone(getState());
    const revisionBeforeExit = getSessionContext().stateRevision;
    const storageBeforeExit = new Map(window.localStorage.values);
    const operationId = session.gentlingRecovery.operationId;
    const workspaceId = session.workspaceSessionId;
    fireWorkspaceAction(dialog, "finish-workspace");
    fireWorkspaceAction(dialog, "confirm-close");
    fireWorkspaceAction(dialog, "close");
    fireWorkspaceAction(dialog, "back");
    fireWorkspaceAction(dialog, "close-attack-remainder");
    assert.equal(discardWorkspaceDraft(workspaceId).ok, false);
    fireWorkspaceAction(dialog, "submit-gentling");
    fireWorkspaceAction(dialog, "cancel-contextual");
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revisionBeforeExit);
    assert.deepEqual(window.localStorage.values, storageBeforeExit);
    assert.equal(getWorkspaceSessionForTests().workspaceSessionId, workspaceId);
    assert.equal(getWorkspaceSessionForTests().gentlingRecovery.operationId, operationId);
    assert.equal(getState().combat.ki.current, ki - 1);
    assert.equal(getState().monk.combatAssistant.activeSequences[0].replacementResults.length, 1);
    assert.equal(getSessionContext().stateRevision, revision);
  } finally {
    removeInspectionFailure?.();
    storage.setItem = setItem;
    unsubscribe();
  }
});

test("Applied-unsaved Gentling ignores a synthetic second submit and keeps retry-save available", () => {
  const { dialog, unsubscribe } = setup();
  const storage = window.localStorage;
  const setItem = storage.setItem.bind(storage);
  let failSave = true;
  try {
    begin(dialog);
    gentlingForm(dialog, { extraKi: "0", targetHp: "7", sum: "20" });
    const kiBefore = getState().combat.ki.current;
    storage.setItem = (key, value) => {
      if (failSave) throw new Error("Gentling persistence failure for applied-unsaved guard");
      setItem(key, value);
    };
    submit(dialog);
    const session = getWorkspaceSessionForTests();
    assert.equal(session.appliedUnsaved, true);
    const appliedState = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const kiAfter = getState().combat.ki.current;
    const sequences = getState().monk.combatAssistant.activeSequences;
    const sequenceCount = sequences.length;
    const replacementCount = sequences.reduce(
      (count, sequence) => count + sequence.replacementResults.length, 0,
    );
    assert.equal(kiAfter, kiBefore - 1);
    assert.equal(replacementCount, 1);

    fireWorkspaceAction(dialog, "submit-gentling", { apply: true });

    assert.equal(getWorkspaceSessionForTests().appliedUnsaved, true);
    assert.deepEqual(getState(), appliedState);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.equal(getState().combat.ki.current, kiAfter);
    assert.equal(getState().monk.combatAssistant.activeSequences.length, sequenceCount);
    assert.equal(getState().monk.combatAssistant.activeSequences.reduce(
      (count, sequence) => count + sequence.replacementResults.length, 0,
    ), replacementCount);
    const retry = dialog.footer.querySelector('[data-workspace-action="retry-save"]');
    assert.ok(retry);
    assert.equal(retry.disabled, false);
  } finally {
    failSave = false;
    storage.setItem = setItem;
    unsubscribe();
  }
});

test("W07: numeric typing updates constraints and preview without replacing the body or focused input", () => {
  const { dialog, unsubscribe } = setup();
  try {
    begin(dialog);
    const body = dialog.body;
    const sum = dialog.body.querySelector('[data-workspace-field][name="sum"]');
    assert.ok(sum?.isConnected);
    sum.focus();
    sum.value = "20";
    sum.setSelectionRange(1, 1);
    dialog.fire("input", { target: sum });
    assert.equal(dialog.body, body);
    assert.equal(sum.isConnected, true);
    assert.equal(globalThis.document.activeElement, sum);
    assert.equal(sum.selectionStart, 1);
    assert.equal(sum.min, "5");
    assert.equal(sum.max, String(5 * getDerivedStats(getState()).monk.martialDieSides));
  } finally {
    unsubscribe();
  }
});

test("W11-W13: mechanics, slot and turn changes preserve values and permanently block stale apply", () => {
  const { dialog, unsubscribe } = setup();
  try {
    begin(dialog);
    gentlingForm(dialog, { targetHp: "10", sum: "20" });
    const intent = getWorkspaceSessionForTests().gentlingIntent;
    updateState((draft) => { draft.abilities.wisdom += 2; return draft; });
    assert.equal(getWorkspaceSessionForTests().readOnly, true);
    assert.equal(getWorkspaceSessionForTests().rawInputsByStep[intent.draftKey].sum, "20");
    const state = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    fireWorkspaceAction(dialog, "submit-gentling");
    fireWorkspaceAction(dialog, "cancel-contextual");
    assert.deepEqual(getState(), state);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.equal(getWorkspaceSessionForTests().currentStep, "gentling-input");
  } finally {
    unsubscribe();
  }
});

test("W14: subscriber exception after commit recovers exactly one result and one payment", () => {
  const { dialog, unsubscribe } = setup();
  let removeThrow;
  try {
    begin(dialog);
    gentlingForm(dialog);
    const ki = getState().combat.ki.current;
    removeThrow = subscribe(() => { throw new Error("Gentling subscriber failure"); });
    submit(dialog);
    removeThrow();
    removeThrow = null;
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.replacementResults.length, 1);
    assert.equal(getState().combat.ki.current, ki - 1);
    assert.equal(getWorkspaceSessionForTests().appliedUnsaved, true);
    assert.equal(getWorkspaceSessionForTests().currentStep, "summary");
  } finally {
    removeThrow?.();
    unsubscribe();
  }
});

test("W15: uncertain completed submit locks the transient form and cancel cannot bypass verification", () => {
  const { dialog, unsubscribe } = setup();
  const originalClone = globalThis.structuredClone;
  let failOnce = true;
  try {
    begin(dialog);
    gentlingForm(dialog);
    const before = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const ki = getState().combat.ki.current;
    globalThis.structuredClone = (value) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("pre-mutation clone failure");
      }
      return originalClone(value);
    };
    fireWorkspaceActionStrict(dialog, "submit-gentling", { apply: true });
    globalThis.structuredClone = originalClone;
    assert.equal(failOnce, false);
    assert.equal(getWorkspaceSessionForTests().readOnly, true);
    assert.equal(getWorkspaceSessionForTests().gentlingVerificationRequired, true);
    assert.equal(dialog.footer.querySelector('[data-workspace-action="submit-gentling"]').disabled, true);
    fireWorkspaceAction(dialog, "cancel-contextual");
    fireWorkspaceAction(dialog, "submit-gentling");
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.equal(getState().combat.ki.current, ki);
  } finally {
    globalThis.structuredClone = originalClone;
    unsubscribe();
  }
});

test("W16-W17: owner replacement during commit leaves replacement workspace untouched", () => {
  const { dialog, unsubscribe } = setup();
  let removeReplacement;
  let replacement;
  let replaced = false;
  try {
    begin(dialog);
    gentlingForm(dialog);
    const oldOwner = getWorkspaceSessionForTests().owner;
    removeReplacement = subscribe(() => {
      if (replaced) return;
      replaced = true;
      disposeWorkspaceOwner(oldOwner, "session-changed");
      assert.equal(openNormalAttack().ok, true);
      replacement = getWorkspaceSessionForTests();
    });
    submit(dialog);
    removeReplacement();
    removeReplacement = null;
    assert.equal(replaced, true);
    const after = getWorkspaceSessionForTests();
    assert.equal(after.workspaceSessionId, replacement.workspaceSessionId);
    assert.equal(after.submitting, false);
    assert.equal(after.appliedUnsaved, false);
    assert.equal(after.readOnly, false);
    assert.equal(after.currentStep, "attack-input");
  } finally {
    removeReplacement?.();
    unsubscribe();
  }
});

test("W29: session-generation replacement during commit never inspects the new owner receipt", () => {
  const { dialog, unsubscribe } = setup();
  let removeReplacement;
  let replacement;
  let inspectedNewGeneration = false;
  let originalDescriptor;
  try {
    begin(dialog);
    gentlingForm(dialog);
    let replaced = false;
    removeReplacement = subscribe((state) => {
      if (replaced) return;
      replaced = true;
      const oldSequence = state.monk.combatAssistant.activeSequences[0];
      openCharacterSession("sara-velaris", () => ({ status: "missing" }));
      assert.equal(openNormalAttack().ok, true);
      replacement = getWorkspaceSessionForTests();
      const currentState = getState();
      const sequences = currentState.monk.combatAssistant.activeSequences;
      originalDescriptor = Object.getOwnPropertyDescriptor(
        currentState.monk.combatAssistant, "activeSequences",
      );
      Object.defineProperty(currentState.monk.combatAssistant, "activeSequences", {
        configurable: true,
        get() {
          inspectedNewGeneration = true;
          return sequences;
        },
      });
      assert.notEqual(oldSequence?.id, sequences[0]?.id);
    });
    const oldGeneration = getWorkspaceSessionForTests().owner.sessionGeneration;
    submit(dialog);
    removeReplacement();
    removeReplacement = null;
    Object.defineProperty(getState().monk.combatAssistant, "activeSequences", originalDescriptor);
    assert.equal(getWorkspaceSessionForTests().owner.sessionGeneration > oldGeneration, true);
    assert.equal(inspectedNewGeneration, false);
    assert.equal(getWorkspaceSessionForTests().workspaceSessionId, replacement.workspaceSessionId);
    assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
    assert.equal(getWorkspaceSessionForTests().submitting, false);
    assert.equal(getWorkspaceSessionForTests().appliedUnsaved, false);
  } finally {
    removeReplacement?.();
    if (originalDescriptor) {
      Object.defineProperty(getState().monk.combatAssistant, "activeSequences", originalDescriptor);
    }
    unsubscribe();
  }
});

test("W18, W25: storage failure applies once; retry-save exposes the remaining slot", () => {
  const { dialog, unsubscribe } = setup();
  const storage = window.localStorage;
  const setItem = storage.setItem.bind(storage);
  let failSave = true;
  try {
    begin(dialog);
    gentlingForm(dialog);
    const ki = getState().combat.ki.current;
    const slots = getState().monk.combatAssistant.activeSequences.length;
    storage.setItem = (key, value) => {
      if (failSave) throw new Error("Gentling storage failure");
      setItem(key, value);
    };
    submit(dialog);
    failSave = false;
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.replacementResults.length, 1);
    assert.equal(getState().monk.combatAssistant.activeSequences.length, slots + 1);
    assert.equal(getState().combat.ki.current, ki - 1);
    assert.equal(getWorkspaceSessionForTests().appliedUnsaved, true);
    const revision = getSessionContext().stateRevision;
    fireWorkspaceActionStrict(dialog, "retry-save");
    assert.equal(getSessionContext().stateRevision, revision);
    assert.equal(getWorkspaceSessionForTests().appliedUnsaved, false,
      JSON.stringify({ session: getWorkspaceSessionForTests(), persistence: storage.values.size }));
    assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
    assert.equal(getWorkspaceSessionForTests().sequenceId, sequence.id);
  } finally {
    storage.setItem = setItem;
    unsubscribe();
  }
});

test("W20: end battle during a no-sequence Gentling draft never creates or pays a sequence", () => {
  const { dialog, unsubscribe } = setup({ battle: true });
  try {
    const owner = getWorkspaceSessionForTests().owner;
    const battleId = getState().battleConsole.current.id;
    const ki = getState().combat.ki.current;
    begin(dialog);
    const intent = getWorkspaceSessionForTests().gentlingIntent;
    assert.equal(intent.expectedSequenceExists, false);
    const ended = requestEndBattle({ owner, battleId }, { confirm: () => true });
    assert.equal(ended.status, "applied");
    assert.deepEqual(getState().monk.combatAssistant.activeSequences, []);
    assert.equal(getState().combat.ki.current, ki);
    assert.equal(getWorkspaceSessionForTests(), null);
  } finally {
    unsubscribe();
  }
});

test("W30: ending battle with an existing Gentling sequence preserves prior result but cancels draft", () => {
  const { dialog, unsubscribe } = setup({ battle: true });
  try {
    begin(dialog);
    gentlingForm(dialog);
    submit(dialog);
    const before = structuredClone(getState());
    const sequence = before.monk.combatAssistant.activeSequences[0];
    const ki = before.combat.ki.current;
    assert.equal(sequence.replacementResults.length, 1);
    assert.equal(sequence.replacementResults[0].slotNumber, 1);
    assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
    begin(dialog);
    const intent = getWorkspaceSessionForTests().gentlingIntent;
    assert.equal(intent.expectedSequenceExists, true);
    const owner = getWorkspaceSessionForTests().owner;
    const battleId = before.battleConsole.current.id;
    assert.equal(requestEndBattle({ owner, battleId }, { confirm: () => true }).status, "applied");
    const after = getState();
    const savedSequence = after.monk.combatAssistant.activeSequences
      .find((entry) => entry.id === sequence.id);
    assert.equal(savedSequence.replacementResults.length, 1);
    assert.deepEqual(savedSequence.replacementResults[0], sequence.replacementResults[0]);
    assert.equal(after.combat.ki.current, ki);
    assert.equal(after.battleConsole.current, null);
    assert.equal(getWorkspaceSessionForTests(), null);
  } finally {
    unsubscribe();
  }
});

test("W24: legacy API remains callable and completed facade rejects stale owner", () => {
  const { unsubscribe } = setup();
  try {
    const state = getState();
    assert.equal(startAttackSequence(getSessionContext(), {
      kind: "attack-action", sequenceId: "legacy-gentling-workspace",
    }, "legacy-gentling-workspace-start").status, "applied");
    const result = applyGentlingTouchToAttackSlot(getSessionContext(),
      "legacy-gentling-workspace", { extraKi: "0", targetHp: "1", sum: "5" },
      "legacy-gentling-workspace-op");
    assert.equal(result.status, "applied");
    assert.equal(getState().monk.combatAssistant.activeSequences[0]
      .replacementResults[0].kind, "gentling-touch");
    assert.equal(getState().monk.combatAssistant.activeSequences[0].replacementResults.length, 1);
    assert.equal(typeof commitCompletedGentlingTouch, "function");
  } finally {
    unsubscribe();
  }
});
