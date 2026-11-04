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
  openNormalAttack,
} from "../../scripts/workspace/controller.js";
import { readIncomingEventReceipt } from "../../scripts/actions/incoming-event.js";
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

function startCaughtProjectile(dialog) {
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  assert.equal(executeBattleCommand("begin-own-turn").status, "applied");
  updateSessionState(getSessionContext(), (draft) => {
    if (!draft.monk.ordinaryTechniqueIds.includes("ll-monk:deflect-missile")) {
      draft.monk.ordinaryTechniqueIds.push("ll-monk:deflect-missile");
    }
    return draft;
  });
  assert.equal(openIncomingAttack().ok, true);
  fireWorkspaceAction(dialog, "incoming-hit");
  fireWorkspaceAction(dialog, "incoming-source-projectile");
  typeIncoming(dialog, "incomingDamage", "0");
  fireWorkspaceAction(dialog, "incoming-open-deflect");
  typeIncoming(dialog, "incomingDamage", "0");
  typeIncoming(dialog, "deflectRoll", "1");
  fireWorkspaceAction(dialog, "incoming-catch");
  fireWorkspaceAction(dialog, "incoming-apply-deflection");
  return {
    receiptId: getWorkspaceSessionForTests().incomingDraft.appliedReceipt.id,
    ki: getState().combat.ki.current,
    hp: getState().combat.hp.current,
  };
}

test("production incoming handler completes a caught projectile return atomically", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startCaughtProjectile(dialog);
  const kiBefore = getState().combat.ki.current;
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "result");
  assert.equal(getState().monk.techniqueRuntime.deflectContinuation.kind, "missile-return");

  fireWorkspaceAction(dialog, "incoming-open-return");
  typeIncoming(dialog, "replyFirstD20", "20");
  typeIncoming(dialog, "replyTargetArmorClass", "1");
  fireWorkspaceAction(dialog, "incoming-reply-submit");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "reply-damage");
  assert.match(dialog.body.innerHTML, /name="replyDamage1"/);
  assert.match(dialog.body.innerHTML, /name="replyDamage2"/);
  typeIncoming(dialog, "replyDamage1", "5");
  typeIncoming(dialog, "replyDamage2", "4");
  const originalSetItem = window.localStorage.setItem;
  window.localStorage.setItem = () => { throw new Error("reply storage failure"); };
  try {
    fireWorkspaceAction(dialog, "incoming-reply-submit");
  } finally {
    window.localStorage.setItem = originalSetItem;
  }

  const draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.stage, "save-recovery");
  const replyOperationId = draft.operationIds.reply;
  const kiAfterCommit = getState().combat.ki.current;
  fireWorkspaceAction(dialog, "incoming-retry-save");
  const recoveredDraft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(recoveredDraft.stage, "reply-result",
    getWorkspaceSessionForTests().incomingDraft.error);
  assert.equal(getState().combat.ki.current, kiAfterCommit);
  assert.equal(getState().combat.ki.current, kiBefore - 1);
  assert.equal(getState().monk.techniqueRuntime.deflectContinuation.consumed, true);
  const sequence = getState().monk.combatAssistant.activeSequences.find((entry) =>
    entry.incomingReply?.operationId === replyOperationId);
  assert.equal(sequence.kind, "returned-projectile");
  assert.equal(sequence.status, "complete");
  assert.equal(sequence.resolvedAttacks[0].critical, true);
  assert.equal(sequence.resolvedAttacks[0].damageStatus, "recorded");
  assert.equal(sequence.resolvedAttacks[0].damageRolls.length, 2);
  unsubscribe();
});

test("reply-cancel footer preserves deflection; close declines safely without spending ki", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const { receiptId, ki, hp } = startCaughtProjectile(dialog);
  const tokenId = getState().monk.techniqueRuntime.deflectContinuation.id;
  fireWorkspaceAction(dialog, "incoming-open-return");
  fireWorkspaceAction(dialog, "incoming-reply-cancel");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "result");
  assert.equal(getState().combat.ki.current, ki);
  assert.equal(getState().monk.techniqueRuntime.deflectContinuation.id, tokenId);
  assert.equal(readIncomingEventReceipt(getState(), receiptId).outcome.effects.finalRemainder, 0);

  fireWorkspaceAction(dialog, "incoming-open-return");
  fireWorkspaceAction(dialog, "incoming-cancel");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "result");
  assert.equal(getState().combat.ki.current, ki);
  fireWorkspaceAction(dialog, "incoming-close");
  assert.equal(getWorkspaceSessionForTests(), null);
  assert.equal(getState().monk.techniqueRuntime.deflectContinuation, undefined);
  assert.equal(getState().combat.ki.current, ki);
  assert.equal(getState().combat.hp.current, hp);
  fireWorkspaceAction(dialog, "incoming-close");
  assert.equal(getState().combat.ki.current, ki);
  unsubscribe();
});

test("missile miss consumes one ki and token without asking for damage", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const { ki } = startCaughtProjectile(dialog);
  fireWorkspaceAction(dialog, "incoming-open-return");
  typeIncoming(dialog, "replyFirstD20", "1");
  typeIncoming(dialog, "replyTargetArmorClass", "15");
  fireWorkspaceAction(dialog, "incoming-reply-submit");
  const draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.stage, "reply-result");
  assert.equal(draft.appliedReceipt.outcome.hit, false);
  assert.equal(getState().combat.ki.current, ki - 1);
  assert.equal(getState().monk.techniqueRuntime.deflectContinuation.consumed, true);
  const sequence = getState().monk.combatAssistant.activeSequences.find((entry) =>
    entry.incomingReply?.operationId === draft.operationIds.reply);
  assert.equal(sequence.resolvedAttacks[0].damageStatus, "not-applicable");
  unsubscribe();
});

test("invalid attack preview in reply-damage shows its reason without damage controls", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const { ki } = startCaughtProjectile(dialog);
  fireWorkspaceAction(dialog, "incoming-open-return");
  fireWorkspaceAction(dialog, "incoming-reply-hit");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "reply-damage");
  assert.match(dialog.body.innerHTML, /role="status"/);
  assert.doesNotMatch(dialog.body.innerHTML, /name="replyDamage1"/);
  fireWorkspaceAction(dialog, "incoming-reply-submit");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "reply-damage");
  assert.equal(getState().combat.ki.current, ki);
  assert.equal(getState().monk.techniqueRuntime.deflectContinuation.consumed, undefined);
  unsubscribe();
});

test("target label is informational; attack edits after damage clear rolls and rebuild stage", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startCaughtProjectile(dialog);
  fireWorkspaceAction(dialog, "incoming-open-return");
  typeIncoming(dialog, "replyFirstD20", "20");
  typeIncoming(dialog, "replyTargetArmorClass", "1");
  fireWorkspaceAction(dialog, "incoming-reply-submit");
  typeIncoming(dialog, "replyDamage1", "5");
  typeIncoming(dialog, "replyDamage2", "4");
  typeIncoming(dialog, "replyTargetLabel", "Страж");
  let draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.stage, "reply-damage");
  assert.deepEqual(draft.replyDraft.damageRolls, ["5", "4"]);

  let focusedControl = null;
  const querySelector = dialog.querySelector.bind(dialog);
  dialog.querySelector = (selector) => {
    const match = selector.match(/name="(reply[^"]+)"/);
    if (match) {
      return {
        isConnected: true,
        focus() { focusedControl = match[1]; },
      };
    }
    return querySelector(selector);
  };
  typeIncoming(dialog, "replyFirstD20", "19");
  draft = getWorkspaceSessionForTests().incomingDraft;
  dialog.querySelector = querySelector;
  assert.equal(draft.stage, "reply-input");
  assert.equal(focusedControl, "replyFirstD20");
  assert.equal(draft.replyDraft.attack.firstD20, "19");
  assert.deepEqual(draft.replyDraft.damageRolls, []);
  assert.doesNotMatch(dialog.body.innerHTML, /name="replyDamage1"/);
  fireWorkspaceAction(dialog, "incoming-reply-submit");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "reply-damage");
  assert.match(dialog.body.innerHTML, /name="replyDamage1"/);
  assert.doesNotMatch(dialog.body.innerHTML, /name="replyDamage2"/);
  unsubscribe();
});

test("duplicate operation without canonical evidence stays in verification", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  assert.equal(openIncomingAttack().ok, true);
  fireWorkspaceAction(dialog, "incoming-miss");
  fireWorkspaceAction(dialog, "incoming-ebb-unarmed");
  const operationId = getWorkspaceSessionForTests().incomingDraft.operationIds.reply;
  assert.equal(updateSessionState(getSessionContext(), (draft) => draft, {
    operationId,
    metadata: { kind: "test-operation-collision" },
  }).status, "applied");
  typeIncoming(dialog, "replyFirstD20", "1");
  typeIncoming(dialog, "replyTargetArmorClass", "10");
  fireWorkspaceAction(dialog, "incoming-reply-submit");
  const draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.stage, "verification");
  assert.equal(draft.pendingOperationId, operationId);
  assert.equal(draft.appliedReceipt, null);
  fireWorkspaceAction(dialog, "incoming-reply-submit");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "verification");
  assert.equal(getState().ui.turn.reactionUsed, false);
  unsubscribe();
});

test("receipt inspection exception after commit is contained and locks the reply", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  assert.equal(openIncomingAttack().ok, true);
  fireWorkspaceAction(dialog, "incoming-miss");
  fireWorkspaceAction(dialog, "incoming-ebb-unarmed");
  typeIncoming(dialog, "replyFirstD20", "1");
  typeIncoming(dialog, "replyTargetArmorClass", "10");
  let assistant;
  let originalSequences;
  const throwDuringInspection = subscribe((state, metadata) => {
    if (metadata?.kind !== "sara-incoming-reply") return;
    assistant = state.monk.combatAssistant;
    originalSequences = assistant.activeSequences;
    Object.defineProperty(assistant, "activeSequences", {
      configurable: true,
      get() { throw new Error("receipt inspection failure"); },
    });
    throw new Error("post-commit subscriber failure");
  });
  assert.doesNotThrow(() => fireWorkspaceAction(dialog, "incoming-reply-submit"));
  throwDuringInspection();
  const draft = getWorkspaceSessionForTests().incomingDraft;
  assert.equal(draft.stage, "verification");
  assert.match(draft.error, /receipt inspection failure/);
  Object.defineProperty(assistant, "activeSequences", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: originalSequences,
  });
  assert.equal(originalSequences.some((entry) =>
    entry.incomingReply?.operationId === draft.operationIds.reply), true);
  unsubscribe();
});

test("U1 end-battle during reply does not restore the suspended parent workspace", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  assert.equal(executeBattleCommand("begin-own-turn").status, "applied");
  assert.equal(openNormalAttack().ok, true);
  const parentId = getWorkspaceSessionForTests().workspaceSessionId;
  assert.equal(openIncomingAttack().ok, true);
  fireWorkspaceAction(dialog, "incoming-miss");
  fireWorkspaceAction(dialog, "incoming-ebb-unarmed");
  const owner = getSessionContext();
  const battleId = getState().battleConsole.current.id;
  fireWorkspaceAction(dialog, "end-battle", {
    battleId,
    battleOwner: JSON.stringify([owner.characterId, owner.sessionGeneration]),
  });
  assert.equal(getState().battleConsole.current, null);
  assert.equal(getWorkspaceSessionForTests(), null);
  assert.notEqual(getWorkspaceSessionForTests()?.workspaceSessionId, parentId);
  unsubscribe();
});
