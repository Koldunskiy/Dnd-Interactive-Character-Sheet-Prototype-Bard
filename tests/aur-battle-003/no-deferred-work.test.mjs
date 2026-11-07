import test from "node:test";
import assert from "node:assert/strict";
import { getSessionContext, getState } from "../../scripts/state.js";
import {
  getWorkspaceRecoverySessions,
  getWorkspaceSessionForTests,
  minimizeWorkspace,
  openNormalAttack,
  prepareWorkspaceTabTransition,
} from "../../scripts/workspace/controller.js";
import { getSavedPlayerRecords } from "../../scripts/battle/player-hub.js";
import { renderBattleConsole } from "../../scripts/render/render-battle-console.js";
import {
  fireWorkspaceAction,
  fireWorkspaceInput,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";

test("N01/N02 canonical records remain accessible without a pending-work queue", () => {
  const { unsubscribe } = installWorkspaceFixture();
  const markup = renderBattleConsole(getState());
  assert.doesNotMatch(markup, /battle-unfinished-work|visibleWorkCount|Обязательные последствия|Черновики/);
  assert.equal(getSavedPlayerRecords(getState()).sequences.length, 0);
  const populated = structuredClone(getState());
  populated.monk.combatAssistant.activeSequences = [{
    id: "legacy-pending-sequence",
    kind: "attack-action",
    status: "open",
    maximumAttacks: 1,
    resolvedAttacks: [{
      id: "legacy-pending-hit",
      slotNumber: 1,
      hitResult: "hit",
      damageStatus: "awaiting-damage",
    }],
  }];
  const populatedMarkup = renderBattleConsole(populated);
  assert.doesNotMatch(populatedMarkup, /battle-unfinished-work|Урон · удар/);
  assert.equal(getSavedPlayerRecords(populated).sequences.length, 1);
  unsubscribe();
});

test("N03/N05 dirty workspace stays active and synthetic defer actions are side-effect free", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  assert.equal(openNormalAttack().ok, true);
  fireWorkspaceInput(dialog, "firstD20", "13");
  const before = structuredClone(getWorkspaceSessionForTests());
  const revision = getSessionContext().stateRevision;
  const storage = window.localStorage.getItem("characterState");
  assert.equal(minimizeWorkspace(), false);
  fireWorkspaceAction(dialog, "minimize");
  fireWorkspaceAction(dialog, "roll-defer");
  const after = getWorkspaceSessionForTests();
  assert.equal(after.workspaceSessionId, before.workspaceSessionId);
  assert.equal(after.currentStep, before.currentStep);
  assert.equal(after.currentStepKey, before.currentStepKey);
  assert.deepEqual(after.rawInputsByStep, before.rawInputsByStep);
  assert.equal(getSessionContext().stateRevision, revision);
  assert.equal(window.localStorage.getItem("characterState"), storage);
  assert.deepEqual(getWorkspaceRecoverySessions(), []);
  unsubscribe();
});

test("N06/N25 Back requests close and tab transition leaves the active workspace intact", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture();
  assert.equal(openNormalAttack().ok, true);
  fireWorkspaceAction(dialog, "attack-miss");
  fireWorkspaceAction(dialog, "back");
  assert.equal(getWorkspaceSessionForTests().currentStep, "confirm-close");
  const currentId = getWorkspaceSessionForTests().workspaceSessionId;
  prepareWorkspaceTabTransition("melee", "inventory");
  assert.equal(getWorkspaceSessionForTests().workspaceSessionId, currentId);
  assert.notEqual(getWorkspaceSessionForTests().minimized, true);
  unsubscribe();
});
