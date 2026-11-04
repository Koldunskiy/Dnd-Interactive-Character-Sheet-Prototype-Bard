import test from "node:test";
import assert from "node:assert/strict";
import {
  getState,
  getSessionContext,
  updateSessionState,
} from "../../scripts/state.js";
import { executeBattleCommand } from "../../scripts/battle/commands.js";
import { getWorkspaceSessionForTests, openIncomingAttack } from "../../scripts/workspace/controller.js";
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

test("production incoming handler completes a caught projectile return atomically", () => {
  const { dialog, unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  assert.equal(executeBattleCommand("begin-own-turn").status, "applied");
  updateSessionState(getSessionContext(), (draft) => {
    draft.monk.ordinaryTechniqueIds.push("ll-monk:deflect-missile");
    return draft;
  });
  const kiBefore = getState().combat.ki.current;
  assert.equal(openIncomingAttack().ok, true);
  fireWorkspaceAction(dialog, "incoming-hit");
  fireWorkspaceAction(dialog, "incoming-source-projectile");
  typeIncoming(dialog, "incomingDamage", "0");
  fireWorkspaceAction(dialog, "incoming-open-deflect");
  typeIncoming(dialog, "incomingDamage", "0");
  typeIncoming(dialog, "deflectRoll", "1");
  fireWorkspaceAction(dialog, "incoming-catch");
  fireWorkspaceAction(dialog, "incoming-apply-deflection");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "result");
  assert.equal(getState().monk.techniqueRuntime.deflectContinuation.kind, "missile-return");

  fireWorkspaceAction(dialog, "incoming-open-return");
  typeIncoming(dialog, "replyFirstD20", "20");
  typeIncoming(dialog, "replyTargetArmorClass", "1");
  fireWorkspaceAction(dialog, "incoming-reply-submit");
  assert.equal(getWorkspaceSessionForTests().incomingDraft.stage, "reply-damage");
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
