import test from "node:test";
import assert from "node:assert/strict";
import { getState, getSessionContext, updateSessionState } from "../../scripts/state.js";
import {
  getWorkspaceSessionForTests,
  openSaraTechniqueApplication,
  getMinimizedWorkspaceSessions,
  resumeWorkspace,
} from "../../scripts/workspace/controller.js";
import {
  fireWorkspaceAction,
  fireWorkspaceInput,
  FixtureForm,
  installWorkspaceFixture,
} from "./workspace-fixture.mjs";

function chooseTechnique(techniqueId) {
  const context = getSessionContext();
  return updateSessionState(context, (draft) => {
    draft.monk.ordinaryTechniqueIds.push(techniqueId);
    return draft;
  });
}

function setCommandForm(dialog, values) {
  dialog.forms.command = new FixtureForm("command", values);
  return dialog.forms.command;
}

test("technique applications use the shared command workspace and execute once", () => {
  const { dialog, invoker, unsubscribe } = installWorkspaceFixture();
  chooseTechnique("ll-monk:gale-rush");
  const beforeKi = getState().combat.ki.current;
  const opened = openSaraTechniqueApplication("ll-monk:gale-rush", invoker);

  assert.equal(opened.ok, true);
  assert.equal(getState().combat.ki.current, beforeKi);
  assert.match(dialog.body.innerHTML, /data-workspace-form="command"/);
  assert.match(dialog.body.innerHTML, /data-workspace-field="kiCost"/);
  assert.doesNotMatch(dialog.body.innerHTML, /data-technique-form=/);

  setCommandForm(dialog, { kiCost: "" });
  fireWorkspaceAction(dialog, "apply-command");
  let task = getWorkspaceSessionForTests();
  assert.equal(task.currentStep, "command-input");
  assert.equal(task.rawInputsByStep[task.currentStepKey].kiCost, "");
  assert.equal(getState().combat.ki.current, beforeKi);

  fireWorkspaceInput(dialog, "kiCost", "2");
  const operationKey = "apply:monk-technique:ll-monk:gale-rush";
  fireWorkspaceAction(dialog, "minimize");
  const minimized = getMinimizedWorkspaceSessions().find((entry) => entry.workspaceSessionId === opened.sessionId);
  assert.equal(minimized.scenarioId, "monk-technique:ll-monk:gale-rush");
  assert.equal(resumeWorkspace(opened.sessionId).ok, true);
  task = getWorkspaceSessionForTests();
  assert.equal(task.rawInputsByStep[task.currentStepKey].kiCost, "2");
  setCommandForm(dialog, { kiCost: "2" });
  fireWorkspaceAction(dialog, "apply-command");
  task = getWorkspaceSessionForTests();
  const operationId = task.operationIdsByIntent[operationKey];
  assert.ok(operationId);
  assert.equal(task.currentStep, "command-result");
  assert.equal(getState().combat.ki.current, beforeKi - 2);
  assert.match(task.resultMessage, /перемещение 20 футов/);

  fireWorkspaceAction(dialog, "apply-command");
  assert.equal(getState().combat.ki.current, beforeKi - 2);
  assert.equal(getWorkspaceSessionForTests().operationIdsByIntent[operationKey], operationId);
  unsubscribe();
});

test("technique application preserves retry state and rejects unavailable technique routes", () => {
  const { dialog, invoker, unsubscribe } = installWorkspaceFixture();
  chooseTechnique("ll-monk:gale-rush");
  const savedSetItem = window.localStorage.setItem;
  window.localStorage.setItem = () => { throw new Error("mock write failure"); };
  const opened = openSaraTechniqueApplication("ll-monk:gale-rush", invoker);
  assert.equal(opened.ok, true);
  setCommandForm(dialog, { kiCost: "1" });
  fireWorkspaceAction(dialog, "apply-command");
  let task = getWorkspaceSessionForTests();
  const appliedKi = getState().combat.ki.current;
  const operationId = task.operationIdsByIntent["apply:monk-technique:ll-monk:gale-rush"];
  assert.equal(task.appliedUnsaved, true);
  assert.equal(task.currentStep, "command-result");
  assert.ok(task.resultMessage.includes("Порыв ветра"));

  window.localStorage.setItem = savedSetItem;
  fireWorkspaceAction(dialog, "retry-save");
  task = getWorkspaceSessionForTests();
  assert.equal(task.appliedUnsaved, false);
  assert.equal(getState().combat.ki.current, appliedKi);
  assert.equal(task.operationIdsByIntent["apply:monk-technique:ll-monk:gale-rush"], operationId);

  const unsupported = openSaraTechniqueApplication("ll-monk:step-of-the-wind", invoker);
  assert.equal(unsupported.ok, false);
  assert.match(unsupported.reason, /боевого пульта/i);
  assert.equal(getState().combat.ki.current, appliedKi);
  window.localStorage.setItem = savedSetItem;
  unsubscribe();
});

test("technique task rejects insufficient resources and standalone contextual techniques", () => {
  const { dialog, invoker, unsubscribe } = installWorkspaceFixture();
  chooseTechnique("ll-monk:gale-rush");
  const context = getSessionContext();
  updateSessionState(context, (draft) => {
    draft.combat.ki.current = 0;
    return draft;
  });
  const opened = openSaraTechniqueApplication("ll-monk:gale-rush", invoker);
  assert.equal(opened.ok, true);
  setCommandForm(dialog, { kiCost: "1" });
  fireWorkspaceAction(dialog, "apply-command");
  const task = getWorkspaceSessionForTests();
  assert.equal(task.currentStep, "command-input");
  assert.equal(task.rawInputsByStep[task.currentStepKey].kiCost, "1");
  assert.match(task.error, /недостаточно/i);
  assert.equal(getState().combat.ki.current, 0);

  assert.equal(openSaraTechniqueApplication("ll-monk:crushing-strike", invoker).ok, false);
  assert.equal(openSaraTechniqueApplication("ll-monk:indomitable-spirit", invoker).ok, false);
  assert.equal(openSaraTechniqueApplication("ll-monk:seeking-strike", invoker).ok, false);
  unsubscribe();
});
