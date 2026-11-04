import test from "node:test";
import assert from "node:assert/strict";
import { getSessionContext, getState, updateSessionState } from "../../scripts/state.js";
import { executeBattleCommand } from "../../scripts/battle/commands.js";
import {
  commitIncomingEvent,
  previewIncomingEvent,
  readIncomingEventReceipt,
} from "../../scripts/actions/incoming-event.js";
import { installWorkspaceFixture } from "./workspace-fixture.mjs";
import { resolveCharacterRollConsequence } from "../../scripts/rolls/commands.js";
import { beginOwnTurn } from "../../scripts/battle/transitions.js";

function incomingIdentity(eventId) {
  const battle = getState().battleConsole.current;
  return {
    battleId: battle.id,
    phaseAtOpen: battle.phase,
    ownTurnIdAtOpen: battle.ownTurnId ?? null,
    eventId,
  };
}

test("direct incoming damage validates physical values and applies temp HP before HP once", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  const identity = incomingIdentity("incoming-test");
  const battleId = identity.battleId;
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
    kind: "direct-damage", damage: "0", ...identity,
  }, "incoming-test-operation");
  assert.equal(result.status, "applied");
  assert.equal(getState().combat.hp.current, hp);
  assert.equal(getState().combat.hp.temp ?? 0, tempHp);
  assert.ok(readIncomingEventReceipt(getState(), "incoming-test-operation"));
  const replay = commitIncomingEvent(getSessionContext(), {
    kind: "direct-damage", damage: 0, ...identity,
  }, "incoming-test-operation");
  assert.equal(replay.status, "replayed");
  assert.equal(getState().combat.hp.current, hp);
  assert.equal(commitIncomingEvent(getSessionContext(), {
    kind: "direct-damage", damage: 1, ...identity,
  }, "incoming-test-operation").status, "rejected");
  assert.equal(commitIncomingEvent(getSessionContext(), {
    kind: "direct-damage", damage: 0, ...incomingIdentity("different-event"),
  }, "incoming-test-operation").status, "rejected");
  unsubscribe();
});

test("completed incoming save records unknown without consequence or HP loss", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  const identity = incomingIdentity("incoming-unknown-save");
  const battleId = identity.battleId;
  const hp = getState().combat.hp.current;
  const result = commitIncomingEvent(getSessionContext(), {
    kind: "completed-save",
    ...identity,
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
  const identity = incomingIdentity("incoming-deflect-operation");
  const battleId = identity.battleId;
  const context = getSessionContext();
  const poolsBefore = getState().combat.hp.current + getState().combat.hp.temp;
  const result = commitIncomingEvent(context, {
    kind: "deflection",
    source: "melee",
    damage: "60",
    deflectRoll: "1",
    ...identity,
    catchChoice: null,
  }, "incoming-deflect-operation");
  assert.equal(result.status, "applied");
  assert.equal(getState().ui.turn.reactionUsed, true);
  assert.ok(getState().combat.hp.current + getState().combat.hp.temp < poolsBefore);
  assert.equal(getState().monk.combatAssistant.recentlyCompletedSummaries.filter((entry) =>
    entry.kind === "incoming-event" && entry.id === "incoming-deflect-operation").length, 1);
  unsubscribe();
});

test("projectile catch creates a continuation only for a full reflection and catch choice", () => {
  for (const [eventId, damage, catchChoice, expected] of [
    ["catch-full", "0", "catch", true],
    ["catch-skip", "0", "skip", false],
    ["catch-remainder", "60", "catch", false],
  ]) {
    const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
    assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
    updateSessionState(getSessionContext(), (draft) => {
      if (!draft.monk.ordinaryTechniqueIds.includes("ll-monk:deflect-missile")) {
        draft.monk.ordinaryTechniqueIds.push("ll-monk:deflect-missile");
      }
      return draft;
    });
    const identity = incomingIdentity(eventId);
    const result = commitIncomingEvent(getSessionContext(), {
      kind: "deflection", source: "projectile", damage, deflectRoll: "1",
      catchChoice, ...identity,
    }, `operation-${eventId}`);
    assert.equal(result.status, "applied");
    assert.equal(Boolean(getState().monk.techniqueRuntime.deflectContinuation), expected);
    assert.equal(getState().ui.turn.reactionUsed, true);
    unsubscribe();
  }
});

test("completed save with applied damage records an applied consequence and cannot reapply", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  const identity = incomingIdentity("known-save");
  const result = commitIncomingEvent(getSessionContext(), {
    kind: "completed-save", ...identity, outcome: "failure", hasDamage: true,
    damage: "10", damageBasis: "dm-final",
    roll: { id: "wisdom", firstD20: "14", secondD20: null, rollMode: "normal", dc: null },
  }, "known-save-operation");
  assert.equal(result.status, "applied");
  const record = getState().characterRolls.records.find((entry) =>
    entry.id === "known-save-operation");
  assert.equal(record.consequence.status, "applied");
  const hpAfter = getState().combat.hp.current;
  assert.notEqual(resolveCharacterRollConsequence(record.id, "apply-to-character").status, "applied");
  assert.equal(getState().combat.hp.current, hpAfter);
  unsubscribe();
});

test("incoming request rejects a changed turn in the same battle", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
  const identity = incomingIdentity("stale-turn");
  updateSessionState(getSessionContext(), (draft) => {
    const turn = beginOwnTurn(draft, { id: "different-live-turn" });
    if (!turn.ok) throw new Error(turn.reason);
    return draft;
  });
  assert.equal(commitIncomingEvent(getSessionContext(), {
    kind: "direct-damage", damage: "5", ...identity,
  }, "stale-turn-operation").status, "rejected");
  unsubscribe();
});
