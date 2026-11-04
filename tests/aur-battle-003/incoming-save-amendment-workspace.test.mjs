import test from "node:test";
import assert from "node:assert/strict";
import {
  getState,
  getSessionContext,
  subscribe,
  updateSessionState,
} from "../../scripts/state.js";
import { executeBattleCommand } from "../../scripts/battle/commands.js";
import {
  getWorkspaceSessionForTests,
  openIncomingAttack,
} from "../../scripts/workspace/controller.js";
import { readIncomingEventReceipt } from "../../scripts/actions/incoming-event.js";
import { renderWorkspaceHost } from "../../scripts/workspace/host.js";
import { fireWorkspaceAction, installWorkspaceFixture } from "./workspace-fixture.mjs";

function typeIncoming(dialog, name, value, type = "number") {
  const control = dialog.body.querySelector?.(`[data-workspace-field][name="${name}"]`);
  if (control) {
    control.value = value;
    globalThis.document.activeElement = control;
    dialog.fire("input", { target: control });
    return control;
  }
  const field = {
    name,
    value,
    type,
    checked: false,
    dataset: { workspaceField: name },
    closest(selector) { return selector === "[data-workspace-field]" ? this : null; },
  };
  field.parentElement = dialog.body;
  dialog.fire("input", { target: field });
  return field;
}

function openSaveInput(dialog) {
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  assert.equal(openIncomingAttack().ok, true);
  fireWorkspaceAction(dialog, "incoming-hit");
  fireWorkspaceAction(dialog, "incoming-source-spell");
  fireWorkspaceAction(dialog, "incoming-spell-save");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "save-input");
}

function chooseFailedSave(dialog) {
  openSaveInput(dialog);
  typeIncoming(dialog, "firstD20", "19");
  typeIncoming(dialog, "secondD20", "1");
  typeIncoming(dialog, "dc", "25");
  fireWorkspaceAction(dialog, "incoming-save-failure");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.rollDraft.baseOutcome, "failure");
}

test("production handler applies selected Spirit of Tranquility only after explicit amended outcome", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  chooseFailedSave(dialog);
  const beforePreview = structuredClone(getState());
  const storageBefore = new Map(window.localStorage.values);
  const initialKi = getState().combat.ki.current;
  fireWorkspaceAction(dialog, "incoming-save-amendment");
  let draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.rollDraft.amendment, "base:spirit-of-tranquility");
  assert.equal(draft.rollDraft.amendedOutcome, null);
  assert.equal(draft.outcome, null);
  assert.match(dialog.body.innerHTML, /Базовый итог: \d+ · провал/);
  assert.match(dialog.body.innerHTML, /станет|После поправки/);
  assert.match(dialog.body.innerHTML, /реакция не расходуется/);
  assert.match(dialog.footer.innerHTML, /Применить результат · 1 ци/);
  assert.match(dialog.footer.innerHTML, /disabled/);
  assert.deepEqual(getState(), beforePreview);
  assert.deepEqual(window.localStorage.values, storageBefore);
  assert.equal(getState().characterRolls?.records?.length ?? 0, 0);

  fireWorkspaceAction(dialog, "incoming-save-success");
  draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.rollDraft.amendedOutcome, "success");
  assert.equal(draft.outcome, "success");
  assert.doesNotMatch(dialog.footer.innerHTML, /disabled/);
  let stateUpdates = 0;
  const stopCounting = subscribe(() => { stateUpdates += 1; });
  fireWorkspaceAction(dialog, "incoming-apply-save");
  stopCounting();

  draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.stage, "result", draft.error);
  assert.match(dialog.body.innerHTML, /уплачено 1 ци/);
  assert.equal(stateUpdates, 1);
  assert.equal(getState().combat.ki.current, initialKi - 1);
  const record = getState().characterRolls.records.find((entry) =>
    entry.id === draft.operationIds.save);
  assert.ok(record);
  assert.equal(record.manualOutcome, "success");
  assert.equal(record.appliedAmendments.length, 1);
  assert.equal(record.appliedAmendments[0].paidKi, 1);
  const receipt = readIncomingEventReceipt(getState(), draft.operationIds.save);
  assert.equal(receipt.request.amendment.baseOutcome, "failure");
  assert.equal(receipt.request.outcome, "success");
  assert.equal(receipt.outcome.effects.amendment.kiAfter, initialKi - 1);
  assert.deepEqual(receipt.outcome.effects.consequence, record.consequence);
  unsubscribe();
});

test("focused amendment controls update the actual host view immediately through the production handler", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  chooseFailedSave(dialog);

  const keyBeforeSelection = dialog.dataset.workspaceViewKey;
  const amendmentButton = dialog.body.querySelector(
    '[data-workspace-action="incoming-save-amendment"]',
  );
  assert.ok(amendmentButton);
  assert.equal(dialog.body.contains(amendmentButton), true);
  const focusedFooterAction = dialog.footer.querySelector(
    '[data-workspace-action="incoming-apply-save"]',
  );
  focusedFooterAction.focus();
  renderWorkspaceHost({
    header: dialog.header.innerHTML,
    body: dialog.body.innerHTML,
    footer: `${dialog.footer.innerHTML}<span data-deferred-probe>stale</span>`,
    status: dialog.status.textContent,
    error: dialog.error.textContent,
    viewKey: dialog.dataset.workspaceViewKey,
  });
  assert.doesNotMatch(dialog.footer.innerHTML, /data-deferred-probe/);
  amendmentButton.focus();
  assert.equal(globalThis.document.activeElement, amendmentButton);
  fireWorkspaceAction(dialog, "incoming-save-amendment");

  assert.notEqual(dialog.dataset.workspaceViewKey, keyBeforeSelection);
  assert.doesNotMatch(dialog.footer.innerHTML, /data-deferred-probe/);
  assert.match(dialog.body.innerHTML, /incoming-save-success/);
  assert.match(dialog.body.innerHTML, /incoming-save-failure/);
  assert.equal(dialog.body.querySelector('[data-workspace-action="incoming-save-success"]') !== null, true);
  assert.equal(dialog.footer.querySelector('[data-workspace-action="incoming-apply-save"]').disabled, true);

  const keyBeforeOutcome = dialog.dataset.workspaceViewKey;
  fireWorkspaceAction(dialog, "incoming-save-success");
  assert.notEqual(dialog.dataset.workspaceViewKey, keyBeforeOutcome);
  assert.equal(getWorkspaceSessionForTests().incomingDraft.rollDraft.amendedOutcome, "success");
  assert.equal(dialog.footer.querySelector('[data-workspace-action="incoming-apply-save"]').disabled, false);

  const keyBeforeDecline = dialog.dataset.workspaceViewKey;
  fireWorkspaceAction(dialog, "incoming-save-amendment-decline");
  assert.notEqual(dialog.dataset.workspaceViewKey, keyBeforeDecline);
  const rollDraft = getWorkspaceSessionForTests().incomingDraft.rollDraft;
  assert.equal(rollDraft.amendment, null);
  assert.equal(rollDraft.amendedOutcome, null);
  assert.equal(rollDraft.baseOutcome, "failure");
  assert.equal(dialog.body.querySelector('[data-workspace-action="incoming-save-success"]'), null);
  assert.match(dialog.footer.innerHTML, /Применить результат(?! · 1 ци)/);
  assert.equal(dialog.footer.querySelector('[data-workspace-action="incoming-apply-save"]').disabled, false);
  unsubscribe();
});

test("production handler renders applied damage, evasion zero, explicit no-damage, and unknown distinctly", () => {
  const cases = [
    {
      name: "positive applied damage",
      setup: (dialog) => {
        openSaveInput(dialog);
        typeIncoming(dialog, "firstD20", "19");
        typeIncoming(dialog, "secondD20", "19");
        typeIncoming(dialog, "dc", "34");
        fireWorkspaceAction(dialog, "incoming-save-failure");
        fireWorkspaceAction(dialog, "incoming-save-amendment");
        fireWorkspaceAction(dialog, "incoming-save-failure");
        fireWorkspaceAction(dialog, "incoming-set-has-damage");
        typeIncoming(dialog, "saveDamage", "20");
        typeIncoming(dialog, "damageBasis", "full-effect", "select-one");
        typeIncoming(dialog, "effectProfile", "save-half", "select-one");
      },
      expected: /Применённый урон: 10\./,
      recordStatus: "applied",
    },
    {
      name: "evasion with zero applied damage",
      setup: (dialog) => {
        openSaveInput(dialog);
        typeIncoming(dialog, "firstD20", "1");
        typeIncoming(dialog, "secondD20", "1");
        typeIncoming(dialog, "dc", "10");
        fireWorkspaceAction(dialog, "incoming-save-failure");
        fireWorkspaceAction(dialog, "incoming-save-amendment");
        fireWorkspaceAction(dialog, "incoming-save-success");
        fireWorkspaceAction(dialog, "incoming-set-has-damage");
        typeIncoming(dialog, "saveDamage", "20");
        typeIncoming(dialog, "damageBasis", "full-effect", "select-one");
        typeIncoming(dialog, "effectProfile", "save-half", "select-one");
      },
      expected: /Применённый урон: 0\./,
      recordStatus: "applied",
    },
    {
      name: "explicit no-damage",
      setup: (dialog) => {
        chooseFailedSave(dialog);
        fireWorkspaceAction(dialog, "incoming-set-no-damage");
      },
      expected: /Итог: без урона \(выбрано явно\)\./,
      recordStatus: "no-damage",
    },
    {
      name: "unknown outcome",
      setup: (dialog) => {
        openSaveInput(dialog);
        typeIncoming(dialog, "firstD20", "12");
        typeIncoming(dialog, "secondD20", "8");
        fireWorkspaceAction(dialog, "incoming-save-unknown");
      },
      expected: /Исход неизвестен; последствия не рассчитывались\./,
      recordStatus: null,
    },
  ];

  for (const scenario of cases) {
    const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
    scenario.setup(dialog);
    fireWorkspaceAction(dialog, "incoming-apply-save");
    const draft = getWorkspaceSessionForTests().incomingDraft;
    assert.equal(draft.stage, "result", `${scenario.name}: ${draft.error}`);
    assert.match(dialog.body.innerHTML, scenario.expected, scenario.name);
    const record = getState().characterRolls.records.find((entry) =>
      entry.id === draft.operationIds.save);
    const receipt = readIncomingEventReceipt(getState(), draft.operationIds.save);
    assert.equal(record.consequence?.status ?? null, scenario.recordStatus, scenario.name);
    if (record.consequence) {
      assert.deepEqual(receipt.outcome.effects.consequence, record.consequence, scenario.name);
    } else {
      assert.equal(receipt.outcome.effects.consequence.status, "not-applied", scenario.name);
      assert.equal(receipt.outcome.effects.consequence.finalDamage, 0, scenario.name);
    }
    unsubscribe();
  }
});

test("preview, selecting, declining, and cancelling an amendment remain free", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  chooseFailedSave(dialog);
  const stateBefore = structuredClone(getState());
  const storageBefore = new Map(window.localStorage.values);
  const kiBefore = getState().combat.ki.current;
  fireWorkspaceAction(dialog, "incoming-save-amendment");
  fireWorkspaceAction(dialog, "incoming-save-amendment-decline");
  const draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.rollDraft.amendment, null);
  assert.equal(draft.rollDraft.amendedOutcome, null);
  assert.equal(draft.outcome, "failure");
  assert.deepEqual(getState(), stateBefore);
  assert.deepEqual(window.localStorage.values, storageBefore);
  assert.equal(getState().combat.ki.current, kiBefore);
  assert.equal(getState().characterRolls?.records?.length ?? 0, 0);
  fireWorkspaceAction(dialog, "incoming-save-amendment");
  fireWorkspaceAction(dialog, "incoming-cancel");
  assert.equal(getWorkspaceSessionForTests(), null);
  assert.deepEqual(getState(), stateBefore);
  assert.deepEqual(window.localStorage.values, storageBefore);
  unsubscribe();
});

test("unknown base outcome offers no amendment and changed roll input clears an old choice", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  openSaveInput(dialog);
  typeIncoming(dialog, "firstD20", "19");
  typeIncoming(dialog, "secondD20", "1");
  typeIncoming(dialog, "dc", "25");
  fireWorkspaceAction(dialog, "incoming-save-unknown");
  assert.doesNotMatch(dialog.body.innerHTML, /incoming-save-amendment"/);

  fireWorkspaceAction(dialog, "incoming-back");
  fireWorkspaceAction(dialog, "incoming-save-failure");
  fireWorkspaceAction(dialog, "incoming-save-amendment");
  fireWorkspaceAction(dialog, "incoming-back");
  const firstD20 = dialog.body.querySelector('[data-workspace-field][name="firstD20"]');
  typeIncoming(dialog, "firstD20", "18");
  const draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.rollDraft.amendment, null);
  assert.equal(draft.rollDraft.amendedOutcome, null);
  assert.equal(draft.rollDraft.baseOutcome, null);
  assert.equal(draft.outcome, null);
  assert.equal(dialog.body.querySelector('[data-workspace-field][name="firstD20"]'), firstD20);
  assert.equal(globalThis.document.activeElement, firstD20);
  unsubscribe();
});

test("save input keeps DOM identity during 1-to-19 typing and damage edits preserve amendment", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  openSaveInput(dialog);
  const first = typeIncoming(dialog, "firstD20", "1");
  assert.equal(dialog.body.querySelector('[data-workspace-field][name="firstD20"]'), first);
  typeIncoming(dialog, "firstD20", "19");
  assert.equal(dialog.body.querySelector('[data-workspace-field][name="firstD20"]'), first);
  assert.equal(first.isConnected, true);
  assert.equal(globalThis.document.activeElement, first);
  assert.equal(getWorkspaceSessionForTests().incomingDraft.rollDraft.firstD20, "19");

  typeIncoming(dialog, "secondD20", "1");
  typeIncoming(dialog, "dc", "25");
  fireWorkspaceAction(dialog, "incoming-save-failure");
  fireWorkspaceAction(dialog, "incoming-save-amendment");
  fireWorkspaceAction(dialog, "incoming-set-has-damage");
  typeIncoming(dialog, "saveDamage", "10");
  typeIncoming(dialog, "damageBasis", "full-effect", "select-one");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.rollDraft.amendment,
    "base:spirit-of-tranquility");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.rollDraft.amendedOutcome, null);
  unsubscribe();
});

test("lost ki after preview blocks application, preserves the roll, and permits removing the selection", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  chooseFailedSave(dialog);
  const kiBefore = getState().combat.ki.current;
  fireWorkspaceAction(dialog, "incoming-save-amendment");
  fireWorkspaceAction(dialog, "incoming-save-success");
  updateSessionState(getSessionContext(), (draft) => {
    draft.combat.ki.current = 0;
    return draft;
  });
  const stateWithoutKi = structuredClone(getState());
  const draftBeforeApply = getWorkspaceSessionForTests().incomingDraft;
  fireWorkspaceAction(dialog, "incoming-apply-save");
  const draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.stage, "save-consequence");
  assert.match(draft.error, /1 ци/);
  assert.equal(draft.rollDraft.amendment, "base:spirit-of-tranquility");
  assert.equal(draft.rollDraft.firstD20, draftBeforeApply.rollDraft.firstD20);
  assert.deepEqual(getState(), stateWithoutKi);
  fireWorkspaceAction(dialog, "incoming-save-amendment-decline");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.rollDraft.amendment, null);
  assert.equal(getWorkspaceSessionForTests().incomingDraft.outcome, "failure");
  assert.equal(getState().combat.ki.current, 0);
  assert.equal(kiBefore > 0, true);
  unsubscribe();
});

test("persistence retry after amended save does not charge ki or apply the consequence twice", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  chooseFailedSave(dialog);
  const initialKi = getState().combat.ki.current;
  fireWorkspaceAction(dialog, "incoming-save-amendment");
  fireWorkspaceAction(dialog, "incoming-save-failure");
  fireWorkspaceAction(dialog, "incoming-set-has-damage");
  typeIncoming(dialog, "saveDamage", "8");
  const originalSetItem = window.localStorage.setItem;
  window.localStorage.setItem = () => { throw new Error("amended save storage failure"); };
  try {
    fireWorkspaceAction(dialog, "incoming-apply-save");
  } finally {
    window.localStorage.setItem = originalSetItem;
  }
  let draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.stage, "save-recovery");
  assert.equal(getState().combat.ki.current, initialKi - 1);
  const rollId = draft.operationIds.save;
  fireWorkspaceAction(dialog, "incoming-retry-save");
  draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.stage, "result", draft.error);
  assert.equal(getState().combat.ki.current, initialKi - 1);
  assert.equal(getState().characterRolls.records.filter((entry) => entry.id === rollId).length, 1);
  assert.equal(readIncomingEventReceipt(getState(), rollId).outcome.effects.amendment.paidKi, 1);
  unsubscribe();
});

test("post-commit subscriber exception is resolved from the matching amended-save receipt", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  chooseFailedSave(dialog);
  const initialKi = getState().combat.ki.current;
  fireWorkspaceAction(dialog, "incoming-save-amendment");
  fireWorkspaceAction(dialog, "incoming-save-failure");
  const stopThrowing = subscribe(() => {
    throw new Error("amended save subscriber failed");
  });
  fireWorkspaceAction(dialog, "incoming-apply-save");
  stopThrowing();

  let draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.stage, "save-recovery");
  assert.match(draft.error, /subscriber failed/);
  assert.equal(getState().combat.ki.current, initialKi - 1);
  const rollId = draft.operationIds.save;
  assert.ok(readIncomingEventReceipt(getState(), rollId));
  fireWorkspaceAction(dialog, "incoming-retry-save");
  draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.stage, "result", draft.error);
  assert.equal(getState().combat.ki.current, initialKi - 1);
  assert.equal(getState().characterRolls.records.filter((entry) => entry.id === rollId).length, 1);
  unsubscribe();
});
