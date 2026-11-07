import test from "node:test";
import assert from "node:assert/strict";
import {
  getSessionContext,
  getState,
  openCharacterSession,
  updateState,
} from "../../scripts/state.js";
import {
  buildGentlingMechanicsBasis,
  commitCompletedGentlingTouch,
  commitCompletedNormalAttack,
  getSaraAttackCount,
  getUsedAttackSlots,
  previewCompletedGentlingTouch,
  readCompletedGentlingTouchReceipt,
  startAttackSequence,
} from "../../scripts/actions/sara-combat.js";
import { getDerivedStats } from "../../scripts/calculations.js";

function prepare({ level = 6, wisdom = 14, ki = 20 } = {}) {
  const values = new Map();
  globalThis.window = {
    localStorage: {
      values,
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) { values.set(key, value); },
      removeItem(key) { values.delete(key); },
    },
  };
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  updateState((draft) => {
    draft.profile.level = level;
    draft.combat.hitDice.remaining = Math.min(draft.combat.hitDice.remaining, level);
    draft.abilities.wisdom = wisdom;
    draft.combat.ki.current = ki;
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:gentling-touch";
    return draft;
  });
  return getSessionContext();
}

function requestFor({
  sequenceId = "completed-gentling-sequence",
  extraKi = 0,
  targetHp = 10,
  sum = 20,
  confirmSeparateAction = false,
  expectedSequenceExists = false,
  expectedUsedSlots = 0,
} = {}) {
  const state = getState();
  const sequence = state.monk.combatAssistant.activeSequences.find((entry) =>
    entry.id === sequenceId) ?? null;
  const battle = state.battleConsole.current;
  return {
    sequenceId,
    sequenceKind: "attack-action",
    battleId: battle?.id ?? null,
    phaseAtOpen: battle?.phase ?? "waiting",
    ownTurnId: battle?.phase === "own-turn" ? battle.ownTurnId : null,
    turnMarker: Number(state.ui.turn.turnNumber),
    expectedSequenceExists,
    expectedUsedSlots,
    expectedMechanicsBasis: buildGentlingMechanicsBasis(state, sequence),
    confirmSeparateAction,
    extraKi,
    targetHp,
    sum,
  };
}

function assertRejectedUnchanged(request, operationId = "gentling-rejected") {
  const state = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  const storage = new Map(window.localStorage.values);
  const result = commitCompletedGentlingTouch(getSessionContext(), request, operationId);
  assert.equal(result.status, "rejected");
  assert.deepEqual(getState(), state);
  assert.equal(getSessionContext().stateRevision, revision);
  assert.deepEqual(window.localStorage.values, storage);
}

function applyGentling(request, operationId) {
  const preview = previewCompletedGentlingTouch(getState(), request);
  assert.equal(preview.ok, true, preview.reason);
  assert.equal(preview.stage, "complete");
  return commitCompletedGentlingTouch(getSessionContext(), preview.request, operationId);
}

function completedNormalRequest(sequenceId, attackId, expectedUsedSlots) {
  const state = getState();
  const profile = getDerivedStats(state).saraAttackProfiles.unarmed;
  const sides = Number(profile.damageDice.match(/d(\d+)/)?.[1]);
  return {
    sequenceId,
    attackId,
    battleId: state.battleConsole.current?.id ?? null,
    ownTurnId: state.battleConsole.current?.phase === "own-turn"
      ? state.battleConsole.current.ownTurnId : null,
    turnMarker: Number(state.ui.turn.turnNumber),
    expectedUsedSlots,
    attack: {
      profileId: "unarmed",
      rollMode: "normal",
      firstD20: "15",
      secondD20: "",
      targetArmorClass: "1",
      dmHitResult: null,
      targetLabel: "",
      confirmSeparateAction: false,
      dmExceptionConfirmed: false,
    },
    damageRolls: ["1"],
  };
}

test("D01-D08: first, thresholds, zero HP, Wisdom cap and negative Wisdom commit atomically", () => {
  prepare();
  const stateBefore = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  const request = requestFor({ targetHp: 20, sum: 20 });
  assert.equal(previewCompletedGentlingTouch(getState(), request).result.thresholdMet, true);
  assert.equal(applyGentling(request, "gentling-equality").status, "applied");
  assert.equal(getSessionContext().stateRevision, revision + 1);
  let sequence = getState().monk.combatAssistant.activeSequences[0];
  assert.equal(sequence.kind, "attack-action");
  assert.equal(sequence.replacementResults.length, 1);
  assert.equal(sequence.resolvedAttacks.length, 0);
  assert.equal(sequence.replacementResults[0].slotNumber, 1);
  assert.equal(getUsedAttackSlots(sequence), 1);
  assert.equal(sequence.replacementResults[0].thresholdMet, true);
  assert.equal(getState().combat.ki.current, stateBefore.combat.ki.current - 1);
  assert.equal(getState().ui.turn.actionUsed, true);

  const next = requestFor({
    sequenceId: sequence.id, expectedSequenceExists: true, expectedUsedSlots: 1,
    extraKi: 2, targetHp: 21, sum: 20,
  });
  assert.equal(applyGentling(next, "gentling-below-threshold").status, "applied");
  sequence = getState().monk.combatAssistant.activeSequences[0];
  assert.equal(sequence.replacementResults[1].thresholdMet, false);
  assert.equal(sequence.replacementResults[1].cost, 3);
  assert.equal(getState().combat.ki.current, stateBefore.combat.ki.current - 4);
  assert.equal(sequence.status, "complete");

  prepare({ level: 6, wisdom: 14 });
  const zeroHp = requestFor({ targetHp: 0, sum: 5 });
  assert.equal(applyGentling(zeroHp, "gentling-zero-hp").status, "applied");
  prepare({ wisdom: 6 });
  const negativeWisdom = requestFor({ extraKi: 0, sum: 5 });
  assert.equal(previewCompletedGentlingTouch(getState(), negativeWisdom).ok, true);
  assert.equal(applyGentling(negativeWisdom, "gentling-negative-wisdom").status, "applied");
});

test("D09-D15: invalid integers, physical range and insufficient ki reject without mutation", () => {
  prepare();
  const sides = getDerivedStats(getState()).monk.martialDieSides;
  for (const [field, value] of [
    ["extraKi", -1], ["extraKi", 1.5], ["extraKi", ""], ["extraKi", null],
    ["extraKi", 3], ["sum", 4], ["sum", 5 * sides + 1], ["sum", 5.5], ["sum", ""],
    ["sum", null], ["targetHp", -1], ["targetHp", 1.2], ["targetHp", ""],
    ["targetHp", null], ["targetHp", Infinity],
  ]) {
    const request = requestFor();
    request[field] = value;
    assertRejectedUnchanged(request, `invalid-${field}-${String(value)}`);
  }
  const maximum = requestFor({ sum: 30 });
  assert.equal(previewCompletedGentlingTouch(getState(), maximum).ok, true);
  const shortage = requestFor({ extraKi: 2, targetHp: 10, sum: 7 });
  updateState((draft) => { draft.combat.ki.current = 2; return draft; });
  assertRejectedUnchanged(shortage, "gentling-insufficient-ki");
});

test("D15, D38-D43: canonical replay, early replay, request mismatch and legacy-ID collision", () => {
  prepare();
  const first = requestFor({ sum: "20", targetHp: "7", extraKi: "0" });
  assert.equal(applyGentling(first, "gentling-replay-id").status, "applied");
  const second = requestFor({
    sequenceId: first.sequenceId, expectedSequenceExists: true,
    expectedUsedSlots: 1, sum: 20, targetHp: 7, extraKi: 0,
  });
  assert.equal(applyGentling(second, "gentling-next").status, "applied");
  const revision = getSessionContext().stateRevision;
  const ki = getState().combat.ki.current;
  const replay = commitCompletedGentlingTouch(
    getSessionContext(), first, "gentling-replay-id",
  );
  assert.equal(replay.status, "replayed");
  assert.equal(getSessionContext().stateRevision, revision);
  assert.equal(getState().combat.ki.current, ki);
  assert.equal(readCompletedGentlingTouchReceipt(getState(), "gentling-replay-id")
    .result.slotNumber, 1);
  assert.equal(commitCompletedGentlingTouch(
    getSessionContext(), { ...first, targetHp: 8 }, "gentling-replay-id",
  ).reason, "operation-collision");
  assert.equal(commitCompletedGentlingTouch(
    getSessionContext(), { ...first, sequenceId: "other-sequence" }, "gentling-replay-id",
  ).reason, "operation-collision");

  prepare();
  updateState((draft) => {
    draft.monk.combatAssistant.activeSequences.push({
      id: "legacy-sequence", kind: "attack-action", status: "open",
      maximumAttacks: 2, turnMarker: draft.ui.turn.turnNumber,
      battleId: null, ownTurnId: null, actionFlagApplied: false,
      resolvedAttacks: [], replacementResults: [{
        id: "legacy-collision", operationId: "legacy-collision",
        kind: "gentling-touch", request: { extraKi: 0, targetHp: 1, sum: 5 },
      }],
    });
    return draft;
  });
  const collision = requestFor({
    sequenceId: "legacy-sequence", expectedSequenceExists: true,
  });
  assertRejectedUnchanged(collision, "legacy-collision");
});

test("D16-D20: completed normal parents retain evidence and Gentling uses the saved capacity", () => {
  prepare({ level: 6 });
  const sequenceId = "normal-then-gentling";
  const normal = completedNormalRequest(sequenceId, "normal-attack", 0);
  assert.equal(commitCompletedNormalAttack(
    getSessionContext(), normal, "normal-gentling-parent",
  ).status, "applied");
  const sequence = getState().monk.combatAssistant.activeSequences[0];
  const normalEvidence = sequence.resolvedAttacks[0].completedOperation;
  assert.ok(normalEvidence && typeof normalEvidence === "object");
  assert.equal(normalEvidence.operationId, "normal-gentling-parent");
  const savedNormalEvidence = structuredClone(normalEvidence);
  const gentling = requestFor({
    sequenceId, expectedSequenceExists: true, expectedUsedSlots: 1,
  });
  assert.equal(applyGentling(gentling, "normal-parent-gentling").status, "applied");
  assert.deepEqual(getState().monk.combatAssistant.activeSequences[0]
    .resolvedAttacks[0].completedOperation, savedNormalEvidence);
  const savedMaximum = getState().monk.combatAssistant.activeSequences[0].maximumAttacks;
  updateState((draft) => { draft.profile.level = 4; return draft; });
  assert.equal(getState().monk.combatAssistant.activeSequences[0].maximumAttacks, savedMaximum);
  const staleCapacityRequest = requestFor({
    sequenceId, expectedSequenceExists: true, expectedUsedSlots: 2,
  });
  assert.equal(previewCompletedGentlingTouch(getState(), staleCapacityRequest).ok, false);
});

test("D46: two operation IDs cannot apply to the same expected slot", () => {
  prepare();
  const first = requestFor();
  assert.equal(applyGentling(first, "slot-race-first").status, "applied");
  const nextSlot = requestFor({
    sequenceId: first.sequenceId,
    expectedSequenceExists: true,
    expectedUsedSlots: 1,
  });
  assert.equal(applyGentling(nextSlot, "slot-race-second").status, "applied");
  const afterFirst = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  const storage = new Map(window.localStorage.values);
  const staleSameSlot = commitCompletedGentlingTouch(
    getSessionContext(), nextSlot, "slot-race-third",
  );
  assert.equal(staleSameSlot.status, "rejected");
  assert.deepEqual(getState(), afterFirst);
  assert.equal(getSessionContext().stateRevision, revision);
  assert.deepEqual(window.localStorage.values, storage);
  assert.equal(getUsedAttackSlots(getState().monk.combatAssistant.activeSequences[0]), 2);
});

test("D47-D48: malformed and ambiguous receipts are conflicts, never replay evidence", () => {
  prepare();
  const request = requestFor();
  assert.equal(applyGentling(request, "malformed-receipt-id").status, "applied");
  const entry = getState().monk.combatAssistant.activeSequences[0].replacementResults[0];
  entry.completedGentlingOperation.outcome.sum += 1;
  const before = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  const storage = new Map(window.localStorage.values);
  assert.equal(readCompletedGentlingTouchReceipt(getState(), "malformed-receipt-id").conflict, true);
  assert.equal(commitCompletedGentlingTouch(
    getSessionContext(), request, "malformed-receipt-id",
  ).status, "rejected");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);
  assert.deepEqual(window.localStorage.values, storage);

  prepare();
  const ambiguousRequest = requestFor();
  assert.equal(applyGentling(ambiguousRequest, "ambiguous-receipt-id").status, "applied");
  const sequences = getState().monk.combatAssistant.activeSequences;
  sequences.push(structuredClone(sequences[0]));
  const ambiguousState = structuredClone(getState());
  const ambiguousRevision = getSessionContext().stateRevision;
  const ambiguousStorage = new Map(window.localStorage.values);
  assert.equal(readCompletedGentlingTouchReceipt(
    getState(), "ambiguous-receipt-id",
  ).conflict, true);
  assert.equal(commitCompletedGentlingTouch(
    getSessionContext(), ambiguousRequest, "ambiguous-receipt-id",
  ).status, "rejected");
  assert.deepEqual(getState(), ambiguousState);
  assert.equal(getSessionContext().stateRevision, ambiguousRevision);
  assert.deepEqual(window.localStorage.values, ambiguousStorage);
});

test("D49: stale owner after a real session-generation change is rejected", () => {
  prepare();
  const request = requestFor();
  const oldContext = getSessionContext();
  const before = structuredClone(getState());
  const storage = new Map(window.localStorage.values);
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  assert.notEqual(getSessionContext().sessionGeneration, oldContext.sessionGeneration);
  const afterOpen = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  const result = commitCompletedGentlingTouch(oldContext, request, "old-generation-operation");
  assert.equal(result.status, "rejected");
  assert.deepEqual(getState(), afterOpen);
  assert.equal(getSessionContext().stateRevision, revision);
  assert.notDeepEqual(before, afterOpen);
  assert.deepEqual(window.localStorage.values, storage);
});

test("D50-D51: closed and abandoned sequences and expected-exists mismatches reject", () => {
  for (const status of ["closed", "abandoned"]) {
    prepare();
    const sequenceId = `non-open-${status}`;
    updateState((draft) => {
      draft.monk.combatAssistant.activeSequences.push({
        id: sequenceId, kind: "attack-action", status, maximumAttacks: 2,
        turnMarker: draft.ui.turn.turnNumber, battleId: null, ownTurnId: null,
        resolvedAttacks: [], replacementResults: [], actionFlagApplied: true,
      });
      return draft;
    });
    const request = requestFor({
      sequenceId, expectedSequenceExists: true, expectedUsedSlots: 0,
    });
    assert.equal(previewCompletedGentlingTouch(getState(), request).ok, false, status);
  }
  prepare();
  const expectedExistingButAbsent = requestFor({
    sequenceId: "absent-sequence", expectedSequenceExists: true,
  });
  assert.equal(previewCompletedGentlingTouch(getState(), expectedExistingButAbsent).ok, false);
  const expectedAbsentButExisting = requestFor();
  const id = expectedAbsentButExisting.sequenceId;
  updateState((draft) => {
    draft.monk.combatAssistant.activeSequences.push({
      id, kind: "attack-action", status: "open", maximumAttacks: 2,
      turnMarker: draft.ui.turn.turnNumber, battleId: null, ownTurnId: null,
      resolvedAttacks: [], replacementResults: [], actionFlagApplied: true,
    });
    return draft;
  });
  assert.equal(previewCompletedGentlingTouch(getState(), expectedAbsentButExisting).ok, false);
});

test("D52: an open bonus sequence may coexist, but an incompatible parent blocks creation", () => {
  prepare();
  updateState((draft) => {
    draft.monk.combatAssistant.activeSequences.push({
      id: "coexisting-bonus", kind: "bonus-unarmed", status: "open",
      maximumAttacks: 1, turnMarker: draft.ui.turn.turnNumber,
      battleId: null, ownTurnId: null, resolvedAttacks: [],
      replacementResults: [], actionFlagApplied: true,
    });
    return draft;
  });
  assert.equal(applyGentling(requestFor(), "gentling-with-bonus").status, "applied");
  assert.equal(getState().monk.combatAssistant.activeSequences.length, 2);

  prepare();
  updateState((draft) => {
    draft.monk.combatAssistant.activeSequences.push({
      id: "incompatible-parent", kind: "reaction-unarmed", status: "open",
      maximumAttacks: 2, turnMarker: draft.ui.turn.turnNumber,
      battleId: null, ownTurnId: null, resolvedAttacks: [],
      replacementResults: [], actionFlagApplied: true,
    });
    return draft;
  });
  assert.equal(previewCompletedGentlingTouch(getState(), requestFor()).ok, false);
});

test("D21-D25: legacy empty sequence is reused; wrong, full and absent-sequence contexts reject", () => {
  prepare();
  assert.equal(startAttackSequence(getSessionContext(), {
    kind: "attack-action", sequenceId: "legacy-empty",
  }, "legacy-empty-start").status, "applied");
  const legacy = getState().monk.combatAssistant.activeSequences[0];
  const request = requestFor({
    sequenceId: legacy.id, expectedSequenceExists: true, expectedUsedSlots: 0,
  });
  assert.equal(applyGentling(request, "legacy-empty-gentling").status, "applied");
  assert.equal(getState().monk.combatAssistant.activeSequences.length, 1);
  assert.equal(getState().monk.combatAssistant.activeSequences[0].actionFlagApplied, true);
  for (const kind of ["flurry", "bonus-unarmed", "reaction-unarmed"]) {
    prepare();
    const sequenceId = `${kind}-sequence`;
    updateState((draft) => {
      draft.monk.combatAssistant.activeSequences.push({
        id: sequenceId, kind, status: "open", maximumAttacks: 2,
        turnMarker: draft.ui.turn.turnNumber, battleId: null, ownTurnId: null,
        resolvedAttacks: [], replacementResults: [], actionFlagApplied: true,
      });
      return draft;
    });
    assert.equal(previewCompletedGentlingTouch(getState(), requestFor({
      sequenceId, expectedSequenceExists: true,
    })).ok, false);
  }
  prepare({ level: 2 });
  const fullSequenceId = "full-gentling-sequence";
  updateState((draft) => {
    draft.monk.combatAssistant.activeSequences.push({
      id: fullSequenceId, kind: "attack-action", status: "complete",
      maximumAttacks: 1, turnMarker: draft.ui.turn.turnNumber,
      battleId: null, ownTurnId: null, resolvedAttacks: [{}],
      replacementResults: [], actionFlagApplied: true,
    });
    return draft;
  });
  assert.equal(previewCompletedGentlingTouch(getState(), requestFor({
    sequenceId: fullSequenceId, expectedSequenceExists: true, expectedUsedSlots: 1,
  })).ok, false);
});

test("Stale turn, battle, mechanics and unpaid-action changes reject without slot relocation", () => {
  for (const change of [
    (draft) => { draft.ui.turn.turnNumber += 1; },
    (draft) => { draft.battleConsole.current = { id: "battle", phase: "own-turn", ownTurnId: "turn" }; },
    (draft) => { draft.battleConsole.current = { id: "battle", phase: "waiting", ownTurnId: null }; },
    (draft) => { draft.abilities.wisdom += 2; },
    (draft) => { draft.profile.level = 17; },
  ]) {
    prepare();
    const request = requestFor();
    updateState((draft) => { change(draft); return draft; });
    assert.equal(previewCompletedGentlingTouch(getState(), request).ok, false);
  }
  prepare();
  updateState((draft) => { draft.ui.turn.actionUsed = true; return draft; });
  const actionUsedRequest = requestFor({ confirmSeparateAction: false });
  assertRejectedUnchanged(actionUsedRequest, "action-confirmation-required");
  assert.equal(applyGentling({ ...actionUsedRequest, confirmSeparateAction: true },
    "explicit-separate-action").status, "applied");

  prepare();
  const first = requestFor();
  const second = requestFor({ sequenceId: "different-gentling-id" });
  assert.equal(applyGentling(first, "first-concurrent-gentling").status, "applied");
  assertRejectedUnchanged(second, "stale-concurrent-gentling");

  prepare();
  const existingId = "unpaid-sequence";
  assert.equal(startAttackSequence(getSessionContext(), {
    kind: "attack-action", sequenceId: existingId,
  }, "unpaid-sequence-start").status, "applied");
  updateState((draft) => { draft.ui.turn.actionUsed = true; return draft; });
  const unpaid = requestFor({
    sequenceId: existingId, expectedSequenceExists: true,
  });
  assertRejectedUnchanged(unpaid, "unpaid-action-guard");
});

test("Battle ID, phase, own turn and turn marker mismatches are independently rejected", () => {
  for (const mismatch of ["battleId", "phase", "ownTurnId", "turnMarker"]) {
    prepare();
    const baseline = {
      id: "gentling-context-battle",
      phase: "own-turn",
      ownTurnId: "gentling-own-turn-A",
    };
    updateState((draft) => {
      draft.battleConsole.current = { ...baseline };
      return draft;
    });
    const request = requestFor();
    updateState((draft) => {
      if (mismatch === "battleId") draft.battleConsole.current.id += "-changed";
      if (mismatch === "phase") draft.battleConsole.current.phase = "paused";
      if (mismatch === "ownTurnId") draft.battleConsole.current.ownTurnId += "-changed";
      if (mismatch === "turnMarker") draft.ui.turn.turnNumber += 1;
      return draft;
    });
    const result = previewCompletedGentlingTouch(getState(), request);
    assert.equal(result.ok, false, mismatch);
    assert.equal(result.code, "stale-context", mismatch);
  }
});

test("Level 6 to 17 martial-mechanics change requires a fresh draft basis", () => {
  prepare();
  const request = requestFor();
  updateState((draft) => { draft.profile.level = 17; return draft; });
  const result = previewCompletedGentlingTouch(getState(), request);
  assert.equal(result.ok, false);
  assert.equal(result.code, "revalidation-required");
});

test("Open draft rejects the stale level-4-to-5 Attack-capacity basis without mutation", () => {
  prepare({ level: 4 });
  assert.equal(getSaraAttackCount(getState()), 1);
  const request = requestFor({ sum: 20 });
  assert.equal(getState().monk.combatAssistant.activeSequences
    .some((sequence) => sequence.id === request.sequenceId), false);
  assert.equal(request.expectedMechanicsBasis, buildGentlingMechanicsBasis(getState(), null));

  updateState((draft) => {
    draft.profile.level = 5;
    draft.combat.hitDice.remaining = Math.min(draft.combat.hitDice.remaining, 5);
    return draft;
  });
  assert.equal(getSaraAttackCount(getState()), 2);
  const stalePreview = previewCompletedGentlingTouch(getState(), request);
  assert.equal(stalePreview.ok, false);
  assert.equal(stalePreview.code, "revalidation-required");

  const state = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  const storage = new Map(window.localStorage.values);
  const staleCommit = commitCompletedGentlingTouch(
    getSessionContext(), request, "stale-level-capacity-request",
  );
  assert.equal(staleCommit.status, "rejected");
  assert.match(staleCommit.reason, /Параметры Gentling Touch изменились/);
  assert.deepEqual(getState(), state);
  assert.equal(getSessionContext().stateRevision, revision);
  assert.deepEqual(window.localStorage.values, storage);

  const currentRequest = requestFor({ sum: 20 });
  assert.equal(currentRequest.expectedMechanicsBasis, buildGentlingMechanicsBasis(getState(), null));
  const currentPreview = previewCompletedGentlingTouch(getState(), currentRequest);
  assert.equal(currentPreview.ok, true, currentPreview.reason);
  assert.equal(currentPreview.stage, "complete");
});

test("D45: Gentling preserves unrelated resources and action flags", () => {
  prepare();
  updateState((draft) => {
    draft.ui.turn.bonusActionUsed = true;
    draft.ui.turn.reactionUsed = true;
    draft.inventory.items.find((entry) => entry.id === "darts").quantity = 9;
    draft.monk.combatAssistant.pendingApplications.push({ id: "unrelated-pending" });
    return draft;
  });
  const before = structuredClone(getState());
  assert.equal(applyGentling(requestFor(), "gentling-preservation").status, "applied");
  const after = getState();
  assert.equal(after.ui.turn.bonusActionUsed, before.ui.turn.bonusActionUsed);
  assert.equal(after.ui.turn.reactionUsed, before.ui.turn.reactionUsed);
  assert.equal(after.inventory.items.find((entry) => entry.id === "darts").quantity, 9);
  assert.deepEqual(after.monk.combatAssistant.pendingApplications,
    before.monk.combatAssistant.pendingApplications);
});
