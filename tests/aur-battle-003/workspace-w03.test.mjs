import test from "node:test";
import assert from "node:assert/strict";
import { getSessionContext, getState } from "../../scripts/state.js";
import { recordAttackOutcome } from "../../scripts/actions/sara-combat.js";
import {
  getWorkspaceSessionForTests,
  openNormalAttack,
} from "../../scripts/workspace/controller.js";
import { fireWorkspaceAction, FixtureForm, installWorkspaceFixture } from "./workspace-fixture.mjs";

test("W-03 historical damage ends without a dead next-attack action; current continuation is explicit", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  const sequenceId = "w03-sequence";
  const attackId = "w03-hit";
  const recorded = recordAttackOutcome(getSessionContext(), sequenceId, attackId, {
    kind: "attack-action",
    profileId: "unarmed",
    rollMode: "normal",
    firstD20: "15",
    dmHitResult: "hit",
  }, "w03-record-hit");
  assert.equal(recorded.status, "applied");

  const historical = openNormalAttack({
    sequenceId, attackId, mode: "historical-damage",
  });
  assert.equal(historical.ok, true);
  dialog.forms.damage = new FixtureForm("damage", { damage1: "6" });
  fireWorkspaceAction(dialog, "submit-damage");
  assert.equal(getWorkspaceSessionForTests().currentStep, "checkpoint");
  assert.equal(getWorkspaceSessionForTests().historicalOnly, true);
  assert.doesNotMatch(dialog.footer.innerHTML, /data-workspace-action="next-attack"/);
  assert.doesNotMatch(dialog.footer.innerHTML, /data-workspace-action="no-technique-continue"/);
  assert.match(dialog.footer.innerHTML, /data-workspace-action="summary"/);
  assert.equal(getState().monk.combatAssistant.activeSequences[0].resolvedAttacks.length, 1);

  const current = openNormalAttack({ sequenceId, mode: "current" });
  assert.equal(current.ok, true);
  assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
  assert.equal(getWorkspaceSessionForTests().capabilities.canRecordAttack, true);
  unsubscribe();
});
