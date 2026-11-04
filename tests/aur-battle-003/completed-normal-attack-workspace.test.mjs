import test from "node:test";
import assert from "node:assert/strict";
import {
  getState,
  getSessionContext,
  openCharacterSession,
  subscribe,
  updateState,
} from "../../scripts/state.js";
import {
  getWorkspaceSessionForTests,
  openNormalAttack,
} from "../../scripts/workspace/controller.js";
import {
  fireWorkspaceActionStrict,
  fireWorkspaceInput,
  FixtureForm,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";

test("strict rendered controls cancel initial attack and hit/damage drafts without mutation", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    assert.equal(openNormalAttack().ok, true);
    const stateBefore = structuredClone(getState());
    const revisionBefore = getSessionContext().stateRevision;
    const storageBefore = new Map(window.localStorage.values);
    fireWorkspaceActionStrict(dialog, "cancel-attack-draft");
    assert.deepEqual(getState(), stateBefore);
    assert.equal(getSessionContext().stateRevision, revisionBefore);
    assert.deepEqual(window.localStorage.values, storageBefore);
    assert.equal(getWorkspaceSessionForTests(), null);

    assert.equal(openNormalAttack().ok, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "10",
      secondD20: "", confirmSeparateAction: false,
    });
    const beforeHit = structuredClone(getState());
    const beforeHitRevision = getSessionContext().stateRevision;
    const beforeHitStorage = new Map(window.localStorage.values);
    fireWorkspaceActionStrict(dialog, "attack-hit");
    assert.deepEqual(getState(), beforeHit);
    assert.equal(getSessionContext().stateRevision, beforeHitRevision);
    assert.deepEqual(window.localStorage.values, beforeHitStorage);
    assert.equal(getWorkspaceSessionForTests().currentStep, "damage-input");
    dialog.forms.damage = new FixtureForm("damage", { damage1: "3" });
    fireWorkspaceActionStrict(dialog, "cancel-attack-draft");
    assert.deepEqual(getState(), beforeHit);
    assert.equal(getSessionContext().stateRevision, beforeHitRevision);
    assert.deepEqual(window.localStorage.values, beforeHitStorage);
    assert.equal(getWorkspaceSessionForTests(), null);
  } finally {
    unsubscribe();
  }
});

test("strict rendered hit and physical damage commit as one state update", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    assert.equal(openNormalAttack().ok, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "10",
      secondD20: "", confirmSeparateAction: false,
    });
    const revision = getSessionContext().stateRevision;
    fireWorkspaceActionStrict(dialog, "attack-hit");
    assert.equal(getSessionContext().stateRevision, revision);
    dialog.forms.damage = new FixtureForm("damage", { damage1: "" });
    fireWorkspaceInput(dialog, "damage1", "3");
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    assert.equal(getSessionContext().stateRevision, revision + 1);
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.resolvedAttacks.length, 1);
    assert.equal(sequence.resolvedAttacks[0].damageStatus, "recorded");
    assert.equal(sequence.status, "open");
    assert.equal(getState().ui.turn.actionUsed, true);
  } finally {
    unsubscribe();
  }
});

test("back from draft damage clears stale intent and a subsequent miss commits the current draft", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    assert.equal(openNormalAttack().ok, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "12",
      secondD20: "", confirmSeparateAction: false,
    });
    fireWorkspaceActionStrict(dialog, "attack-hit");
    const draftId = getWorkspaceSessionForTests().attackId;
    assert.equal(getState().monk?.combatAssistant?.activeSequences?.length ?? 0, 0);
    fireWorkspaceActionStrict(dialog, "back");
    assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
    assert.equal(getWorkspaceSessionForTests().pendingAttackIntent, null);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "12",
      secondD20: "", confirmSeparateAction: false,
    });
    fireWorkspaceActionStrict(dialog, "attack-miss");
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.resolvedAttacks[0].id, draftId);
    assert.equal(sequence.resolvedAttacks[0].hitResult, "miss");
    assert.equal(sequence.resolvedAttacks[0].damageStatus, "not-applicable");
    assert.equal(getWorkspaceSessionForTests().pendingAttackIntent, null);
  } finally {
    unsubscribe();
  }
});

test("cancelling a second attack restores the first attack checkpoint and changes no state", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    assert.equal(openNormalAttack().ok, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "1",
      secondD20: "", confirmSeparateAction: false,
    });
    fireWorkspaceActionStrict(dialog, "attack-miss");
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    const firstAttackId = sequence.resolvedAttacks[0].id;
    fireWorkspaceActionStrict(dialog, "next-attack");
    const secondAttackId = getWorkspaceSessionForTests().attackId;
    assert.notEqual(secondAttackId, firstAttackId);
    const stateBeforeCancel = structuredClone(getState());
    const revisionBeforeCancel = getSessionContext().stateRevision;
    fireWorkspaceActionStrict(dialog, "cancel-attack-draft");
    assert.deepEqual(getState(), stateBeforeCancel);
    assert.equal(getSessionContext().stateRevision, revisionBeforeCancel);
    assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
    assert.equal(getWorkspaceSessionForTests().attackId, firstAttackId);
    assert.notEqual(getWorkspaceSessionForTests().attackId, secondAttackId);
  } finally {
    unsubscribe();
  }
});

test("post-commit subscriber exception is resolved through the canonical receipt without replay", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  let removeThrowingSubscriber;
  try {
    assert.equal(openNormalAttack().ok, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "10",
      secondD20: "", confirmSeparateAction: false,
    });
    fireWorkspaceActionStrict(dialog, "attack-hit");
    dialog.forms.damage = new FixtureForm("damage", { damage1: "3" });
    fireWorkspaceInput(dialog, "damage1", "3");
    removeThrowingSubscriber = subscribe(() => {
      throw new Error("simulated post-commit subscriber failure");
    });
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    removeThrowingSubscriber();
    removeThrowingSubscriber = null;
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.resolvedAttacks.length, 1);
    assert.equal(sequence.resolvedAttacks[0].damageStatus, "recorded");
    assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
    assert.equal(getWorkspaceSessionForTests().appliedUnsaved, true);
  } finally {
    removeThrowingSubscriber?.();
    unsubscribe();
  }
});

test("post-commit exception on miss finds its canonical record and clears pending intent", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  let removeThrowingSubscriber;
  try {
    assert.equal(openNormalAttack().ok, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "12",
      secondD20: "", confirmSeparateAction: false,
    });
    removeThrowingSubscriber = subscribe(() => {
      throw new Error("simulated miss subscriber failure");
    });
    fireWorkspaceActionStrict(dialog, "attack-miss");
    removeThrowingSubscriber();
    removeThrowingSubscriber = null;
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.resolvedAttacks.length, 1);
    assert.equal(sequence.resolvedAttacks[0].hitResult, "miss");
    assert.equal(getWorkspaceSessionForTests().pendingAttackIntent, null);
    assert.equal(getWorkspaceSessionForTests().appliedUnsaved, true);
  } finally {
    removeThrowingSubscriber?.();
    unsubscribe();
  }
});

test("persistence retry after completed hit does not add another slot", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  const originalSetItem = window.localStorage.setItem;
  let failOnce = true;
  try {
    updateState((draft) => {
      draft.inventory.items.find((item) => item.id === "darts").equipped = true;
      return draft;
    });
    assert.equal(openNormalAttack().ok, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "darts", rollMode: "normal", firstD20: "10",
      secondD20: "", confirmSeparateAction: false,
    });
    const dartsBefore = getState().inventory.items.find((item) => item.id === "darts").quantity;
    fireWorkspaceActionStrict(dialog, "attack-hit");
    dialog.forms.damage = new FixtureForm("damage", { damage1: "3" });
    fireWorkspaceInput(dialog, "damage1", "3");
    window.localStorage.setItem = function setItem(key, value) {
      if (failOnce) {
        failOnce = false;
        throw new Error("simulated persistence failure");
      }
      originalSetItem.call(this, key, value);
    };
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    assert.equal(getWorkspaceSessionForTests().appliedUnsaved, true);
    const revision = getSessionContext().stateRevision;
    const attackId = getWorkspaceSessionForTests().attackId;
    fireWorkspaceActionStrict(dialog, "retry-save");
    assert.equal(getSessionContext().stateRevision, revision);
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    assert.equal(sequence.resolvedAttacks.length, 1);
    assert.equal(sequence.resolvedAttacks[0].id, attackId);
    assert.equal(sequence.resolvedAttacks[0].ammunitionSpend.quantityAfter, dartsBefore - 1);
    assert.equal(getState().inventory.items.find((item) => item.id === "darts").quantity,
      dartsBefore - 1);
    assert.equal(getWorkspaceSessionForTests().appliedUnsaved, false);
  } finally {
    window.localStorage.setItem = originalSetItem;
    unsubscribe();
  }
});

test("critical hit uses separate physical damage dice through connected controls", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  try {
    assert.equal(openNormalAttack().ok, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "20",
      secondD20: "", confirmSeparateAction: false,
    });
    fireWorkspaceActionStrict(dialog, "attack-hit");
    dialog.forms.damage = new FixtureForm("damage", { damage1: "", damage2: "" });
    fireWorkspaceInput(dialog, "damage1", "3");
    fireWorkspaceInput(dialog, "damage2", "8");
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    const attack = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
    assert.equal(attack.critical, true);
    assert.deepEqual(attack.damageRolls, [3, 8]);
    assert.equal(attack.damageStatus, "recorded");
  } finally {
    unsubscribe();
  }
});

test("miss handler stops without rendering or reading receipts after the owner is replaced", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  let removeReplacement;
  try {
    assert.equal(openNormalAttack().ok, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "10",
      secondD20: "", confirmSeparateAction: false,
    });
    removeReplacement = subscribe(() => {
      openCharacterSession("aurelia", () => ({ status: "missing" }));
    });
    fireWorkspaceActionStrict(dialog, "attack-miss");
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

test("canonical inspection failure enters verification without retrying the committed attack", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  let removeSubscriber;
  let stateForRestore;
  let savedSequences;
  try {
    assert.equal(openNormalAttack().ok, true);
    dialog.forms.attack = new FixtureForm("attack", {
      profileId: "unarmed", rollMode: "normal", firstD20: "10",
      secondD20: "", confirmSeparateAction: false,
    });
    fireWorkspaceActionStrict(dialog, "attack-hit");
    dialog.forms.damage = new FixtureForm("damage", { damage1: "3" });
    fireWorkspaceInput(dialog, "damage1", "3");
    let throwOnRead = true;
    removeSubscriber = subscribe((state) => {
      stateForRestore = state;
      savedSequences = state.monk.combatAssistant.activeSequences;
      Object.defineProperty(state.monk.combatAssistant, "activeSequences", {
        configurable: true,
        enumerable: true,
        get() {
          if (throwOnRead) {
            throwOnRead = false;
            throw new Error("simulated canonical inspection failure");
          }
          return savedSequences;
        },
      });
      throw new Error("simulated post-commit subscriber failure");
    });
    fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
    removeSubscriber();
    removeSubscriber = null;
    Object.defineProperty(stateForRestore.monk.combatAssistant, "activeSequences", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: savedSequences,
    });
    assert.equal(savedSequences[0].resolvedAttacks.length, 1);
    assert.equal(getWorkspaceSessionForTests().readOnly, true);
    assert.match(getWorkspaceSessionForTests().error, /Повтор заблокирован/);
  } finally {
    removeSubscriber?.();
    if (stateForRestore && savedSequences) {
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
