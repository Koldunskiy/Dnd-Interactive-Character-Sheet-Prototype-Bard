import test from "node:test";
import assert from "node:assert/strict";
import { getSessionContext, getState } from "../../scripts/state.js";
import {
  getWorkspaceSessionForTests,
  minimizeWorkspace,
  openNormalAttack,
  resumeWorkspace,
} from "../../scripts/workspace/controller.js";
import {
  fireWorkspaceAction,
  fireWorkspaceInput,
  FixtureForm,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";

test("W-01 preserves a dirty second-attack intent across minimize and resume", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  const opened = openNormalAttack();
  dialog.forms.attack = new FixtureForm("attack", {
    rollMode: "normal", firstD20: "10", confirmSeparateAction: false,
  });
  fireWorkspaceAction(dialog, "attack-hit");
  dialog.forms.damage = new FixtureForm("damage", { damage1: "4" });
  fireWorkspaceAction(dialog, "submit-damage");
  fireWorkspaceAction(dialog, "no-technique-continue");

  const before = getWorkspaceSessionForTests();
  const revision = getSessionContext().stateRevision;
  fireWorkspaceInput(dialog, "firstD20", "13");
  const draft = getWorkspaceSessionForTests();
  minimizeWorkspace();
  assert.equal(resumeWorkspace(opened.sessionId).ok, true);

  const resumed = getWorkspaceSessionForTests();
  assert.equal(resumed.attackId, before.attackId);
  assert.equal(resumed.currentStepKey, before.currentStepKey);
  assert.equal(resumed.rawInputsByStep[resumed.currentStepKey].firstD20, "13");
  assert.equal(getState().monk.combatAssistant.activeSequences[0].resolvedAttacks.length, 1);
  assert.equal(getSessionContext().stateRevision, revision);
  unsubscribe();
});
