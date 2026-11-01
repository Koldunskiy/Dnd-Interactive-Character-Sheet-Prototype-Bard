import test from "node:test";
import assert from "node:assert/strict";
import { getSessionContext, getState } from "../../scripts/state.js";
import {
  disposeWorkspaceOwner,
  getWorkspaceSessionForTests,
  openSaraBattleCommand,
} from "../../scripts/workspace/controller.js";
import {
  FixtureForm,
  fireWorkspaceAction,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";

test("shared workspace applies battle commands, explicit roll outcomes, and save consequences", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();

  const flurry = openSaraBattleCommand("flurry");
  assert.equal(flurry.ok, true);
  const kiBeforeFlurry = getState().combat.ki.current;
  dialog.forms.command = new FixtureForm("command", { confirmed: true });
  fireWorkspaceAction(dialog, "apply-command");

  const sequenceId = getWorkspaceSessionForTests().sequenceId;
  const sequence = getState().monk.combatAssistant.activeSequences.find((entry) =>
    entry.id === sequenceId);
  assert.equal(getWorkspaceSessionForTests().workspaceType, "attack");
  assert.equal(getWorkspaceSessionForTests().sequenceKind, "flurry");
  assert.equal(getWorkspaceSessionForTests().currentStep, "attack-input");
  assert.equal(sequence.maximumAttacks, Number(getState().profile.level) >= 17 ? 3 : 2);
  assert.equal(getState().combat.ki.current, kiBeforeFlurry - 1);
  assert.equal(getState().ui.turn.bonusActionUsed, true);
  assert.equal(getState().ui.turn.actionUsed, false);
  disposeWorkspaceOwner(getSessionContext(), "test-complete");

  const dash = openSaraBattleCommand("dash");
  assert.equal(dash.ok, true);
  const kiBeforeDash = getState().combat.ki.current;
  dialog.forms.command = new FixtureForm("command", { confirmed: true });
  fireWorkspaceAction(dialog, "apply-command");

  assert.equal(getState().ui.turn.actionUsed, true);
  assert.equal(getState().ui.turn.bonusActionUsed, true);
  assert.equal(getState().combat.ki.current, kiBeforeDash);
  assert.match(getState().monk.combatAssistant.recentlyCompletedSummaries.at(-1).reminder, /расстояние определяется за столом/);
  disposeWorkspaceOwner(getSessionContext(), "test-complete");

  const correction = openSaraBattleCommand("resource-correction");
  assert.equal(correction.ok, true);
  dialog.forms.command = new FixtureForm("command", { resourceId: "ki", value: "7" });
  fireWorkspaceAction(dialog, "apply-command");
  assert.equal(getState().combat.ki.current, 7);
  assert.match(getWorkspaceSessionForTests().resultMessage, /Ци:/);
  disposeWorkspaceOwner(getSessionContext(), "test-complete");

  const roll = openSaraBattleCommand("character-roll");
  assert.equal(roll.ok, true);
  dialog.forms.command = new FixtureForm("command", {
    kind: "ability-check",
    id: "athletics",
    rollMode: "normal",
    firstD20: "12",
    secondD20: "",
    dc: "16",
    incomingDamage: "",
    consequenceProfile: "none",
    spellSaveSource: false,
    advantageReason: "",
    disadvantageReason: "",
  });
  fireWorkspaceAction(dialog, "record-roll", { rollOutcome: "success" });
  const record = getState().characterRolls.records.at(-1);
  assert.equal(record.skillId, "athletics");
  assert.equal(record.chosenD20, 12);
  assert.equal(record.dc, null);
  assert.equal(record.manualOutcome, "success");
  assert.equal(getWorkspaceSessionForTests().currentStep, "roll-result");
  assert.equal(getState().ui.turn.actionUsed, true);

  disposeWorkspaceOwner(getSessionContext(), "test-complete");
  assert.equal(openSaraBattleCommand("character-roll").ok, true);
  dialog.forms.command = new FixtureForm("command", {
    kind: "saving-throw",
    id: "dexterity",
    rollMode: "normal",
    firstD20: "5",
    secondD20: "",
    dc: "18",
    incomingDamage: "99",
    consequenceProfile: "save-half",
    spellSaveSource: false,
    advantageReason: "",
    disadvantageReason: "",
  });
  fireWorkspaceAction(dialog, "record-roll", { rollOutcome: "failure" });
  assert.ok(getState().characterRolls, getWorkspaceSessionForTests()?.error);
  const saveRecord = getState().characterRolls.records.at(-1);
  assert.equal(saveRecord.dc, null);
  assert.equal(saveRecord.incomingDamage, null);
  assert.equal(saveRecord.consequence.status, "awaiting-damage-decision");

  fireWorkspaceAction(dialog, "roll-has-damage");
  dialog.forms.rollConsequence = new FixtureForm("roll-consequence", {
    damage: "9",
    damageBasis: "full-effect",
    effectProfile: "save-half",
  });
  const hpBefore = getState().combat.hp.current;
  fireWorkspaceAction(dialog, "roll-apply-consequence");
  const resolved = getState().characterRolls.records.at(-1);
  assert.equal(resolved.consequence.finalDamage, 4);
  assert.equal(resolved.consequence.evasionUsed, true);
  assert.equal(getState().combat.hp.current, hpBefore - 4);
  assert.equal(getWorkspaceSessionForTests().currentStep, "roll-result");

  disposeWorkspaceOwner(getSessionContext(), "test-complete");
  unsubscribe();
});
