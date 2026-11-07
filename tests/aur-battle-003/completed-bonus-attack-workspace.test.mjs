import test from "node:test";
import assert from "node:assert/strict";
import {
  getSessionContext,
  getState,
  openCharacterSession,
  subscribe,
  updateState,
} from "../../scripts/state.js";
import {
  getWorkspaceSessionForTests,
  discardWorkspaceDraft,
  openNormalAttack,
  openSaraBattleCommand,
  disposeWorkspaceOwner,
  reconcileWorkspaceAfterStateChange,
  requestEndBattle,
} from "../../scripts/workspace/controller.js";
import {
  fireWorkspaceActionStrict,
  fireWorkspaceInput,
  FixtureForm,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";
import { recordAttackOutcome, startAttackSequence } from "../../scripts/actions/sara-combat.js";
import { beginOwnTurn, startBattle } from "../../scripts/battle/transitions.js";

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
    openCommand(dialog, "flurry");
    enterAttack(dialog, 12, "attack-hit");
    dialog.forms.damage = new FixtureForm("damage", { damage1: "" });
    fireWorkspaceInput(dialog, "damage1", "4");
    const workspaceBeforeBack = getWorkspaceSessionForTests();
    const attackDraftKey = `attack-input:${workspaceBeforeBack.attackId}`;
    const damageDraftKey = `damage-input:${workspaceBeforeBack.attackId}`;
    const savedAttackInput = structuredClone(workspaceBeforeBack.rawInputsByStep[attackDraftKey]);
    const savedDamageInput = structuredClone(workspaceBeforeBack.rawInputsByStep[damageDraftKey]);
    const before = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    fireWorkspaceActionStrict(dialog, "back");
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
    assert.deepEqual(getWorkspaceSessionForTests().rawInputsByStep[attackDraftKey], savedAttackInput);
    assert.deepEqual(getWorkspaceSessionForTests().rawInputsByStep[damageDraftKey], savedDamageInput);
    enterAttack(dialog, 1, "attack-miss");
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.resolvedAttacks[0].hitResult, "miss");
    assert.equal(getWorkspaceSessionForTests().pendingAttackIntent, null);
    fireWorkspaceActionStrict(dialog, "next-attack");
    enterAttack(dialog, 12, "attack-hit");
    dialog.forms.damage = new FixtureForm("damage", { damage1: "" });
    fireWorkspaceInput(dialog, "damage1", "5");
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    const completed = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(completed.resolvedAttacks.length, 2);
    assert.equal(completed.resolvedAttacks[1].hitResult, "hit");
    assert.deepEqual(completed.resolvedAttacks[1].damageRolls, [5]);
    assert.equal(getWorkspaceSessionForTests().pendingAttackIntent, null);
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

test("critical damage apply control remains disabled until both physical dice exist", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    openCommand(dialog, "flurry");
    enterAttack(dialog, 20, "attack-hit");
    dialog.forms.damage = new FixtureForm("damage", { damage1: "", damage2: "" });
    const disabled = dialog.footer.querySelector('[data-workspace-action="submit-damage"]');
    assert.ok(disabled?.isConnected);
    assert.equal(disabled.disabled, true);
    fireWorkspaceInput(dialog, "damage1", "3");
    assert.equal(dialog.footer.querySelector('[data-workspace-action="submit-damage"]').disabled, true,
      dialog.footer.innerHTML);
    fireWorkspaceInput(dialog, "damage2", "4");
    const enabled = dialog.footer.querySelector('[data-workspace-action="submit-damage"]');
    assert.ok(enabled?.isConnected);
    assert.equal(enabled.disabled, false);
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    const attack = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
    assert.equal(attack.critical, true);
    assert.deepEqual(attack.damageRolls, [3, 4]);
  } finally {
    unsubscribe();
  }
});

test("post-commit subscriber exceptions recover first miss and hit+damage without replay", () => {
  for (const mode of ["miss", "hit"]) {
    const { dialog, unsubscribe } = installWorkspaceFixture();
    let removeFailure;
    try {
      openCommand(dialog, "flurry");
      const beforeKi = getState().combat.ki.current;
      if (mode === "miss") {
        dialog.forms.attack = new FixtureForm("attack", {
          profileId: "unarmed", rollMode: "normal", firstD20: "1",
          secondD20: "", confirmSeparateAction: false,
        });
      } else {
        enterAttack(dialog, 10, "attack-hit");
        dialog.forms.damage = new FixtureForm("damage", { damage1: "3" });
        fireWorkspaceInput(dialog, "damage1", "3");
      }
      let throwOnce = true;
      removeFailure = subscribe(() => {
        if (throwOnce) {
          throwOnce = false;
          throw new Error("bonus post-commit subscriber failure");
        }
      });
      fireWorkspaceActionStrict(dialog, mode === "miss" ? "attack-miss" : "submit-damage", {
        apply: true,
      });
      removeFailure();
      removeFailure = null;
      const sequence = getState().monk.combatAssistant.activeSequences[0];
      assert.equal(sequence.resolvedAttacks.length, 1);
      assert.equal(getState().combat.ki.current, beforeKi - 1);
      assert.equal(getState().ui.turn.bonusActionUsed, true);
      assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
      assert.equal(getWorkspaceSessionForTests().appliedUnsaved, true);
      assert.equal(getWorkspaceSessionForTests().pendingAttackIntent, null);
    } finally {
      removeFailure?.();
      unsubscribe();
    }
  }
});

test("canonical inspection exception locks the committed bonus draft against apply, cancel, and Back", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  let removeFailure;
  let stateForRestore;
  let sequences;
  try {
    openCommand(dialog, "flurry");
    enterAttack(dialog, 10, "attack-hit");
    dialog.forms.damage = new FixtureForm("damage", { damage1: "3" });
    fireWorkspaceInput(dialog, "damage1", "3");
    let throwOnInspection = true;
    removeFailure = subscribe((state) => {
      stateForRestore = state;
      sequences = state.monk.combatAssistant.activeSequences;
      Object.defineProperty(state.monk.combatAssistant, "activeSequences", {
        configurable: true,
        enumerable: true,
        get() {
          if (throwOnInspection) {
            throwOnInspection = false;
            throw new Error("bonus receipt inspection failure");
          }
          return sequences;
        },
      });
      throw new Error("bonus commit subscriber failure");
    });
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    removeFailure();
    removeFailure = null;
    Object.defineProperty(stateForRestore.monk.combatAssistant, "activeSequences", {
      configurable: true, enumerable: true, writable: true, value: sequences,
    });
    const afterCommit = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    assert.equal(sequences[0].resolvedAttacks.length, 1);
    assert.equal(getWorkspaceSessionForTests().readOnly, true,
      JSON.stringify({
        status: getWorkspaceSessionForTests().status,
        error: getWorkspaceSessionForTests().error,
        step: getWorkspaceSessionForTests().currentStep,
        throwOnInspection,
      }));
    assert.equal(getWorkspaceSessionForTests().operationVerificationRequired, true);
    assert.equal(getWorkspaceSessionForTests().dirty, true);
    const workspaceBeforeDiscard = getWorkspaceSessionForTests();
    const stateBeforeDiscard = structuredClone(getState());
    const revisionBeforeDiscard = getSessionContext().stateRevision;
    const storageBeforeDiscard = new Map(window.localStorage.values);
    assert.equal(discardWorkspaceDraft(workspaceBeforeDiscard.workspaceSessionId).ok, false);
    assert.deepEqual(getState(), stateBeforeDiscard);
    assert.equal(getSessionContext().stateRevision, revisionBeforeDiscard);
    assert.deepEqual(window.localStorage.values, storageBeforeDiscard);
    assert.deepEqual(getWorkspaceSessionForTests().rawInputsByStep,
      workspaceBeforeDiscard.rawInputsByStep);
    reconcileWorkspaceAfterStateChange(getState(), {
      kind: "persistence-retry",
      persistenceResult: { ok: true },
    });
    assert.equal(getWorkspaceSessionForTests().operationVerificationRequired, true);
    assert.equal(dialog.footer.querySelector('[data-workspace-action="submit-damage"]').disabled, true);
    assert.equal(dialog.footer.querySelector('[data-workspace-action="cancel-attack-draft"]'), null);
    assert.equal(dialog.header.querySelector('[data-workspace-action="back"]'), null);
    assert.throws(() => fireWorkspaceActionStrict(dialog, "back"), /Expected connected rendered workspace control/);
    assert.deepEqual(getState(), afterCommit);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.equal(sequences[0].resolvedAttacks.length, 1);
  } finally {
    removeFailure?.();
    if (stateForRestore && sequences) {
      Object.defineProperty(stateForRestore.monk.combatAssistant, "activeSequences", {
        configurable: true, enumerable: true, writable: true, value: sequences,
      });
    }
    unsubscribe();
  }
});

test("owner replacement during bonus commit leaves replacement owner untouched", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  let removeReplacement;
  try {
    openCommand(dialog, "bonus-unarmed");
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "1",
      secondD20: "", confirmSeparateAction: false,
    });
    removeReplacement = subscribe(() => {
      openCharacterSession("aurelia", () => ({ status: "missing" }));
    });
    fireWorkspaceActionStrict(dialog, "attack-miss", { apply: true });
    removeReplacement();
    removeReplacement = null;
    assert.equal(getState().profile.id, "aurelia");
    assert.equal(getState().monk?.combatAssistant?.activeSequences?.length ?? 0, 0);
    assert.equal(getWorkspaceSessionForTests(), null);
  } finally {
    removeReplacement?.();
    unsubscribe();
  }
});

test("same-owner workspace replacement is not rendered over by the old bonus handler", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  let removeReplacement;
  try {
    openCommand(dialog, "bonus-unarmed");
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "1",
      secondD20: "", confirmSeparateAction: false,
    });
    let replacementId;
    let replacementMarkup;
    removeReplacement = subscribe(() => {
      disposeWorkspaceOwner(getSessionContext(), "replace-bonus-workspace");
      openSaraBattleCommand("dash");
      replacementId = getWorkspaceSessionForTests().workspaceSessionId;
      replacementMarkup = dialog.body.innerHTML;
    });
    fireWorkspaceActionStrict(dialog, "attack-miss", { apply: true });
    removeReplacement();
    removeReplacement = null;
    assert.equal(getWorkspaceSessionForTests().workspaceSessionId, replacementId);
    assert.equal(dialog.body.innerHTML, replacementMarkup);
    assert.equal(getWorkspaceSessionForTests().scenarioId, "dash");
  } finally {
    removeReplacement?.();
    unsubscribe();
  }
});

test("persistence retry saves the first flurry result without another payment or slot", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    openCommand(dialog, "flurry");
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "1",
      secondD20: "", confirmSeparateAction: false,
    });
    const beforeKi = getState().combat.ki.current;
    const setItem = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new Error("simulated storage failure"); };
    fireWorkspaceActionStrict(dialog, "attack-miss", { apply: true });
    window.localStorage.setItem = setItem;
    assert.equal(getWorkspaceSessionForTests().appliedUnsaved, true);
    const afterCommit = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const attackCount = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks.length;
    assert.equal(attackCount, 1);
    assert.equal(getState().combat.ki.current, beforeKi - 1);
    fireWorkspaceActionStrict(dialog, "retry-save", { apply: true });
    assert.equal(getSessionContext().stateRevision, revision);
    assert.equal(getState().monk.combatAssistant.activeSequences[0].resolvedAttacks.length, attackCount);
    assert.equal(getState().combat.ki.current, beforeKi - 1);
    assert.equal(getWorkspaceSessionForTests().appliedUnsaved, false);
    assert.deepEqual(getState().monk.combatAssistant.activeSequences[0].resolvedAttacks,
      afterCommit.monk.combatAssistant.activeSequences[0].resolvedAttacks);
  } finally {
    unsubscribe();
  }
});

test("first flurry draft revalidates if ki or bonus action becomes unavailable before commit", () => {
  for (const change of ["ki", "bonus-action"]) {
    const { dialog, unsubscribe } = installWorkspaceFixture();
    try {
      openCommand(dialog, "flurry");
      dialog.forms.attack = new FixtureForm("attack", {
        profileId: "unarmed", rollMode: "normal", firstD20: "1",
        secondD20: "", confirmSeparateAction: false,
      });
      updateState((draft) => {
        if (change === "ki") draft.combat.ki.current = 0;
        else draft.ui.turn.bonusActionUsed = true;
      });
      const updated = structuredClone(getState());
      const revision = getSessionContext().stateRevision;
      fireWorkspaceActionStrict(dialog, "attack-miss", { apply: true });
      assert.deepEqual(getState(), updated);
      assert.equal(getSessionContext().stateRevision, revision);
      assert.equal(getState().monk?.combatAssistant?.activeSequences?.length ?? 0, 0);
    } finally {
      unsubscribe();
    }
  }
});

test("legacy bonus awaiting-damage opens its exact record and uses only the legacy damage updater", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    const sequenceId = "saved-awaiting-bonus";
    const attackId = "saved-awaiting-bonus-hit";
    assert.equal(startAttackSequence(getSessionContext(), {
      kind: "flurry", sequenceId, confirmed: true,
    }, "legacy-bonus-start").status, "applied");
    assert.equal(recordAttackOutcome(
      getSessionContext(), sequenceId, attackId, {
        kind: "flurry", profileId: "unarmed", rollMode: "normal",
        firstD20: "10", secondD20: "", dmHitResult: "hit",
      }, "legacy-bonus-hit",
    ).status, "applied");
    const paidKi = getState().combat.ki.current;
    assert.equal(getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0].damageStatus,
      "awaiting-damage");
    assert.equal(openNormalAttack({ sequenceId, attackId }).ok, true);
    assert.equal(getWorkspaceSessionForTests().currentStep, "damage-input");
    dialog.forms.damage = new FixtureForm("damage", { damage1: "3" });
    fireWorkspaceInput(dialog, "damage1", "3");
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.resolvedAttacks.length, 1);
    assert.equal(sequence.resolvedAttacks[0].id, attackId);
    assert.equal(sequence.resolvedAttacks[0].damageStatus, "recorded");
    assert.equal(getState().combat.ki.current, paidKi);
  } finally {
    unsubscribe();
  }
});

test("bonus draft ending through U1 coordinator is free and does not restore the parent workspace", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    updateState((draft) => {
      startBattle(draft, { rawD20: "10" }, { id: "bonus-draft-end-battle" });
      beginOwnTurn(draft, { id: "bonus-draft-own-turn" });
    });
    assert.equal(openNormalAttack().ok, true);
    assert.equal(openSaraBattleCommand("flurry").ok, true);
    dialog.forms.command = new FixtureForm("command", { confirmed: true });
    fireWorkspaceActionStrict(dialog, "apply-command", { apply: true });
    const ki = getState().combat.ki.current;
    const result = requestEndBattle({
      owner: getSessionContext(),
      battleId: getState().battleConsole.current.id,
    }, { confirm: () => true });
    assert.equal(result.status, "applied");
    assert.equal(getState().combat.ki.current, ki);
    assert.equal(getState().monk?.combatAssistant?.activeSequences?.length ?? 0, 0);
    assert.equal(getWorkspaceSessionForTests(), null);
  } finally {
    unsubscribe();
  }
});
