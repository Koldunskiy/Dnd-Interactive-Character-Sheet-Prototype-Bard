import test from "node:test";
import assert from "node:assert/strict";
import {
  getWorkspaceSessionForTests,
  getWorkspaceSessions,
  openIncomingAttack,
  openNormalAttack,
} from "../../scripts/workspace/controller.js";
import { getState, getSessionContext } from "../../scripts/state.js";
import { executeBattleCommand } from "../../scripts/battle/commands.js";
import { fireWorkspaceAction, installWorkspaceFixture } from "./workspace-fixture.mjs";

function typeIncoming(dialog, name, value) {
  const field = {
    name,
    value,
    type: "number",
    dataset: { workspaceField: name },
    closest(selector) { return selector === "[data-workspace-field]" ? this : null; },
  };
  field.parentElement = dialog.body;
  dialog.fire("input", { target: field });
}

function startBattle() {
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  assert.equal(executeBattleCommand("begin-own-turn").status, "applied");
  return getState().battleConsole.current.id;
}

test("incoming cancel keeps state and Map storage unchanged and does not project a task", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const battleId = startBattle();
  const stateBefore = structuredClone(getState());
  const storageBefore = new Map(window.localStorage.values);
  assert.equal(openIncomingAttack().ok, true);
  fireWorkspaceAction(dialog, "incoming-hit");
  fireWorkspaceAction(dialog, "incoming-source-melee");
  typeIncoming(dialog, "incomingDamage", "23");
  const draftSession = getWorkspaceSessionForTests();
  assert.equal(draftSession.incomingDraft.rawDamage, "23");
  assert.deepEqual(getWorkspaceSessions(), []);
  fireWorkspaceAction(dialog, "incoming-cancel");
  assert.deepEqual(getState(), stateBefore);
  assert.deepEqual(window.localStorage.values, storageBefore);
  assert.equal(getWorkspaceSessionForTests(), null);
  assert.equal(getState().battleConsole.current.id, battleId);
  unsubscribe();
});

test("incoming direct damage uses host delegation and writes an atomic receipt", () => {
  const { dialog, taskSceneControls, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const battleId = startBattle();
  const hpBefore = getState().combat.hp.current;
  assert.equal(openIncomingAttack(null, { mode: "direct-damage" }).ok, true);
  assert.match(taskSceneControls.innerHTML, /data-sara-end-battle/);
  typeIncoming(dialog, "incomingDamage", "5");
  fireWorkspaceAction(dialog, "incoming-apply-damage");
  assert.equal(getState().combat.hp.current, hpBefore - 5);
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "result");
  assert.equal(getState().monk.combatAssistant.recentlyCompletedSummaries.filter((entry) =>
    entry.kind === "incoming-event" && entry.battleId === battleId).length, 1);
  const hpAfter = getState().combat.hp.current;
  fireWorkspaceAction(dialog, "incoming-apply-damage");
  assert.equal(getState().combat.hp.current, hpAfter);
  assert.equal(getState().monk.combatAssistant.recentlyCompletedSummaries.filter((entry) =>
    entry.kind === "incoming-event" && entry.battleId === battleId).length, 1);
  unsubscribe();
});

test("incoming cancellation restores the same unfinished attack parent and its physical input", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  assert.equal(openNormalAttack().ok, true);
  const parentId = getWorkspaceSessionForTests().workspaceSessionId;
  const field = {
    name: "firstD20",
    value: "16",
    type: "number",
    dataset: { workspaceField: "firstD20" },
    closest(selector) { return selector === "[data-workspace-field]" ? this : null; },
  };
  field.parentElement = dialog.body;
  dialog.fire("input", { target: field });
  assert.equal(openIncomingAttack().ok, true);
  assert.equal(getWorkspaceSessionForTests().workspaceType, "incoming");
  fireWorkspaceAction(dialog, "incoming-cancel");
  const restored = getWorkspaceSessionForTests();
  assert.equal(restored.workspaceSessionId, parentId);
  assert.equal(restored.workspaceType, "attack");
  assert.equal(restored.rawInputsByStep[restored.currentStepKey].firstD20, "16");
  assert.equal(restored.owner.sessionGeneration, getSessionContext().sessionGeneration);
  unsubscribe();
});
