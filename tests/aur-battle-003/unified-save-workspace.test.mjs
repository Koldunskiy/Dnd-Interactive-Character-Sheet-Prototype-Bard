import test from "node:test";
import assert from "node:assert/strict";
import { getState, getSessionContext } from "../../scripts/state.js";
import { createSavingThrowDraft, projectSavingThrow, buildCompletedSaveRequest } from "../../scripts/rolls/saving-throw-flow.js";
import { installWorkspaceFixture } from "./workspace-fixture.mjs";
import {
  getWorkspaceSessionForTests,
  openIncomingAttack,
  openSaraBattleCommand,
} from "../../scripts/workspace/controller.js";
import { fireWorkspaceAction } from "./workspace-fixture.mjs";
import { executeBattleCommand } from "../../scripts/battle/commands.js";
import {
  commitIncomingEvent,
  readIncomingEventReceipt,
} from "../../scripts/actions/incoming-event.js";

function typeWorkspaceField(dialog, name, value) {
  const field = dialog.body.querySelector(`[data-workspace-field][name="${name}"]`);
  assert.ok(field, `missing field ${name}`);
  field.value = value;
  globalThis.document.activeElement = field;
  dialog.fire("input", { target: field });
  return field;
}

function clickRenderedAction(dialog, action, { enabled = false } = {}) {
  const selector = `[data-workspace-action="${action}"]`;
  const button = dialog.body.querySelector(selector) ?? dialog.footer.querySelector(selector);
  assert.ok(button, `rendered action ${action} must exist`);
  assert.equal(button.isConnected, true, `${action} must be connected`);
  if (enabled) assert.equal(button.disabled, false, `${action} must be enabled`);
  button.focus();
  dialog.fire("click", { target: button });
  return button;
}

test("unified save draft resolves known DC, preserves unresolved DC, and records manual evidence", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const state = getState();
  const draft = createSavingThrowDraft({ ability: "wisdom" });
  draft.firstD20 = "12";
  draft.dc = "10";
  let projection = projectSavingThrow(state, draft);
  assert.equal(projection.ok, true, projection.reason);
  assert.equal(projection.finalOutcome, "success");
  assert.equal(projection.finalOutcomeSource, "dc");
  draft.dc = "";
  projection = projectSavingThrow(state, draft);
  assert.equal(projection.needsOutcome, true);
  assert.equal(projection.finalOutcome, null);
  draft.hasDamage = false;
  draft.baseOutcomeMode = "manual";
  draft.baseManualOutcome = "failure";
  projection = projectSavingThrow(state, draft);
  assert.equal(projection.finalOutcome, "failure");
  assert.equal(projection.finalOutcomeSource, "manual");
  const request = buildCompletedSaveRequest({ eventId: "test" }, projection, draft);
  assert.equal(request.baseOutcomeSource, "manual");
  assert.equal(request.baseManualOutcome, "failure");
  unsubscribe();
});

test("spell save draft defaults to the supported advantage mode", () => {
  assert.equal(createSavingThrowDraft({ source: "spell" }).rollMode, "advantage");
});

test("request builder refuses unresolved, unchosen-consequence, and amended-unknown projections", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const state = getState();
  const draft = createSavingThrowDraft({ ability: "wisdom" });
  draft.firstD20 = "12";
  draft.dc = "10";
  let projection = projectSavingThrow(state, draft);
  assert.equal(buildCompletedSaveRequest({}, projection, draft), null);
  draft.hasDamage = false;
  projection = projectSavingThrow(state, draft);
  assert.equal(projection.canCommit, true);
  assert.equal(buildCompletedSaveRequest({}, { ...projection, canCommit: false }, draft), null);
  draft.dc = "";
  draft.baseOutcomeMode = "manual";
  draft.baseManualOutcome = "unknown";
  projection = projectSavingThrow(state, draft);
  assert.equal(projection.canCommit, true);
  assert.equal(buildCompletedSaveRequest({}, projection, draft).outcome, "unknown");
  draft.baseManualOutcome = null;
  draft.amendment = "base:spirit-of-tranquility";
  assert.equal(buildCompletedSaveRequest({}, projectSavingThrow(state, draft), draft), null);
  draft.amendment = null;
  draft.baseOutcomeMode = "manual";
  draft.baseManualOutcome = "failure";
  draft.amendment = "base:spirit-of-tranquility";
  draft.finalOutcomeMode = "manual";
  draft.finalManualOutcome = "unknown";
  projection = projectSavingThrow(state, draft);
  assert.equal(projection.ok, true);
  assert.equal(projection.canCommit, false);
  assert.equal(buildCompletedSaveRequest({}, projection, draft), null);
  draft.baseOutcomeMode = "automatic";
  assert.equal(projectSavingThrow(state, draft).ok, false);
  unsubscribe();
});

test("saving preset routes through the unified production handler and records dc evidence", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(openSaraBattleCommand("character-roll", null, {
    rollPreset: { kind: "saving-throw", id: "wisdom" },
  }).ok, true);
  let session = getWorkspaceSessionForTests();
  assert.equal(session.workspaceType, "incoming");
  assert.equal(session.incomingDraft.stage, "save-input");
  assert.equal(session.incomingDraft.saveDraft.ability, "wisdom");
  typeWorkspaceField(dialog, "firstD20", "20");
  typeWorkspaceField(dialog, "dc", "1");
  fireWorkspaceAction(dialog, "incoming-save-continue");
  fireWorkspaceAction(dialog, "incoming-set-no-damage");
  fireWorkspaceAction(dialog, "incoming-apply-save");
  session = getWorkspaceSessionForTests();
  assert.equal(session.incomingDraft.stage, "result", session.incomingDraft.error);
  const record = getState().characterRolls.records.at(-1);
  const receipt = readIncomingEventReceipt(getState(), record.id);
  assert.equal(record.finalOutcome, "success");
  assert.equal(record.finalOutcomeSource, "dc");
  assert.equal(record.manualOutcome, null);
  assert.equal(receipt.request.finalOutcomeSource, "dc");
  assert.equal(receipt.request.baseOutcomeSource, "dc");
  unsubscribe();
});

test("generic ability-check to save type switch reuses the workspace without recording", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(openSaraBattleCommand("character-roll").ok, true);
  const kind = {
    name: "kind", value: "saving-throw", type: "select-one",
    dataset: { workspaceField: "kind" },
    closest(selector) { return selector === "[data-workspace-field]" ? this : null; },
  };
  kind.parentElement = dialog.body;
  dialog.fire("input", { target: kind });
  const session = getWorkspaceSessionForTests();
  assert.equal(session.workspaceType, "incoming");
  assert.equal(session.incomingDraft.entryKind, "standalone-save");
  assert.equal(session.incomingDraft.stage, "save-input");
  assert.equal(getState().characterRolls?.records?.length ?? 0, 0);
  unsubscribe();
});

test("incoming spell save initializes the same unified draft and supported mode", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  executeBattleCommand("start-battle", { rawD20: "12" });
  assert.equal(openIncomingAttack().ok, true);
  fireWorkspaceAction(dialog, "incoming-hit");
  fireWorkspaceAction(dialog, "incoming-source-spell");
  fireWorkspaceAction(dialog, "incoming-spell-save");
  const save = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(save.stage, "save-input");
  assert.equal(save.entryKind, "incoming-spell-save");
  assert.equal(save.saveDraft.source, "spell");
  assert.equal(save.saveDraft.rollMode, "advantage");
  assert.match(dialog.body.innerHTML, /Сопротивления магии/);
  assert.doesNotMatch(dialog.body.innerHTML, /value="normal"/);
  unsubscribe();
});

test("unknown DC requires explicit outcome; amendment with unresolved outcome cannot commit", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(openSaraBattleCommand("character-roll", null, {
    rollPreset: { kind: "saving-throw", id: "wisdom" },
  }).ok, true);
  typeWorkspaceField(dialog, "firstD20", "1");
  typeWorkspaceField(dialog, "dc", "");
  let session = getWorkspaceSessionForTests();
  fireWorkspaceAction(dialog, "incoming-save-continue");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "save-input");
  assert.match(dialog.footer.innerHTML, /incoming-save-failure/);
  fireWorkspaceAction(dialog, "incoming-save-failure");
  session = getWorkspaceSessionForTests();
  assert.equal(session.incomingDraft.stage, "save-consequence");
  fireWorkspaceAction(dialog, "incoming-set-no-damage");
  fireWorkspaceAction(dialog, "incoming-apply-save");
  session = getWorkspaceSessionForTests();
  assert.equal(session.incomingDraft.stage, "result", session.incomingDraft.error);
  const saved = getState().characterRolls.records.at(-1);
  assert.equal(saved.finalOutcome, "failure");
  assert.equal(saved.finalOutcomeSource, "manual");
  unsubscribe();

  const next = installWorkspaceFixture({ embeddedHost: true });
  executeBattleCommand("start-battle", { rawD20: "12" });
  assert.equal(openSaraBattleCommand("character-roll", null, {
    rollPreset: { kind: "saving-throw", id: "wisdom" },
  }).ok, true);
  typeWorkspaceField(next.dialog, "firstD20", "1");
  fireWorkspaceAction(next.dialog, "incoming-save-failure");
  fireWorkspaceAction(next.dialog, "incoming-save-amendment");
  fireWorkspaceAction(next.dialog, "incoming-save-unknown");
  fireWorkspaceAction(next.dialog, "incoming-apply-save");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "save-consequence");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.operationIds.save != null, true);
  assert.equal(getState().characterRolls?.records?.length ?? 0, 0);
  next.unsubscribe();
});

test("boundary rejects a tampered computed outcome before any mutation", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  executeBattleCommand("start-battle", { rawD20: "12" });
  const state = getState();
  const draft = createSavingThrowDraft({ ability: "wisdom" });
  Object.assign(draft, {
    firstD20: "1", dc: "25", baseOutcomeMode: "auto", hasDamage: false,
  });
  const projection = projectSavingThrow(state, draft);
  const request = buildCompletedSaveRequest({
    battleId: state.battleConsole.current.id,
    eventId: "tampered-outcome",
    phaseAtOpen: state.battleConsole.current.phase,
    ownTurnIdAtOpen: state.battleConsole.current.ownTurnId ?? null,
    entryKind: "standalone-save",
  }, projection, draft);
  const before = structuredClone(getState());
  const result = commitIncomingEvent(getSessionContext(), {
    ...request, outcome: "success", finalOutcome: "success",
  }, "tampered-outcome-operation");
  assert.equal(result.status, "rejected");
  assert.deepEqual(getState(), before);
  unsubscribe();
});

test("strict standalone controls track DC and damage validity without replacing focused numeric inputs", () => {
    const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
    assert.equal(openSaraBattleCommand("character-roll", null, {
      rollPreset: { kind: "saving-throw", id: "wisdom" },
    }).ok, true);
    const first = typeWorkspaceField(dialog, "firstD20", "1");
    assert.equal(first.isConnected, true);
    assert.equal(globalThis.document.activeElement, first);
    typeWorkspaceField(dialog, "firstD20", "19");
    const dc = typeWorkspaceField(dialog, "dc", "5");
    assert.equal(dialog.footer.querySelector('[data-workspace-action="incoming-save-continue"]')?.disabled, false,
      JSON.stringify({
        save: getWorkspaceSessionForTests().incomingDraft.saveDraft,
        stage: getWorkspaceSessionForTests().incomingDraft.stage,
        projection: projectSavingThrow(getState(), getWorkspaceSessionForTests().incomingDraft.saveDraft),
        footer: dialog.footer.innerHTML,
      }));
    typeWorkspaceField(dialog, "dc", "");
    assert.ok(dialog.footer.querySelector('[data-workspace-action="incoming-save-failure"]'));
    assert.equal(dialog.footer.querySelector('[data-workspace-action="incoming-save-continue"]'), null);
    typeWorkspaceField(dialog, "dc", "5");
    assert.equal(dialog.body.querySelector('[data-workspace-field][name="dc"]'), dc);
    assert.equal(dc.isConnected, true);
    clickRenderedAction(dialog, "incoming-save-continue", { enabled: true });
    clickRenderedAction(dialog, "incoming-set-has-damage", { enabled: true });
    assert.equal(dialog.footer.querySelector('[data-workspace-action="incoming-apply-save"]').disabled, true);
    const hpBefore = getState().combat.hp.current;
    const storageBefore = new Map(window.localStorage.values);
    const damage = typeWorkspaceField(dialog, "saveDamage", "4");
    assert.equal(damage.isConnected, true);
    assert.equal(globalThis.document.activeElement, damage);
    assert.equal(dialog.footer.querySelector('[data-workspace-action="incoming-apply-save"]').disabled, false);
    typeWorkspaceField(dialog, "saveDamage", "");
    assert.equal(dialog.footer.querySelector('[data-workspace-action="incoming-apply-save"]').disabled, true);
    assert.equal(getState().combat.hp.current, hpBefore);
    assert.deepEqual(window.localStorage.values, storageBefore);
    typeWorkspaceField(dialog, "saveDamage", "4");
    assert.equal(dialog.body.querySelector('[data-workspace-field][name="saveDamage"]'), damage);
    assert.equal(damage.isConnected, true);
    assert.equal(globalThis.document.activeElement, damage);
    clickRenderedAction(dialog, "incoming-apply-save", { enabled: true });
    const saved = getState().characterRolls.records.at(-1);
    assert.equal(saved.consequence.status, "applied");
    unsubscribe();
});

test("strict DC override controls update on focus and auto restores DC evidence", () => {
    const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
    assert.equal(openSaraBattleCommand("character-roll", null, {
      rollPreset: { kind: "saving-throw", id: "wisdom" },
    }).ok, true);
    typeWorkspaceField(dialog, "firstD20", "1");
    typeWorkspaceField(dialog, "dc", "30");
    clickRenderedAction(dialog, "incoming-save-continue", { enabled: true });
    clickRenderedAction(dialog, "incoming-set-no-damage", { enabled: true });
    clickRenderedAction(dialog, "incoming-save-override");
    assert.ok(dialog.footer.querySelector('[data-workspace-action="incoming-save-success"]'));
    clickRenderedAction(dialog, "incoming-save-success", { enabled: true });
    clickRenderedAction(dialog, "incoming-set-no-damage", { enabled: true });
    clickRenderedAction(dialog, "incoming-apply-save", { enabled: true });
    let record = getState().characterRolls.records.at(-1);
    let receipt = readIncomingEventReceipt(getState(), record.id);
    assert.equal(record.finalOutcome, "success");
    assert.equal(record.finalOutcomeSource, "manual");
    assert.equal(receipt.request.finalOutcomeSource, "manual");
    unsubscribe();

    const auto = installWorkspaceFixture({ embeddedHost: true });
    assert.equal(openSaraBattleCommand("character-roll", null, {
      rollPreset: { kind: "saving-throw", id: "wisdom" },
    }).ok, true);
    typeWorkspaceField(auto.dialog, "firstD20", "1");
    typeWorkspaceField(auto.dialog, "dc", "30");
    clickRenderedAction(auto.dialog, "incoming-save-continue", { enabled: true });
    clickRenderedAction(auto.dialog, "incoming-set-no-damage", { enabled: true });
    clickRenderedAction(auto.dialog, "incoming-save-override");
    clickRenderedAction(auto.dialog, "incoming-save-failure", { enabled: true });
    clickRenderedAction(auto.dialog, "incoming-set-no-damage", { enabled: true });
    clickRenderedAction(auto.dialog, "incoming-save-auto");
    clickRenderedAction(auto.dialog, "incoming-set-no-damage", { enabled: true });
    clickRenderedAction(auto.dialog, "incoming-apply-save", { enabled: true });
    record = getState().characterRolls.records.at(-1);
    receipt = readIncomingEventReceipt(getState(), record.id);
    assert.equal(record.finalOutcome, "failure");
    assert.equal(record.finalOutcomeSource, "dc");
    assert.equal(receipt.request.finalOutcomeSource, "dc");
    auto.unsubscribe();
});

test("strict live save footer works for incoming spell entry too", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  executeBattleCommand("start-battle", { rawD20: "12" });
  assert.equal(openIncomingAttack().ok, true);
  clickRenderedAction(dialog, "incoming-hit", { enabled: true });
  clickRenderedAction(dialog, "incoming-source-spell", { enabled: true });
  clickRenderedAction(dialog, "incoming-spell-save", { enabled: true });
  typeWorkspaceField(dialog, "firstD20", "20");
  typeWorkspaceField(dialog, "secondD20", "1");
  typeWorkspaceField(dialog, "dc", "1");
  clickRenderedAction(dialog, "incoming-save-continue", { enabled: true });
  unsubscribe();
});
