import test from "node:test";
import assert from "node:assert/strict";
import {
  getSessionContext,
  openCharacterSession,
  getState,
  subscribe,
  updateState,
} from "../../scripts/state.js";
import {
  beginSeekingStrike,
  readCompletedSeekingStrikeReceipt,
} from "../../scripts/actions/sara-combat.js";
import {
  disposeWorkspaceOwner,
  getWorkspaceSessionForTests,
  openNormalAttack,
  requestEndBattle,
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
import { executeBattleCommand } from "../../scripts/battle/commands.js";

function openMissCheckpoint(dialog, { rollMode = "normal" } = {}) {
  updateState((draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    return draft;
  });
  assert.equal(openNormalAttack().ok, true);
  dialog.forms.attack = new FixtureForm("attack", {
    profileId: "unarmed", rollMode, firstD20: "2",
    secondD20: rollMode === "normal" ? "" : "3", confirmSeparateAction: false,
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

    test("damage-step verification blocks rendered and synthetic apply, Back, Cancel, and outside-damage", () => {
      const { dialog, unsubscribe } = installWorkspaceFixture();
      const originalClone = globalThis.structuredClone;
      let inspectionFailed = false;
      let failInspection = false;
      let removeFailure;
      try {
        openMissCheckpoint(dialog);
        beginSeeking(dialog);
        submitSeekingInput(dialog, { roll: "19", outcome: "", ac: "10" });
        dialog.forms.seeking = null;
        dialog.forms.damage = new FixtureForm("damage", { damage1: "" });
        fireWorkspaceInput(dialog, "damage1", "3");
        const ki = getState().combat.ki.current;
        const attackId = getWorkspaceSessionForTests().attackId;
        removeFailure = subscribe(() => {
          globalThis.structuredClone = (value) => {
            if (failInspection && !inspectionFailed && value && !Array.isArray(value) &&
                Object.hasOwn(value, "paidOperationId")) {
              inspectionFailed = true;
              throw new Error("receipt inspection unavailable");
            }
            return originalClone(value);
          };
          throw new Error("commit subscriber failure");
        });
        failInspection = true;
        fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
        globalThis.structuredClone = originalClone;
        removeFailure();
        removeFailure = null;
        const uncertain = getWorkspaceSessionForTests();
        assert.equal(inspectionFailed, true);
        assert.equal(uncertain.readOnly, true);
        assert.equal(uncertain.currentStep, "damage-input");
        const submit = dialog.footer.querySelector('[data-workspace-action="submit-damage"]');
        assert.ok(submit?.isConnected);
        assert.equal(submit.disabled, true);
        assert.doesNotMatch(dialog.footer.innerHTML, /outside-damage/);
        assert.equal((dialog.header.innerHTML.match(/data-workspace-action="back"/g) ?? []).length, 0);
        assert.equal((dialog.footer.innerHTML.match(/data-workspace-action="back"/g) ?? []).length, 0);
        const stateAfterUncertain = structuredClone(getState());
        const revisionAfterUncertain = getSessionContext().stateRevision;
        const storageAfterUncertain = new Map(window.localStorage.values);
        fireWorkspaceAction(dialog, "submit-damage");
        fireWorkspaceAction(dialog, "back");
        fireWorkspaceAction(dialog, "cancel-seeking-draft");
        fireWorkspaceAction(dialog, "outside-damage");
        assert.deepEqual(getState(), stateAfterUncertain);
        assert.equal(getSessionContext().stateRevision, revisionAfterUncertain);
        assert.deepEqual(window.localStorage.values, storageAfterUncertain);
        assert.equal(getState().combat.ki.current, ki - 1);
        assert.equal(getWorkspaceSessionForTests().attackId, attackId);
      } finally {
        globalThis.structuredClone = originalClone;
        removeFailure?.();
        unsubscribe();
      }
    });

    test("subscriber exception after hit-plus-damage commit recovers one resolved receipt", () => {
      const { dialog, unsubscribe } = installWorkspaceFixture();
      let removeFailure;
      try {
        openMissCheckpoint(dialog);
        const beforeKi = getState().combat.ki.current;
        beginSeeking(dialog);
        submitSeekingInput(dialog, { roll: "19", outcome: "", ac: "10" });
        dialog.forms.seeking = null;
        dialog.forms.damage = new FixtureForm("damage", { damage1: "" });
        fireWorkspaceInput(dialog, "damage1", "4");
        removeFailure = subscribe(() => { throw new Error("post-commit Seeking hit failure"); });
        fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
        removeFailure();
        removeFailure = null;
        assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
        assert.equal(getWorkspaceSessionForTests().appliedUnsaved, true);
        assert.equal(getState().combat.ki.current, beforeKi - 1);
        const attack = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
        assert.equal(attack.hitResult, "hit");
        assert.equal(attack.damageStatus, "recorded");
        assert.deepEqual(attack.damageRolls, [4]);
        assert.equal(readSeekingHistory(attack, {
          actionId: getWorkspaceSessionForTests().sequenceId, attackId: attack.id,
        }).filter((entry) => entry.status === "resolved").length, 1);
      } finally {
        removeFailure?.();
        unsubscribe();
      }
    });

    test("owner replacement during completed Seeking commit does not inspect or mutate replacement workspace", () => {
      const { dialog, unsubscribe } = installWorkspaceFixture();
      const originalClone = globalThis.structuredClone;
      let removeReplacement;
      let replaced = false;
      let inspectionAttempted = false;
      let replacementSnapshot = null;
      try {
        openMissCheckpoint(dialog);
        beginSeeking(dialog);
        submitSeekingInput(dialog, { roll: "19", outcome: "", ac: "10" });
        dialog.forms.seeking = null;
        dialog.forms.damage = new FixtureForm("damage", { damage1: "" });
        fireWorkspaceInput(dialog, "damage1", "3");
        const oldOwner = getWorkspaceSessionForTests().owner;
        removeReplacement = subscribe(() => {
          if (replaced) return;
          replaced = true;
          disposeWorkspaceOwner(oldOwner, "session-changed");
          openCharacterSession("sara-velaris", () => ({ status: "missing" }));
          replacementSnapshot = structuredClone(getState());
          const newGeneration = getSessionContext().sessionGeneration;
          globalThis.structuredClone = (value) => {
            if (value && !Array.isArray(value) && Object.hasOwn(value, "paidOperationId")) {
              inspectionAttempted = true;
            }
            return originalClone(value);
          };
          assert.notEqual(newGeneration, oldOwner.sessionGeneration);
          throw new Error("owner replaced during Seeking commit");
        });
        fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
        removeReplacement();
        removeReplacement = null;
        globalThis.structuredClone = originalClone;
        assert.equal(replaced, true);
        assert.equal(inspectionAttempted, false);
        assert.deepEqual(getState(), replacementSnapshot);
        assert.equal(getWorkspaceSessionForTests(), null);
      } finally {
        globalThis.structuredClone = originalClone;
        removeReplacement?.();
        unsubscribe();
      }
    });

    test("critical Seeking damage apply stays disabled until both physical dice are entered", () => {
      const { dialog, unsubscribe } = installWorkspaceFixture();
      try {
        openMissCheckpoint(dialog);
        beginSeeking(dialog);
        dialog.forms.attack = null;
        dialog.forms.seeking = new FixtureForm("seeking", {
          rollMode: "advantage", firstD20: "20", secondD20: "3",
          targetArmorClass: "30", dmHitResult: "", dmExceptionConfirmed: false,
        });
        fireWorkspaceInput(dialog, "rollMode", "advantage", "select");
        fireWorkspaceInput(dialog, "firstD20", "20");
        fireWorkspaceInput(dialog, "secondD20", "3");
        fireWorkspaceInput(dialog, "targetArmorClass", "30");
        fireWorkspaceActionStrict(dialog, "submit-seeking", { apply: true });
        assert.equal(getWorkspaceSessionForTests().currentStep, "damage-input");
        dialog.forms.seeking = null;
        dialog.forms.damage = new FixtureForm("damage", { damage1: "", damage2: "" });
        fireWorkspaceInput(dialog, "damage1", "2");
        let submit = dialog.footer.querySelector('[data-workspace-action="submit-damage"]');
        assert.ok(submit?.isConnected);
        assert.equal(submit.disabled, true);
        fireWorkspaceInput(dialog, "damage2", "5");
        submit = dialog.footer.querySelector('[data-workspace-action="submit-damage"]');
        assert.ok(submit?.isConnected);
        assert.equal(submit.disabled, false);
        fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
        const attack = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
        assert.equal(attack.critical, true);
        assert.deepEqual(attack.damageRolls, [2, 5]);
      } finally {
        unsubscribe();
      }
    });

    test("cancel directly from transient damage returns to the parent without storage or state changes", () => {
      const { dialog, unsubscribe } = installWorkspaceFixture();
      try {
        openMissCheckpoint(dialog);
        const parentId = getWorkspaceSessionForTests().attackId;
        const before = structuredClone(getState());
        const revision = getSessionContext().stateRevision;
        const storage = new Map(window.localStorage.values);
        beginSeeking(dialog);
        submitSeekingInput(dialog, { roll: "19", outcome: "", ac: "10" });
        const beforeCancel = structuredClone(getState());
        const beforeCancelRevision = getSessionContext().stateRevision;
        const beforeCancelStorage = new Map(window.localStorage.values);
        fireWorkspaceActionStrict(dialog, "cancel-seeking-draft");
        assert.deepEqual(getState(), beforeCancel);
        assert.equal(getSessionContext().stateRevision, beforeCancelRevision);
        assert.deepEqual(window.localStorage.values, beforeCancelStorage);
        assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
        assert.equal(getWorkspaceSessionForTests().attackId, parentId);
        assert.equal(getState().monk.combatAssistant.activeSequences[0]
          .resolvedAttacks[0].hitResult, "miss");
        assert.deepEqual(before, structuredClone(getState()));
        assert.equal(revision, getSessionContext().stateRevision);
        assert.deepEqual(storage, new Map(window.localStorage.values));
      } finally {
        unsubscribe();
      }
    });

    test("a second workspace Seeking intent starts with a new ID and basis after a completed miss", () => {
      const { dialog, unsubscribe } = installWorkspaceFixture();
      try {
        openMissCheckpoint(dialog);
        const beforeKi = getState().combat.ki.current;
        beginSeeking(dialog);
        const firstIntent = getWorkspaceSessionForTests().seekingIntent;
        submitSeekingInput(dialog, { roll: "10", outcome: "miss" });
        assert.equal(getState().combat.ki.current, beforeKi - 1);
        const firstAttack = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
        const firstHistory = readSeekingHistory(firstAttack, {
          actionId: getWorkspaceSessionForTests().sequenceId, attackId: firstAttack.id,
        });
        fireWorkspaceActionStrict(dialog, "begin-seeking");
        const secondIntent = getWorkspaceSessionForTests().seekingIntent;
        assert.notEqual(secondIntent.invocationId, firstIntent.invocationId);
        assert.notEqual(secondIntent.expectedParentBasis, firstIntent.expectedParentBasis);
        assert.equal(getState().combat.ki.current, beforeKi - 1);
        submitSeekingInput(dialog, { roll: "11", outcome: "miss" });
        assert.equal(getState().combat.ki.current, beforeKi - 2);
        const finalAttack = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
        assert.deepEqual(readSeekingHistory(finalAttack, {
          actionId: getWorkspaceSessionForTests().sequenceId, attackId: finalAttack.id,
        }).map((entry) => entry.status), ["resolved", "resolved"]);
        assert.equal(firstHistory.length, 1);
      } finally {
        unsubscribe();
      }
    });

    test("saved legacy awaiting-replacement resolves and legacy awaiting-damage records without another payment", () => {
      const { dialog, unsubscribe } = installWorkspaceFixture();
      try {
        openMissCheckpoint(dialog);
        const session = getWorkspaceSessionForTests();
        const { sequenceId, attackId } = session;
        const kiBefore = getState().combat.ki.current;
        assert.equal(beginSeekingStrike(getSessionContext(), sequenceId, attackId,
          "legacy-paid-seeking").status, "applied");
        const paidKi = getState().combat.ki.current;
        assert.equal(paidKi, kiBefore - 1);
        updateState((draft) => { draft.ui.turn.turnNumber += 1; return draft; });
        disposeWorkspaceOwner(getWorkspaceSessionForTests().owner, "session-changed");
        assert.equal(openNormalAttack({ sequenceId, attackId }).ok, true);
        assert.equal(getWorkspaceSessionForTests().currentStep, "seeking-input");
        dialog.forms.seeking = new FixtureForm("seeking", {
          rollMode: "normal", firstD20: "19", secondD20: "",
          targetArmorClass: "10", dmHitResult: "",
        });
        fireWorkspaceInput(dialog, "firstD20", "19");
        fireWorkspaceActionStrict(dialog, "submit-seeking", { apply: true });
        assert.equal(getWorkspaceSessionForTests().currentStep, "damage-input");
        assert.equal(getState().combat.ki.current, paidKi);
        let attack = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
        const legacyEntry = readSeekingHistory(attack, { actionId: sequenceId, attackId })[0];
        assert.equal(legacyEntry.status, "resolved");
        assert.equal(attack.historicalResolution, true);
        assert.equal(readCompletedSeekingStrikeReceipt(
          getState(), legacyEntry.resolutionOperationId,
        ), null);
        const resolved = getState().monk.combatAssistant.activeSequences[0];
        assert.equal(openNormalAttack({ sequenceId, attackId }).ok, true);
        assert.equal(getWorkspaceSessionForTests().currentStep, "damage-input");
        dialog.forms.seeking = null;
        dialog.forms.damage = new FixtureForm("damage", { damage1: "" });
        fireWorkspaceInput(dialog, "damage1", "4");
        fireWorkspaceActionStrict(dialog, "submit-damage", { apply: true });
        assert.equal(getState().combat.ki.current, paidKi);
        attack = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
        assert.equal(attack.damageStatus, "recorded");
        assert.deepEqual(attack.damageRolls, [4]);
        assert.equal(readSeekingHistory(attack, { actionId: sequenceId, attackId }).length, 1);
        assert.equal(resolved.resolvedAttacks[0].damageStatus, "awaiting-damage");
      } finally {
        unsubscribe();
      }
    });

    test("end battle during transient Seeking input and damage never restores or applies the stale draft", () => {
      for (const stage of ["seeking-input", "damage-input"]) {
        const { dialog, unsubscribe } = installWorkspaceFixture();
        try {
          executeBattleCommand("start-battle", { rawD20: "10" });
          executeBattleCommand("begin-own-turn");
          openMissCheckpoint(dialog);
          const parentId = getWorkspaceSessionForTests().attackId;
          const ki = getState().combat.ki.current;
          beginSeeking(dialog);
          if (stage === "damage-input") {
            submitSeekingInput(dialog, { roll: "19", outcome: "", ac: "10" });
          }
          const owner = getSessionContext();
          const battleId = getState().battleConsole.current.id;
          const staleWorkspaceId = getWorkspaceSessionForTests()?.workspaceSessionId;
          assert.equal(requestEndBattle({ owner, battleId }, { confirm: () => true }).status, "applied");
          const endedState = structuredClone(getState());
          const endedRevision = getSessionContext().stateRevision;
          fireWorkspaceAction(dialog, stage === "damage-input" ? "submit-damage" : "submit-seeking");
          assert.deepEqual(getState(), endedState);
          assert.equal(getSessionContext().stateRevision, endedRevision);
          assert.equal(getState().combat.ki.current, ki);
          const currentWorkspace = getWorkspaceSessionForTests();
          assert.ok(!currentWorkspace ||
            (currentWorkspace.workspaceSessionId !== staleWorkspaceId &&
              currentWorkspace.attackId !== parentId));
        } finally {
          unsubscribe();
        }
      }
    });

    test("Ki and battle/turn changes during transient damage prevent completed Seeking application", () => {
      const staleChanges = [
        (draft) => { draft.combat.ki.current = 0; },
        (draft) => { draft.ui.turn.turnNumber += 1; },
        (draft) => {
          draft.battleConsole.current = {
            id: "changed-battle", phase: "own-turn", ownTurnId: "changed-turn",
          };
        },
      ];
      for (const mutate of staleChanges) {
        const { dialog, unsubscribe } = installWorkspaceFixture();
        try {
          openMissCheckpoint(dialog);
          beginSeeking(dialog);
          submitSeekingInput(dialog, { roll: "19", outcome: "", ac: "10" });
          dialog.forms.seeking = null;
          dialog.forms.damage = new FixtureForm("damage", { damage1: "" });
          fireWorkspaceInput(dialog, "damage1", "3");
          updateState((draft) => { mutate(draft); return draft; });
          const changed = structuredClone(getState());
          const changedRevision = getSessionContext().stateRevision;
          const map = new Map(window.localStorage.values);
          fireWorkspaceAction(dialog, "submit-damage");
          assert.deepEqual(getState(), changed);
          assert.equal(getSessionContext().stateRevision, changedRevision);
          assert.deepEqual(window.localStorage.values, map);
          assert.equal(getState().monk.combatAssistant.activeSequences[0]
            .resolvedAttacks[0].hitResult, "miss");
          assert.equal(readSeekingHistory(
            getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0],
            { actionId: getWorkspaceSessionForTests().sequenceId,
              attackId: getWorkspaceSessionForTests().attackId },
          ).length, 0);
        } finally {
          unsubscribe();
        }
      }
    });

    test("Seeking default mode stays aligned for advantage and disadvantage parents", () => {
      for (const rollMode of ["advantage", "disadvantage"]) {
        const { dialog, unsubscribe } = installWorkspaceFixture();
        try {
          openMissCheckpoint(dialog, { rollMode });
          beginSeeking(dialog);
          assert.match(dialog.body.innerHTML, new RegExp(`value="${rollMode}"[^>]*selected`));
          const formValues = {
            firstD20: rollMode === "advantage" ? "12" : "19",
            secondD20: rollMode === "advantage" ? "18" : "4",
            targetArmorClass: "30",
            dmHitResult: "miss",
          };
          dialog.forms.attack = null;
          dialog.forms.seeking = new FixtureForm("seeking", formValues);
          fireWorkspaceInput(dialog, "firstD20", formValues.firstD20);
          fireWorkspaceInput(dialog, "secondD20", formValues.secondD20);
          fireWorkspaceInput(dialog, "targetArmorClass", "30");
          fireWorkspaceInput(dialog, "dmHitResult", "miss", "select");
          fireWorkspaceActionStrict(dialog, "submit-seeking", { apply: true });
          const attack = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
          const history = readSeekingHistory(attack, {
            actionId: getWorkspaceSessionForTests().sequenceId,
            attackId: attack.id,
          });
          assert.equal(history[0].resolutionRequest.replacement.rollMode, rollMode);
          assert.equal(attack.rollMode, rollMode);
        } finally {
          unsubscribe();
        }
      }
    });
