import test from "node:test";
import assert from "node:assert/strict";
import { getSessionContext, getState } from "../../scripts/state.js";
import { executeBattleCommand } from "../../scripts/battle/commands.js";
import { commitIncomingEvent } from "../../scripts/actions/incoming-event.js";
import {
  commitIncomingReply,
  previewIncomingReply,
  readIncomingReplyReceipt,
} from "../../scripts/actions/sara-combat.js";
import { installWorkspaceFixture } from "./workspace-fixture.mjs";

function identity(eventId) {
  const battle = getState().battleConsole.current;
  return {
    battleId: battle.id,
    phaseAtOpen: battle.phase,
    ownTurnIdAtOpen: battle.ownTurnId ?? null,
    eventId,
  };
}

test("deflect counter is one atomic completed reaction and replays canonically", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  const event = identity("counter-event");
  const parentOperationId = "counter-parent";
  assert.equal(commitIncomingEvent(getSessionContext(), {
    kind: "deflection",
    source: "melee",
    damage: "0",
    deflectRoll: "1",
    ...event,
  }, parentOperationId).status, "applied");

  const ownSequence = {
    id: "own-open-sequence",
    kind: "attack-action",
    status: "open",
    maximumAttacks: 1,
    resolvedAttacks: [],
  };
  getState().monk.combatAssistant.activeSequences.push(ownSequence);
  const request = {
    ...event,
    replyKind: "deflect-counter",
    parentOperationId,
    continuationId: null,
    trigger: null,
    attack: {
      rollMode: "normal",
      firstD20: "11",
      secondD20: null,
      targetArmorClass: null,
      dmHitResult: "miss",
      targetLabel: "Цель",
    },
    damageRolls: [],
  };
  const preview = previewIncomingReply(getState(), request);
  assert.equal(preview.ok, true, preview.reason);
  const result = commitIncomingReply(getSessionContext(), request, "counter-reply");
  assert.equal(result.status, "applied", result.reason);
  const receipt = readIncomingReplyReceipt(getState(), "counter-reply");
  assert.equal(receipt.replyKind, "deflect-counter");
  assert.equal(receipt.outcome.hit, false);
  const sequence = getState().monk.combatAssistant.activeSequences.find((entry) =>
    entry.incomingReply?.operationId === "counter-reply");
  assert.equal(sequence.status, "complete");
  assert.equal(sequence.resolvedAttacks[0].damageStatus, "not-applicable");
  assert.equal(getState().monk.combatAssistant.activeSequences.find((entry) =>
    entry.id === "own-open-sequence").status, "open");
  assert.equal(commitIncomingReply(getSessionContext(), request, "counter-reply").status, "replayed");
  assert.equal(commitIncomingReply(getSessionContext(), request, "another-reply").status, "rejected");
  unsubscribe();
});

test("invalid hit damage leaves the state unchanged", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  const event = identity("invalid-damage-event");
  const parentOperationId = "invalid-damage-parent";
  assert.equal(commitIncomingEvent(getSessionContext(), {
    kind: "deflection", source: "melee", damage: "0", deflectRoll: "1", ...event,
  }, parentOperationId).status, "applied");
  const request = {
    ...event,
    replyKind: "deflect-counter",
    parentOperationId,
    continuationId: null,
    trigger: null,
    attack: {
      rollMode: "normal", firstD20: "20", secondD20: null,
      targetArmorClass: null, dmHitResult: null, targetLabel: "",
    },
    damageRolls: ["99", "99"],
  };
  const stateBefore = structuredClone(getState());
  const result = commitIncomingReply(getSessionContext(), request, "invalid-reply");
  assert.equal(result.status, "rejected");
  assert.deepEqual(getState(), stateBefore);
  unsubscribe();
});

test("Ebb unarmed reply consumes reaction only with the completed hit and excludes the save reply", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  const event = identity("ebb-unarmed-event");
  const request = {
    ...event,
    replyKind: "ebb-unarmed",
    parentOperationId: null,
    continuationId: null,
    trigger: "melee-miss",
    attack: {
      rollMode: "normal", firstD20: "20", secondD20: null,
      targetArmorClass: "1", dmHitResult: null, targetLabel: "",
    },
    damageRolls: ["4", "5"],
  };
  assert.equal(getState().ui.turn.reactionUsed, false);
  assert.equal(commitIncomingReply(getSessionContext(), request, "ebb-unarmed-operation").status, "applied");
  assert.equal(getState().ui.turn.reactionUsed, true);
  const sequence = getState().monk.combatAssistant.activeSequences.find((entry) =>
    entry.incomingReply?.operationId === "ebb-unarmed-operation");
  assert.equal(sequence.resolvedAttacks[0].damageStatus, "recorded");
  const save = commitIncomingEvent(getSessionContext(), {
    kind: "ebb-and-flow",
    mode: "dexterity-save",
    triggerConfirmed: true,
    ...event,
  }, "ebb-save-operation");
  assert.equal(save.status, "rejected");
  unsubscribe();
});

test("completed Ebb save receipt excludes a later unarmed reply for the same event", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  const event = identity("ebb-save-exclusive-event");
  assert.equal(commitIncomingEvent(getSessionContext(), {
    kind: "ebb-and-flow",
    mode: "dexterity-save",
    triggerConfirmed: true,
    ...event,
  }, "ebb-save-exclusive-operation").status, "applied");
  const result = commitIncomingReply(getSessionContext(), {
    ...event,
    replyKind: "ebb-unarmed",
    parentOperationId: null,
    continuationId: null,
    trigger: "melee-miss",
    attack: {
      rollMode: "normal", firstD20: "10", secondD20: null,
      targetArmorClass: null, dmHitResult: "miss", targetLabel: "",
    },
    damageRolls: [],
  }, "ebb-after-save-operation");
  assert.equal(result.status, "rejected");
  assert.equal(getState().monk.combatAssistant.activeSequences.some((entry) =>
    entry.incomingReply?.eventId === event.eventId), false);
  unsubscribe();
});
