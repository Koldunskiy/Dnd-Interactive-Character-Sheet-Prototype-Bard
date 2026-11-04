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
  commitIncomingEvent,
  incomingEventRequestsMatch,
  normalizeIncomingEventRequest,
  previewIncomingEvent,
  readIncomingEventReceipt,
} from "../../scripts/actions/incoming-event.js";
import { getEffectiveTechniqueIds } from "../../scripts/selectors/techniques.js";
import { previewIncomingSaveAmendment } from "../../scripts/rolls/incoming-save-amendment.js";
import { calculateCharacterRoll } from "../../scripts/rolls/calculations.js";
import { getSaraRollBreakdown } from "../../scripts/rolls/providers/sara.js";
import { installWorkspaceFixture } from "./workspace-fixture.mjs";

function incomingIdentity(eventId) {
  const battle = getState().battleConsole.current;
  return {
    battleId: battle.id,
    phaseAtOpen: battle.phase,
    ownTurnIdAtOpen: battle.ownTurnId ?? null,
    eventId,
  };
}

function startBattle() {
  assert.equal(executeBattleCommand("start-battle", { rawD20: "12" }).status, "applied");
}

function baseSave(state, ability = "wisdom", firstD20 = "1", dc = "20") {
  const breakdown = getSaraRollBreakdown(state, "saving-throw", ability);
  assert.equal(breakdown.ok, true, breakdown.reason);
  const roll = calculateCharacterRoll({
    kind: "saving-throw",
    id: ability,
    firstD20,
    secondD20: null,
    rollMode: "normal",
    dc,
  }, breakdown);
  assert.equal(roll.ok, true, roll.reason);
  return {
    ...roll,
    manualOutcome: "failure",
    baseOutcome: "failure",
    appliedAmendments: [],
  };
}

test("Spirit of Tranquility is a base feature from monk level 9 without a selectable slot", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const state = getState();
  for (const [level, expected] of [[8, false], [9, true], [12, true]]) {
    const character = structuredClone(state);
    character.profile.level = level;
    assert.equal(
      getEffectiveTechniqueIds(character).includes("base:spirit-of-tranquility"),
      expected,
    );
    assert.equal(character.monk.ordinaryTechniqueIds.includes("base:spirit-of-tranquility"), false);
  }
  unsubscribe();
});

test("pure amendment preview uses Wisdom once for all six saves and ignores reaction use", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const state = getState();
  state.ui.turn.reactionUsed = true;
  const before = structuredClone(state);
  const storageBefore = new Map(window.localStorage.values);
  for (const ability of [
    "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma",
  ]) {
    const record = baseSave(state, ability);
    const result = previewIncomingSaveAmendment(state, record, {
      techniqueId: "base:spirit-of-tranquility",
      baseOutcome: "failure",
    });
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.paidKi, 1);
    assert.equal(result.bonus, 4);
    assert.equal(result.record.totalModifier, record.totalModifier + 4);
    assert.equal(result.record.total, record.total + 4);
    assert.deepEqual(result.record.rawD20Rolls, record.rawD20Rolls);
    assert.equal(result.record.chosenD20, record.chosenD20);
    assert.equal(result.record.appliedAt, undefined);
    assert.equal(result.record.modifierSnapshot.at(-1).label, "Дух спокойствия — Мудрость");
  }
  assert.deepEqual(getState(), before);
  assert.deepEqual(window.localStorage.values, storageBefore);
  unsubscribe();
});

test("amendment eligibility rejects low level, non-failure, and insufficient ki", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  const state = structuredClone(getState());
  const record = baseSave(state);
  const selection = {
    techniqueId: "base:spirit-of-tranquility",
    baseOutcome: "failure",
  };
  state.profile.level = 8;
  assert.equal(previewIncomingSaveAmendment(state, record, selection).availability, false);
  state.profile.level = 9;
  assert.equal(previewIncomingSaveAmendment(state, {
    ...record, manualOutcome: "success", baseOutcome: "success",
  }, selection).availability, false);
  assert.equal(previewIncomingSaveAmendment(state, {
    ...record, manualOutcome: "unknown", baseOutcome: "unknown",
  }, selection).availability, false);
  state.combat.ki.current = 0;
  const noKi = previewIncomingSaveAmendment(state, record, selection);
  assert.equal(noKi.ok, false);
  assert.match(noKi.reason, /1 ци/);
  unsubscribe();
});

test("completed incoming save normalizes legacy null amendments and rejects forged amendment fields", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  const request = {
    kind: "completed-save",
    ...incomingIdentity("amendment-normalize"),
    outcome: "failure",
    hasDamage: false,
    spellSaveSource: false,
    roll: { id: "wisdom", firstD20: "1", secondD20: null, rollMode: "normal", dc: "20" },
  };
  assert.equal(normalizeIncomingEventRequest(request, getState()).request.amendment, null);
  for (const amendment of [
    [],
    { techniqueId: "unknown", baseOutcome: "failure" },
    { techniqueId: "base:spirit-of-tranquility", baseOutcome: "failure", paidKi: 0 },
    { techniqueId: "base:spirit-of-tranquility", baseOutcome: "success" },
  ]) {
    assert.equal(previewIncomingEvent(getState(), {
      ...request, amendment,
    }).ok, false);
  }
  assert.equal(previewIncomingEvent(getState(), {
    ...request, paidKi: 0,
  }).ok, false);
  assert.equal(previewIncomingEvent(getState(), {
    ...request, bonus: 99,
  }).ok, false);
  assert.equal(previewIncomingEvent(getState(), {
    ...request,
    outcome: "unknown",
    amendment: { techniqueId: "base:spirit-of-tranquility", baseOutcome: "failure" },
  }).ok, false);
  unsubscribe();
});

test("legacy completed-save receipt without amendment replays as amendment null", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  const request = {
    kind: "completed-save",
    ...incomingIdentity("legacy-save-replay"),
    outcome: "failure",
    hasDamage: false,
    spellSaveSource: false,
    roll: { id: "wisdom", firstD20: "12", secondD20: null, rollMode: "normal", dc: null },
  };
  assert.equal(commitIncomingEvent(getSessionContext(), request, "legacy-save-operation").status,
    "applied");
  updateSessionState(getSessionContext(), (draft) => {
    const receipt = draft.monk.combatAssistant.recentlyCompletedSummaries.find((entry) =>
      entry.id === "legacy-save-operation");
    delete receipt.request.amendment;
    return draft;
  });
  const beforeReplay = structuredClone(getState());
  const legacyReceipt = readIncomingEventReceipt(beforeReplay, "legacy-save-operation");
  const normalizedRequest = normalizeIncomingEventRequest(request, beforeReplay).request;
  assert.equal(incomingEventRequestsMatch(legacyReceipt.request, normalizedRequest), true,
    JSON.stringify({ legacy: legacyReceipt.request, normalized: normalizedRequest }));
  const replay = commitIncomingEvent(getSessionContext(), request, "legacy-save-operation");
  assert.equal(replay.status, "replayed", replay.reason);
  assert.deepEqual(getState(), beforeReplay);
  unsubscribe();
});

test("amended Evasion save commits ki, history, consequence, and receipt atomically", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  const identity = incomingIdentity("amended-evasion-save");
  const request = {
    kind: "completed-save",
    ...identity,
    outcome: "success",
    amendment: {
      techniqueId: "base:spirit-of-tranquility",
      baseOutcome: "failure",
    },
    hasDamage: true,
    damage: "20",
    damageBasis: "full-effect",
    effectProfile: "save-half",
    spellSaveSource: false,
    roll: { id: "dexterity", firstD20: "1", secondD20: null, rollMode: "normal", dc: "14" },
  };
  const kiBefore = getState().combat.ki.current;
  const hpBefore = getState().combat.hp.current;
  const tempHpBefore = getState().combat.hp.temp;
  let stateUpdates = 0;
  const stopCounting = subscribe(() => {
    stateUpdates += 1;
  });
  const result = commitIncomingEvent(getSessionContext(), request, "amended-evasion-operation");
  assert.equal(result.status, "applied", result.reason);
  stopCounting();
  assert.equal(stateUpdates, 1);
  assert.equal(getState().combat.ki.current, kiBefore - 1);
  assert.equal(getState().combat.hp.current, hpBefore);
  assert.equal(getState().combat.hp.temp, tempHpBefore);
  assert.equal(getState().ui.turn.reactionUsed, false);
  const record = getState().characterRolls.records.find((entry) =>
    entry.id === "amended-evasion-operation");
  assert.equal(record.manualOutcome, "success");
  assert.equal(record.total, record.chosenD20 + record.totalModifier);
  assert.equal(record.consequence.finalDamage, 0);
  assert.equal(record.consequence.evasionUsed, true);
  assert.deepEqual(record.rawD20Rolls, [1]);
  assert.equal(record.appliedAmendments.length, 1);
  assert.deepEqual(record.appliedAmendments[0].before, {
    chosenD20: 1,
    modifier: record.totalModifier - 4,
    total: record.total - 4,
    outcome: "failure",
  });
  assert.equal(record.appliedAmendments[0].paidKi, 1);
  assert.equal(record.appliedAmendments[0].after.outcome, "success");
  assert.equal(record.modifierSnapshot.at(-1).label, "Дух спокойствия — Мудрость");
  const receipt = readIncomingEventReceipt(getState(), "amended-evasion-operation");
  assert.equal(receipt.request.amendment.baseOutcome, "failure");
  assert.equal(receipt.outcome.effects.amendment.paidKi, 1);
  assert.equal(receipt.outcome.effects.amendment.kiBefore, kiBefore);
  assert.equal(receipt.outcome.effects.amendment.kiAfter, kiBefore - 1);
  updateSessionState(getSessionContext(), (draft) => {
    draft.combat.ki.current = 0;
    draft.abilities.wisdom = 8;
    return draft;
  });
  const committedState = structuredClone(getState());
  const replay = commitIncomingEvent(getSessionContext(), request, "amended-evasion-operation");
  assert.equal(replay.status, "replayed");
  assert.deepEqual(getState(), committedState);
  assert.equal(commitIncomingEvent(getSessionContext(), {
    ...request, outcome: "failure",
  }, "amended-evasion-operation").code, "operation-id-collision");
  assert.equal(commitIncomingEvent(getSessionContext(), {
    ...request, amendment: null,
  }, "amended-evasion-operation").code, "operation-id-collision");
  unsubscribe();
});

test("amended failure uses Evasion half damage while DM-final is not halved twice", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  const request = {
    kind: "completed-save",
    ...incomingIdentity("amended-failure-save"),
    outcome: "failure",
    amendment: { techniqueId: "base:spirit-of-tranquility", baseOutcome: "failure" },
    hasDamage: true,
    damage: "10",
    damageBasis: "full-effect",
    effectProfile: "save-half",
    spellSaveSource: false,
    roll: { id: "dexterity", firstD20: "1", secondD20: null, rollMode: "normal", dc: "19" },
  };
  assert.equal(commitIncomingEvent(getSessionContext(), request, "amended-failure-operation").status,
    "applied");
  const record = getState().characterRolls.records.find((entry) =>
    entry.id === "amended-failure-operation");
  assert.equal(record.dcResult, false);
  assert.equal(record.consequence.finalDamage, 5);
  assert.equal(record.consequence.evasionUsed, true);

  const dmFinalRequest = {
    ...request,
    ...incomingIdentity("amended-dm-final-save"),
    damageBasis: "dm-final",
  };
  assert.equal(commitIncomingEvent(getSessionContext(), dmFinalRequest,
    "amended-dm-final-operation").status, "applied");
  const dmFinalRecord = getState().characterRolls.records.find((entry) =>
    entry.id === "amended-dm-final-operation");
  assert.equal(dmFinalRecord.consequence.finalDamage, 10);
  assert.equal(dmFinalRecord.consequence.damageBasis, "dm-final");
  unsubscribe();
});

test("invalid amended-save damage and missing ki leave all state unchanged", () => {
  const { unsubscribe } = installWorkspaceFixture({ embeddedHost: true });
  startBattle();
  const request = {
    kind: "completed-save",
    ...incomingIdentity("invalid-amended-save"),
    outcome: "success",
    amendment: { techniqueId: "base:spirit-of-tranquility", baseOutcome: "failure" },
    hasDamage: true,
    damage: "not-a-number",
    damageBasis: "dm-final",
    spellSaveSource: false,
    roll: { id: "wisdom", firstD20: "1", secondD20: null, rollMode: "normal", dc: "8" },
  };
  const stateBefore = structuredClone(getState());
  const storageBefore = new Map(window.localStorage.values);
  assert.equal(commitIncomingEvent(getSessionContext(), request, "invalid-save-damage").status,
    "rejected");
  assert.deepEqual(getState(), stateBefore);
  assert.deepEqual(window.localStorage.values, storageBefore);
  updateSessionState(getSessionContext(), (draft) => {
    draft.combat.ki.current = 0;
    return draft;
  });
  const noKiBefore = structuredClone(getState());
  const noKiResult = commitIncomingEvent(getSessionContext(), {
    ...request,
    eventId: "no-ki-amended-save",
    damage: "5",
  }, "no-ki-amended-save-operation");
  assert.equal(noKiResult.status, "rejected");
  assert.deepEqual(getState(), noKiBefore);
  unsubscribe();
});
