import test from "node:test";
import assert from "node:assert/strict";
import {
  getSessionContext,
  getState,
  updateSessionState,
} from "../../scripts/state.js";
import { startBattle, beginOwnTurn, endOwnTurn } from "../../scripts/battle/transitions.js";
import {
  disposeWorkspaceOwner,
  getWorkspaceSessionForTests,
  getMinimizedWorkspaceSessions,
  openNormalAttack,
  openSaraBattleCommand,
  resumeWorkspace,
} from "../../scripts/workspace/controller.js";
import {
  fireWorkspaceAction,
  fireWorkspaceInput,
  FixtureForm,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";

function finishFixture(fixture) {
  disposeWorkspaceOwner(getSessionContext(), "test-cleanup");
  fixture.unsubscribe();
}

test("two misses exit summary; next-turn generic Attack is fresh and old summary remains explicit", () => {
  const fixture = installWorkspaceFixture();
  try {
    updateSessionState(getSessionContext(), (draft) => {
      const started = startBattle(draft, { rawD20: "10" }, { id: "summary-route-battle" });
      if (!started.ok) throw new Error(started.reason);
      const turn = beginOwnTurn(draft, { id: "summary-route-turn-1" });
      if (!turn.ok) throw new Error(turn.reason);
      return draft;
    });
    const first = openNormalAttack();
    assert.equal(first.ok, true);
    for (let index = 0; index < 2; index += 1) {
      fixture.dialog.forms.attack = new FixtureForm("attack", {
        rollMode: "normal",
        firstD20: "10",
        confirmSeparateAction: false,
      });
      fireWorkspaceAction(fixture.dialog, "attack-miss");
      if (index === 0) fireWorkspaceAction(fixture.dialog, "no-technique-continue");
      else fireWorkspaceAction(fixture.dialog, "no-technique-continue");
    }
    assert.equal(getWorkspaceSessionForTests().currentStep, "summary");
    assert.match(fixture.dialog.footer.innerHTML, /data-workspace-action="finish-workspace"/);
    fireWorkspaceAction(fixture.dialog, "minimize");
    assert.equal(fixture.dialog.open, false);

    const oldSummaryId = getMinimizedWorkspaceSessions()
      .find((entry) => entry.workspaceSessionId === first.sessionId)?.workspaceSessionId;
    assert.ok(oldSummaryId);
    updateSessionState(getSessionContext(), (draft) => {
      const ended = endOwnTurn(draft);
      if (!ended.ok) throw new Error(ended.reason);
      const next = beginOwnTurn(draft, { id: "summary-route-turn-2" });
      if (!next.ok) throw new Error(next.reason);
      return draft;
    });
    const revision = getSessionContext().stateRevision;

    const next = openNormalAttack();
    assert.equal(next.ok, true);
    const fresh = getWorkspaceSessionForTests();
    assert.notEqual(fresh.workspaceSessionId, first.sessionId);
    assert.equal(fresh.currentStep, "attack-input");
    assert.deepEqual(fresh.rawInputsByStep[fresh.currentStepKey], {});
    assert.equal(getSessionContext().stateRevision, revision);
    assert.equal(getState().ui.turn.actionUsed, false);
    assert.equal(resumeWorkspace(oldSummaryId).ok, true);
    assert.equal(getWorkspaceSessionForTests().currentStep, "summary");
    assert.equal(getWorkspaceSessionForTests().readOnly, true);
  } finally {
    finishFixture(fixture);
  }
});

test("command close confirmation preserves the exact draft on Stay and discards only transient input", () => {
  const fixture = installWorkspaceFixture();
  try {
    const cases = [
      ["character-roll", "id", "persuasion"],
      ["resource-correction", "resourceId", "ki"],
    ];
    for (const [commandId, fieldName, fieldValue] of cases) {
      assert.equal(openSaraBattleCommand(commandId).ok, true);
      fixture.dialog.forms.command = new FixtureForm("command", {
        kind: "ability-check",
        id: "strength",
        firstD20: "",
        resourceId: "hp-current",
        value: "",
      });
      fireWorkspaceInput(fixture.dialog, fieldName, fieldValue, "text");
      const current = getWorkspaceSessionForTests();
      const key = current.currentStepKey;
      const revision = getSessionContext().stateRevision;
      fireWorkspaceAction(fixture.dialog, "close");
      assert.match(fixture.dialog.body.innerHTML, /ещё не записан/);
      fireWorkspaceAction(fixture.dialog, "stay");
      assert.equal(getWorkspaceSessionForTests().currentStepKey, key);
      assert.equal(getWorkspaceSessionForTests().rawInputsByStep[key][fieldName], fieldValue);
      assert.equal(getSessionContext().stateRevision, revision);

      fireWorkspaceAction(fixture.dialog, "close");
      fireWorkspaceAction(fixture.dialog, "confirm-close");
      assert.equal(getWorkspaceSessionForTests(), null);
      assert.equal(fixture.dialog.open, false);
      assert.equal(getSessionContext().stateRevision, revision);
    }
  } finally {
    finishFixture(fixture);
  }
});

test("a changed or invalid roll preset rejects without replacing the open draft", () => {
  const fixture = installWorkspaceFixture();
  try {
    assert.equal(openSaraBattleCommand("character-roll", null, {
      rollPreset: { kind: "ability-check", id: "persuasion" },
    }).ok, true);
    fixture.dialog.forms.command = new FixtureForm("command", {
      kind: "ability-check",
      id: "persuasion",
      firstD20: "9",
      secondD20: "",
    });
    fireWorkspaceInput(fixture.dialog, "firstD20", "9", "number");
    const originalKey = getWorkspaceSessionForTests().currentStepKey;

    const changed = openSaraBattleCommand("character-roll", null, {
      rollPreset: { kind: "ability-check", id: "athletics" },
    });
    assert.equal(changed.ok, false);
    assert.match(changed.reason, /другой черновик проверки/);
    assert.equal(getWorkspaceSessionForTests().rawInputsByStep[originalKey].id, "persuasion");
    assert.equal(getWorkspaceSessionForTests().rawInputsByStep[originalKey].firstD20, "9");
    assert.equal(openSaraBattleCommand("character-roll", null, {
      rollPreset: { kind: "ability-check", id: "persuasion" },
    }).ok, true);

    const invalid = openSaraBattleCommand("character-roll", null, {
      rollPreset: { kind: "saving-throw", id: "nonexistent" },
    });
    assert.equal(invalid.ok, false);
    assert.equal(getWorkspaceSessionForTests().rawInputsByStep[originalKey].id, "persuasion");
  } finally {
    finishFixture(fixture);
  }
});

test("spell source preserves Dexterity, Wisdom, Constitution dice, and recorded modifiers", () => {
  const fixture = installWorkspaceFixture();
  try {
    assert.equal(openSaraBattleCommand("character-roll").ok, true);
    fixture.dialog.forms.command = new FixtureForm("command", {
      kind: "saving-throw",
      id: "dexterity",
      rollMode: "normal",
      firstD20: "",
      secondD20: "",
      spellSaveSource: false,
    });
    for (const ability of ["dexterity", "wisdom", "constitution"]) {
      fireWorkspaceInput(fixture.dialog, "id", ability, "text");
      fireWorkspaceInput(fixture.dialog, "rollMode", "advantage", "text");
      fireWorkspaceInput(fixture.dialog, "firstD20", "14", "number");
      fireWorkspaceInput(fixture.dialog, "secondD20", "15", "number");
      fireWorkspaceInput(fixture.dialog, "spellSaveSource", true, "checkbox");
      let draft = getWorkspaceSessionForTests().rawInputsByStep[
        getWorkspaceSessionForTests().currentStepKey
      ];
      assert.equal(draft.id, ability);
      assert.equal(draft.firstD20, "14");
      assert.equal(draft.secondD20, "15");
      assert.equal(draft.rollMode, "advantage");
      fireWorkspaceInput(fixture.dialog, "spellSaveSource", false, "checkbox");
      draft = getWorkspaceSessionForTests().rawInputsByStep[
        getWorkspaceSessionForTests().currentStepKey
      ];
      assert.equal(draft.id, ability);
      assert.equal(draft.firstD20, "14");
      assert.equal(draft.secondD20, "15");
    }

    fireWorkspaceInput(fixture.dialog, "spellSaveSource", true, "checkbox");
    fireWorkspaceAction(fixture.dialog, "record-roll", { rollOutcome: "success" });
    const saved = getState().characterRolls.records.at(-1);
    assert.equal(saved.ability, "constitution");
    assert.equal(saved.spellSaveSource, true);
    assert.deepEqual(saved.rawD20Rolls, [14, 15]);
    assert.equal(saved.totalModifier,
      getState().characterRolls.records.at(-1).modifierSnapshot
        .reduce((sum, source) => sum + source.value, 0));
  } finally {
    finishFixture(fixture);
  }
});

test("child return after EndOwnTurn restores the parent's raw input as read-only", () => {
  const fixture = installWorkspaceFixture();
  try {
    updateSessionState(getSessionContext(), (draft) => {
      const started = startBattle(draft, { rawD20: "10" }, { id: "correction-wave-battle" });
      if (!started.ok) throw new Error(started.reason);
      const turn = beginOwnTurn(draft, { id: "correction-wave-turn" });
      if (!turn.ok) throw new Error(turn.reason);
      return draft;
    });
    assert.equal(openNormalAttack().ok, true);
    fireWorkspaceInput(fixture.dialog, "firstD20", "17", "number");
    const parentId = getWorkspaceSessionForTests().workspaceSessionId;
    assert.equal(openSaraBattleCommand("character-roll").ok, true);

    updateSessionState(getSessionContext(), (draft) => {
      const ended = endOwnTurn(draft);
      if (!ended.ok) throw new Error(ended.reason);
      return draft;
    });
    fireWorkspaceAction(fixture.dialog, "done");
    const restored = getWorkspaceSessionForTests();
    assert.equal(restored.workspaceSessionId, parentId);
    assert.equal(restored.rawInputsByStep[restored.currentStepKey].firstD20, "17");
    assert.equal(restored.readOnly, true);
    assert.equal(restored.capabilities.canRecordAttack, false);
    assert.equal(restored.capabilities.canContinueSequence, false);
    assert.equal(getState().battleConsole.current.phase, "waiting");
  } finally {
    finishFixture(fixture);
  }
});
