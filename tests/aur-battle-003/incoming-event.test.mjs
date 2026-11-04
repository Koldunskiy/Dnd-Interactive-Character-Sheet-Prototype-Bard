import test from "node:test";
import assert from "node:assert/strict";
import { getSessionContext, getState } from "../../scripts/state.js";
import { executeBattleCommand } from "../../scripts/battle/commands.js";
import {
  commitIncomingEvent,
  previewIncomingEvent,
  readIncomingEventReceipt,
} from "../../scripts/actions/incoming-event.js";
import { installWorkspaceFixture } from "./workspace-fixture.mjs";

test("direct incoming damage validates physical values and applies temp HP before HP once", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  const battleId = getState().battleConsole.current.id;
  const context = getSessionContext();
  const stateBefore = structuredClone(getState());
  for (const invalid of ["", "1.5", "-1"]) {
    assert.equal(previewIncomingEvent(stateBefore, {
      kind: "direct-damage", damage: invalid, battleId,
    }).ok, false);
  }
  assert.equal(previewIncomingEvent(stateBefore, {
    kind: "direct-damage", damage: "0", battleId,
  }).ok, true);
  const hp = getState().combat.hp.current;
  const tempHp = getState().combat.hp.temp ?? 0;
  const result = commitIncomingEvent(context, {
    kind: "direct-damage", damage: "0", battleId, eventId: "incoming-test",
  }, "incoming-test-operation");
  assert.equal(result.status, "applied");
  assert.equal(getState().combat.hp.current, hp);
  assert.equal(getState().combat.hp.temp ?? 0, tempHp);
  assert.ok(readIncomingEventReceipt(getState(), "incoming-test-operation"));
  const replay = commitIncomingEvent(getSessionContext(), {
    kind: "direct-damage", damage: 0, battleId,
  }, "incoming-test-operation");
  assert.equal(replay.status, "replayed");
  assert.equal(getState().combat.hp.current, hp);
  assert.equal(commitIncomingEvent(getSessionContext(), {
    kind: "direct-damage", damage: 1, battleId,
  }, "incoming-test-operation").status, "rejected");
  unsubscribe();
});

test("completed incoming save records unknown without consequence or HP loss", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  const battleId = getState().battleConsole.current.id;
  const hp = getState().combat.hp.current;
  const result = commitIncomingEvent(getSessionContext(), {
    kind: "completed-save",
    battleId,
    eventId: "incoming-unknown-save",
    outcome: "unknown",
    hasDamage: false,
    spellSaveSource: false,
    roll: {
      id: "wisdom", firstD20: "14", secondD20: null, rollMode: "normal", dc: null,
    },
  }, "incoming-unknown-save-operation");
  assert.equal(result.status, "applied");
  assert.equal(getState().combat.hp.current, hp);
  const record = getState().characterRolls.records.find((entry) =>
    entry.id === "incoming-unknown-save-operation");
  assert.equal(record.manualOutcome, null);
  assert.equal(record.consequence, null);
  assert.equal(readIncomingEventReceipt(getState(), "incoming-unknown-save-operation")
    .outcome.effects.consequence.finalDamage, 0);
  unsubscribe();
});

test("melee deflection atomically records reaction, HP remainder, and incoming receipt", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  const battleId = getState().battleConsole.current.id;
  const context = getSessionContext();
  const poolsBefore = getState().combat.hp.current + getState().combat.hp.temp;
  const result = commitIncomingEvent(context, {
    kind: "deflection",
    source: "melee",
    damage: "60",
    deflectRoll: "1",
    battleId,
    catchChoice: null,
  }, "incoming-deflect-operation");
  assert.equal(result.status, "applied");
  assert.equal(getState().ui.turn.reactionUsed, true);
  assert.ok(getState().combat.hp.current + getState().combat.hp.temp < poolsBefore);
  assert.equal(getState().monk.combatAssistant.recentlyCompletedSummaries.filter((entry) =>
    entry.kind === "incoming-event" && entry.id === "incoming-deflect-operation").length, 1);
  unsubscribe();
});
