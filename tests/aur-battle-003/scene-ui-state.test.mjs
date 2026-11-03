import test from "node:test";
import assert from "node:assert/strict";
import {
  dispatchSceneUi,
  getSceneUiState,
  resetSceneUi,
} from "../../scripts/battle/scene-ui-state.js";

test("scene UI is root-isolated and retains draft until owner or scene changes", () => {
  const firstRoot = {};
  const secondRoot = {};
  const owner = { characterId: "sara-velaris", sessionGeneration: 3, stateRevision: 10 };
  dispatchSceneUi(firstRoot, owner, "scene-1", { type: "set-panel", panel: "initiative-start" });
  dispatchSceneUi(firstRoot, owner, "scene-1", { type: "set-draft", rawD20: "17" });
  assert.equal(getSceneUiState(firstRoot, { ...owner, stateRevision: 11 }, "scene-1").initiativeDraft.rawD20, "17");
  assert.equal(getSceneUiState(secondRoot, owner, "scene-1").panel, "home");
  assert.equal(getSceneUiState(firstRoot, owner, "scene-2").panel, "home");
  assert.equal(getSceneUiState(firstRoot, { ...owner, sessionGeneration: 4 }, "scene-1").initiativeDraft.rawD20, "");
});

test("invalid UI action does not mutate state and reset clears only the selected root", () => {
  const root = {};
  const owner = { characterId: "sara-velaris", sessionGeneration: 1 };
  dispatchSceneUi(root, owner, "scene", { type: "set-draft", rawD20: "12" });
  const before = getSceneUiState(root, owner, "scene");
  const after = dispatchSceneUi(root, owner, "scene", { type: "set-panel", panel: "execute-anything" });
  assert.deepEqual(after, before);
  resetSceneUi(root);
  assert.equal(getSceneUiState(root, owner, "scene").initiativeDraft.rawD20, "");
});

test("initiative opening records mode, draft and correction battle identity", () => {
  const root = {};
  const owner = { characterId: "sara-velaris", sessionGeneration: 8 };
  const started = dispatchSceneUi(root, owner, "scene-1", {
    type: "open-initiative", mode: "start", rawD20: "", battleId: null,
  });
  assert.equal(started.panel, "initiative-start");
  const corrected = dispatchSceneUi(root, owner, "scene-1", {
    type: "open-initiative", mode: "correct", rawD20: "13", battleId: "battle-1",
  });
  assert.equal(corrected.initiativeDraft.battleId, "battle-1");
  assert.equal(dispatchSceneUi(root, owner, "scene-1", {
    type: "open-initiative", mode: "correct", rawD20: "13", battleId: null,
  }).initiativeDraft.battleId, "battle-1");
  assert.equal(getSceneUiState(root, owner, "scene-2").initiativeDraft.battleId, null);
});
