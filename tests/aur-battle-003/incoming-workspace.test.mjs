import test from "node:test";
import assert from "node:assert/strict";
import {
  commitIncomingEvent,
  normalizeIncomingEventRequest,
  readIncomingEventReceipt,
} from "../../scripts/actions/incoming-event.js";
import {
  disposeWorkspaceOwner,
  getWorkspaceSessionForTests,
  getWorkspaceSessions,
  openIncomingAttack,
  openNormalAttack,
} from "../../scripts/workspace/controller.js";
import {
  getState,
  getSessionContext,
  openCharacterSession,
  retryPersistedState,
  subscribe,
  updateState,
} from "../../scripts/state.js";
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

test("production Ebb handler keeps a post-commit exception visible", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  assert.equal(openIncomingAttack().ok, true);
  fireWorkspaceAction(dialog, "incoming-miss");
  const failAfterCommit = subscribe(() => {
    throw new Error("Ebb persistence callback failure");
  });
  try {
    fireWorkspaceAction(dialog, "incoming-ebb-save");
  } finally {
    failAfterCommit();
  }
  const draft = getWorkspaceSessionForTests().incomingDraft;
  assert.match(draft.error, /Ebb persistence callback failure/);
  assert.equal(draft.stage, "save-recovery");
  const receipt = getState().monk.combatAssistant.recentlyCompletedSummaries.find((entry) =>
    entry.id === draft.pendingOperationId);
  assert.equal(receipt.kind, "incoming-event");
  assert.equal(receipt.request.kind, "ebb-and-flow");
  assert.deepEqual(receipt.outcome.effects, {
    response: "dexterity-save",
    kiSpent: 0,
    onFailedSave: "prone-and-speed-zero-until-end-of-target-turn",
    largerTargetHasAdvantage: true,
  });
  assert.equal(getState().ui.turn.reactionUsed, true);
  unsubscribe();
});

test("unknown receipt absence remains locked and cannot replay or cancel", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  assert.equal(openIncomingAttack(null, { mode: "direct-damage" }).ok, true);
  typeIncoming(dialog, "incomingDamage", "4");
  const failUnknown = subscribe((state) => {
    state.monk.combatAssistant.recentlyCompletedSummaries = [];
    throw new Error("unknown post-commit result");
  });
  const hpBefore = getState().combat.hp.current;
  try {
    fireWorkspaceAction(dialog, "incoming-apply-damage");
  } finally {
    failUnknown();
  }
  const hpAfter = getState().combat.hp.current;
  assert.equal(hpAfter, hpBefore - 4);
  let draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.stage, "verification");
  assert.ok(draft.pendingOperationId);
  assert.ok(draft.pendingNormalizedRequest);
  assert.equal(draft.pendingReturnStage, "damage");
  updateState((state) => {
    state.battleConsole.current.phase = "paused";
    return state;
  });
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "verification");
  fireWorkspaceAction(dialog, "incoming-verify");
  fireWorkspaceAction(dialog, "incoming-apply-damage");
  fireWorkspaceAction(dialog, "incoming-cancel");
  fireWorkspaceAction(dialog, "incoming-close");
  draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.stage, "verification");
  assert.equal(getState().combat.hp.current, hpAfter);
  assert.ok(getWorkspaceSessionForTests());
  unsubscribe();
});

test("successful persistence retry without a canonical receipt remains verification", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  assert.equal(openIncomingAttack(null, { mode: "direct-damage" }).ok, true);
  typeIncoming(dialog, "incomingDamage", "2");
  const originalSetItem = window.localStorage.setItem;
  window.localStorage.setItem = () => { throw new Error("initial storage failure"); };
  fireWorkspaceAction(dialog, "incoming-apply-damage");
  window.localStorage.setItem = originalSetItem;
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "save-recovery");
  getState().monk.combatAssistant.recentlyCompletedSummaries = [];
  assert.equal(retryPersistedState().ok, true);
  const draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.stage, "verification");
  assert.match(draft.error, /не подтверждено/i);
  fireWorkspaceAction(dialog, "incoming-retry-save");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "verification");
  unsubscribe();
});

test("Ebb cannot manufacture a receipt when a different action spent the reaction", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  assert.equal(openIncomingAttack().ok, true);
  fireWorkspaceAction(dialog, "incoming-miss");
  updateState((draft) => {
    draft.ui.turn.reactionUsed = true;
    return draft;
  });
  const before = structuredClone(getState());
  const storageBefore = new Map(window.localStorage.values);
  fireWorkspaceAction(dialog, "incoming-ebb-save");
  const session = getWorkspaceSessionForTests();
  assert.equal(session.incomingDraft.stage, "miss-response");
  assert.equal(session.appliedUnsaved, false);
  assert.equal(session.incomingDraft.pendingOperationId, undefined);
  assert.equal(session.incomingDraft.error, "Реакция уже использована в этом ходу.");
  assert.deepEqual(getState(), before);
  assert.deepEqual(window.localStorage.values, storageBefore);
  assert.equal(getState().monk.combatAssistant.recentlyCompletedSummaries.some((entry) =>
    entry.request?.kind === "ebb-and-flow"), false);
  unsubscribe();
});

test("Ebb pre-commit refusal restores its editable stage without state or storage changes", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  assert.equal(openIncomingAttack().ok, true);
  fireWorkspaceAction(dialog, "incoming-miss");
  updateState((draft) => {
    draft.profile.level = 5;
    return draft;
  });
  const before = structuredClone(getState());
  const storageBefore = new Map(window.localStorage.values);
  fireWorkspaceAction(dialog, "incoming-ebb-save");
  const session = getWorkspaceSessionForTests();
  assert.equal(session.incomingDraft.stage, "miss-response");
  assert.equal(session.appliedUnsaved, false);
  assert.equal(session.incomingDraft.pendingOperationId, undefined);
  assert.equal(session.incomingDraft.error, "Ebb & Flow доступна с 6 уровня.");
  assert.deepEqual(getState(), before);
  assert.deepEqual(window.localStorage.values, storageBefore);
  unsubscribe();
});

test("incoming commit subscriber replacing the workspace cannot be touched by the old handler", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  assert.equal(openIncomingAttack(null, { mode: "direct-damage" }).ok, true);
  typeIncoming(dialog, "incomingDamage", "3");
  const hpBefore = getState().combat.hp.current;
  let replacement;
  let replacementMarkup;
  let switched = false;
  const openReplacement = subscribe(() => {
    if (switched || getState().combat.hp.current === hpBefore) return;
    switched = true;
    disposeWorkspaceOwner(getWorkspaceSessionForTests().owner, "test-replacement");
    assert.equal(openNormalAttack().ok, true);
    replacement = getWorkspaceSessionForTests();
    replacementMarkup = dialog.body.innerHTML;
  });
  fireWorkspaceAction(dialog, "incoming-apply-damage");
  openReplacement();
  assert.ok(switched);
  assert.equal(getWorkspaceSessionForTests().workspaceSessionId, replacement.workspaceSessionId);
  assert.equal(getWorkspaceSessionForTests().workspaceType, "attack");
  assert.deepEqual(getWorkspaceSessionForTests(), replacement);
  assert.equal(dialog.body.innerHTML, replacementMarkup);
  unsubscribe();
});

test("incoming commit owner-generation change prevents receipt inspection in the replacement owner", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  assert.equal(openIncomingAttack(null, { mode: "direct-damage" }).ok, true);
  typeIncoming(dialog, "incomingDamage", "3");
  const hpBefore = getState().combat.hp.current;
  const sourceOwner = getSessionContext();
  let reads = 0;
  let subscriberRan = false;
  let ownerChanged = false;
  let setupError = null;
  const replaceOwner = subscribe(() => {
    if (subscriberRan || getState().combat.hp.current === hpBefore) return;
    subscriberRan = true;
    try {
      openCharacterSession("aurelia", () => ({ status: "missing" }));
      const newOwner = getSessionContext();
      assert.equal(newOwner.characterId, "aurelia");
      assert.notEqual(newOwner.sessionGeneration, sourceOwner.sessionGeneration);
      ownerChanged = true;
    } catch (error) {
      setupError = error;
      return;
    }
    const newState = getState();
    newState.monk = {
      combatAssistant: {
        get recentlyCompletedSummaries() {
          reads += 1;
          throw new Error("old handler inspected replacement owner");
        },
      },
    };
    throw new Error("owner changed after commit");
  });
  try {
    fireWorkspaceAction(dialog, "incoming-apply-damage");
  } finally {
    replaceOwner();
  }
  if (setupError) {
    assert.fail(`${setupError.message}\n${setupError.stack}`);
  }
  assert.equal(subscriberRan, true);
  assert.equal(ownerChanged, true);
  assert.equal(reads, 0);
  assert.equal(getSessionContext().characterId, "aurelia");
  assert.equal(getWorkspaceSessionForTests(), null);
  unsubscribe();
});

test("same-owner revision is refreshed; changed incoming preview requires another explicit apply", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  assert.equal(openIncomingAttack(null, { mode: "direct-damage" }).ok, true);
  typeIncoming(dialog, "incomingDamage", "4");
  updateState((draft) => {
    draft.ui.turn.bonusActionUsed = !draft.ui.turn.bonusActionUsed;
    return draft;
  });
  const hpBefore = getState().combat.hp.current;
  fireWorkspaceAction(dialog, "incoming-apply-damage");
  assert.equal(getState().combat.hp.current, hpBefore - 4);
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "result");
  unsubscribe();

  const changed = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  assert.equal(openIncomingAttack(null, { mode: "direct-damage" }).ok, true);
  typeIncoming(changed.dialog, "incomingDamage", "4");
  updateState((draft) => {
    draft.combat.hp.current -= 1;
    return draft;
  });
  const hpAfterRevision = getState().combat.hp.current;
  fireWorkspaceAction(changed.dialog, "incoming-apply-damage");
  assert.equal(getState().combat.hp.current, hpAfterRevision);
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "damage");
  assert.match(getWorkspaceSessionForTests().incomingDraft.error, /предварительный результат изменился/i);
  fireWorkspaceAction(changed.dialog, "incoming-apply-damage");
  assert.equal(getState().combat.hp.current, hpAfterRevision - 4);
  changed.unsubscribe();
});

test("production structural changes preserve incoming fields and focus the changed control", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  const controls = new Map();
  const baseQuerySelector = dialog.querySelector.bind(dialog);
  dialog.querySelector = (selector) => {
    const match = selector.match(/^\[data-workspace-field\]\[name="([^"]+)"\]$/);
    return match ? controls.get(match[1]) ?? null : baseQuerySelector(selector);
  };
  const structuralInput = (name, value) => {
    const control = {
      name, value, type: "select-one", dataset: { workspaceField: name },
      isConnected: true, focus() { this.focused = true; },
      closest(selector) { return selector === "[data-workspace-field]" ? this : null; },
    };
    controls.set(name, control);
    control.parentElement = dialog.body;
    dialog.fire("input", { target: control });
    assert.equal(control.focused, true);
  };
  const numericInput = (name, value) => {
    const field = {
      name, value, type: "number", dataset: { workspaceField: name },
      closest(selector) { return selector === "[data-workspace-field]" ? this : null; },
    };
    field.parentElement = dialog.body;
    dialog.fire("input", { target: field });
  };
  assert.equal(openIncomingAttack().ok, true);
  fireWorkspaceAction(dialog, "incoming-hit");
  fireWorkspaceAction(dialog, "incoming-source-spell");
  fireWorkspaceAction(dialog, "incoming-spell-save");
  structuralInput("rollMode", "advantage");
  assert.match(dialog.body.innerHTML, /Второй физический к20/);
  structuralInput("saveSource", "other");
  structuralInput("rollMode", "normal");
  assert.doesNotMatch(dialog.body.innerHTML, /Второй физический к20/);
  structuralInput("saveSource", "spell");
  assert.match(dialog.body.innerHTML, /Второй физический к20/);
  numericInput("secondD20", "12");
  numericInput("firstD20", "16");
  structuralInput("saveAbility", "dexterity");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.rollDraft.firstD20, "16");
  assert.match(dialog.body.innerHTML, /Первый физический к20/);
  fireWorkspaceAction(dialog, "incoming-save-success");
  fireWorkspaceAction(dialog, "incoming-set-has-damage");
  structuralInput("damageBasis", "full-effect");
  structuralInput("effectProfile", "save-half");
  const draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.rollDraft.damageBasis, "full-effect");
  assert.equal(draft.rollDraft.effectProfile, "save-half");
  assert.match(dialog.body.innerHTML, /Полный урон эффекта/);
  unsubscribe();
});

test("production handler preserves verification on receipt-inspection failure, then recovers matching receipt", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  assert.equal(openIncomingAttack().ok, true);
  fireWorkspaceAction(dialog, "incoming-hit");
  fireWorkspaceAction(dialog, "incoming-source-spell");
  fireWorkspaceAction(dialog, "incoming-spell-save");
  typeIncoming(dialog, "rollMode", "advantage");
  typeIncoming(dialog, "firstD20", "16");
  typeIncoming(dialog, "secondD20", "14");
  fireWorkspaceAction(dialog, "incoming-save-failure");
  fireWorkspaceAction(dialog, "incoming-set-has-damage");
  typeIncoming(dialog, "saveDamage", "3");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "save-consequence");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.rollDraft.firstD20, "16");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.rollDraft.damage, "3");
  let assistant;
  let descriptor;
  const failInspection = subscribe(() => {
    assistant = getState().monk.combatAssistant;
    descriptor = Object.getOwnPropertyDescriptor(assistant, "recentlyCompletedSummaries");
    Object.defineProperty(assistant, "recentlyCompletedSummaries", {
      configurable: true, get() { throw new Error("receipt inspection failed"); },
    });
    throw new Error("post-commit failure");
  });
  try {
    fireWorkspaceAction(dialog, "incoming-apply-save");
    assert.ok(assistant, getWorkspaceSessionForTests().incomingDraft.error);
  } finally {
    failInspection();
    if (assistant) Object.defineProperty(assistant, "recentlyCompletedSummaries", descriptor);
  }
  const verification = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(verification.stage, "verification");
  assert.match(verification.error, /receipt inspection failed/);
  assert.match(dialog.footer.innerHTML, /incoming-verify/);
  const hpAfterApply = getState().combat.hp.current;
  updateState((draft) => {
    draft.abilities.dexterity = 3;
    return draft;
  });
  fireWorkspaceAction(dialog, "incoming-verify");
  const recovered = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(recovered.stage, "result");
  assert.ok(recovered.appliedReceipt);
  assert.equal(getState().combat.hp.current, hpAfterApply);
  assert.deepEqual(recovered.pendingNormalizedRequest, recovered.appliedReceipt.request);
  unsubscribe();
});

test("incoming persistence retry does not touch a replacement session or replay the operation", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  assert.equal(openIncomingAttack(null, { mode: "direct-damage" }).ok, true);
  typeIncoming(dialog, "incomingDamage", "3");
  const originalSetItem = window.localStorage.setItem;
  window.localStorage.setItem = () => { throw new Error("initial storage failure"); };
  try {
    fireWorkspaceAction(dialog, "incoming-apply-damage");
  } finally {
    window.localStorage.setItem = originalSetItem;
  }
  const oldSession = getWorkspaceSessionForTests();
  const oldOperationId = oldSession.incomingDraft.pendingOperationId;
  assert.equal(oldSession.incomingDraft.stage, "save-recovery");
  assert.ok(readIncomingEventReceipt(getState(), oldOperationId));
  const hpAfterApply = getState().combat.hp.current;
  const receiptCountBeforeRetry = getState().monk.combatAssistant.recentlyCompletedSummaries
    .filter((entry) => entry.id === oldOperationId).length;
  let subscriberRan = false;
  let setupError = null;
  let replacement;
  let replacementSnapshot;
  let replacementMarkup;
  const replaceOnPersistenceRetry = subscribe((state, metadata) => {
    if (metadata?.kind !== "persistence-retry" || subscriberRan) return;
    subscriberRan = true;
    try {
      disposeWorkspaceOwner(oldSession.owner, "session-changed");
      const loaded = openCharacterSession("sara-velaris", () => ({
        status: "loaded",
        state: structuredClone(state),
      }));
      assert.equal(loaded.status, "loaded");
      assert.equal(openIncomingAttack(null, { mode: "direct-damage" }).ok, true);
      typeIncoming(dialog, "incomingDamage", "9");
      replacement = getWorkspaceSessionForTests();
      replacementSnapshot = structuredClone(replacement);
      replacementMarkup = dialog.body.innerHTML;
    } catch (error) {
      setupError = error;
    }
  });
  try {
    fireWorkspaceAction(dialog, "incoming-retry-save");
  } finally {
    replaceOnPersistenceRetry();
  }
  if (setupError) assert.fail(`${setupError.message}\n${setupError.stack}`);
  assert.equal(subscriberRan, true);
  assert.ok(replacement);
  assert.equal(replacement.incomingDraft.rawDamage, "9");
  assert.deepEqual(getWorkspaceSessionForTests(), replacementSnapshot);
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "damage");
  assert.equal(getWorkspaceSessionForTests().appliedUnsaved, false);
  assert.equal(dialog.body.innerHTML, replacementMarkup);
  assert.equal(getState().combat.hp.current, hpAfterApply);
  assert.equal(getState().monk.combatAssistant.recentlyCompletedSummaries
    .filter((entry) => entry.id === oldOperationId).length, receiptCountBeforeRetry);
  unsubscribe();
});

test("incoming controller collision preserves operation identity and blocks replay", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  const originalRandomUUID = globalThis.crypto.randomUUID;
  globalThis.crypto.randomUUID = () => "controller-collision-operation";
  let opened;
  try {
    opened = openIncomingAttack(null, { mode: "direct-damage" });
  } finally {
    globalThis.crypto.randomUUID = originalRandomUUID;
  }
  assert.equal(opened.ok, true);
  typeIncoming(dialog, "incomingDamage", "5");
  const session = getWorkspaceSessionForTests();
  const draft = session.incomingDraft;
  const operationId = draft.operationIds.apply;
  const request = {
    kind: "direct-damage",
    damage: "0",
    battleId: draft.battleId,
    eventId: draft.eventId,
    phaseAtOpen: draft.phaseAtOpen,
    ownTurnIdAtOpen: draft.ownTurnIdAtOpen,
  };
  const seeded = commitIncomingEvent(getSessionContext(), request, operationId);
  assert.equal(seeded.status, "applied", seeded.reason);
  const existingReceipt = readIncomingEventReceipt(getState(), operationId);
  assert.ok(existingReceipt);
  const hpBeforeAttempt = getState().combat.hp.current;
  const stateBeforeAttempt = structuredClone(getState());
  const storageBeforeAttempt = new Map(window.localStorage.values);
  const expectedRequest = normalizeIncomingEventRequest({
    ...request,
    damage: "5",
  }, getState());
  assert.equal(expectedRequest.ok, true);
  fireWorkspaceAction(dialog, "incoming-apply-damage");
  const collided = getWorkspaceSessionForTests();
  assert.equal(collided.incomingDraft.stage, "verification");
  assert.equal(collided.incomingDraft.pendingOperationId, operationId);
  assert.deepEqual(collided.incomingDraft.pendingNormalizedRequest, expectedRequest.request);
  assert.equal(collided.incomingDraft.appliedReceipt, null);
  assert.match(collided.incomingDraft.error, /уже связан с другим запросом/);
  assert.equal(collided.appliedUnsaved, true);
  assert.deepEqual(getState(), stateBeforeAttempt);
  assert.deepEqual(window.localStorage.values, storageBeforeAttempt);
  fireWorkspaceAction(dialog, "incoming-apply-damage");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "verification");
  assert.deepEqual(getState(), stateBeforeAttempt);
  assert.deepEqual(window.localStorage.values, storageBeforeAttempt);
  assert.equal(getState().combat.hp.current, hpBeforeAttempt);
  assert.equal(readIncomingEventReceipt(getState(), operationId), existingReceipt);
  assert.equal(getState().monk.combatAssistant.recentlyCompletedSummaries
    .filter((entry) => entry.id === operationId).length, 1);
  unsubscribe();
});
