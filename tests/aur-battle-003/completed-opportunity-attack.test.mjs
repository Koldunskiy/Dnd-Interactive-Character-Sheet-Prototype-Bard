import test from "node:test";
import assert from "node:assert/strict";
import {
  getState,
  getSessionContext,
  openCharacterSession,
  updateState,
} from "../../scripts/state.js";
import {
  buildGentlingMechanicsBasis,
  commitCompletedNormalAttack,
  buildSeekingParentBasis,
  closeAttackSequence,
  commitCompletedGentlingTouch,
  commitCompletedSeekingStrike,
  commitCompletedOpportunityAttack,
  commitIncomingReply,
  previewCompletedOpportunityAttack,
  previewCompletedGentlingTouch,
  readCompletedOpportunityAttackReceipt,
  recordAttackOutcome,
  startAttackSequence,
} from "../../scripts/actions/sara-combat.js";
import { commitIncomingEvent } from "../../scripts/actions/incoming-event.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import { readSeekingHistory } from "../../scripts/combat/seeking-history.js";

const request = (overrides = {}) => ({
  sequenceId: "opportunity-sequence",
  attackId: "opportunity-attack",
  battleId: null,
  phaseAtOpen: "waiting",
  ownTurnId: null,
  turnMarker: 1,
  expectedUsedSlots: 0,
  parentFeature: "opportunity-attack",
  attack: {
    profileId: "unarmed",
    rollMode: "normal",
    firstD20: "10",
    secondD20: "",
    targetArmorClass: "",
    dmHitResult: "hit",
    targetLabel: "",
    dmExceptionConfirmed: false,
  },
  damageRolls: ["3"],
  ...overrides,
});

test("completed opportunity miss atomically records one sequence and spends reaction", () => {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const before = getSessionContext().stateRevision;
  const miss = request({ attack: { ...request().attack, dmHitResult: "miss" }, damageRolls: ["invalid"] });
  assert.equal(previewCompletedOpportunityAttack(getState(), miss).stage, "complete");
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(), miss, "opportunity-miss-op").status, "applied");
  assert.equal(getSessionContext().stateRevision, before + 1);
  const state = getState();
  const sequence = state.monk.combatAssistant.activeSequences.find((entry) => entry.id === miss.sequenceId);
  assert.equal(sequence.kind, "reaction-unarmed");
  assert.equal(sequence.parentFeature, "opportunity-attack");
  assert.equal(sequence.maximumAttacks, 1);
  assert.equal(sequence.status, "complete");
  assert.equal(sequence.resolvedAttacks.length, 1);
  assert.equal(sequence.resolvedAttacks[0].hitResult, "miss");
  assert.equal(sequence.resolvedAttacks[0].damageStatus, "not-applicable");
  assert.equal(state.ui.turn.reactionUsed, true);
});

test("completed opportunity hit requires physical damage and replays canonical evidence", () => {
  const storage = installOpportunityCollisionStorage();
  try {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const req = request();
  const before = structuredClone(getState());
  const revisionBeforeReject = getSessionContext().stateRevision;
  const storageBeforeReject = new Map(storage.values);
  const incomplete = commitCompletedOpportunityAttack(getSessionContext(),
    { ...req, damageRolls: [] }, "opportunity-hit-op");
  assert.equal(incomplete.status, "rejected");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revisionBeforeReject);
  assert.deepEqual(storage.values, storageBeforeReject);
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(), req, "opportunity-hit-op").status, "applied");
  const stateBeforeReplay = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  const storageBeforeReplay = new Map(storage.values);
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(), req, "opportunity-hit-op").status, "replayed");
  assert.deepEqual(getState(), stateBeforeReplay);
  assert.equal(getSessionContext().stateRevision, revision);
  assert.deepEqual(storage.values, storageBeforeReplay);
  assert.equal(readCompletedOpportunityAttackReceipt(getState(), "opportunity-hit-op").outcome, "hit");
  assert.equal(getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0].damageStatus, "recorded");
  } finally {
    storage.restore();
  }
});

test("canonical replay survives session reload and mismatched requests collide", () => {
  const storage = installOpportunityCollisionStorage();
  try {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const req = request();
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(), req, "durable-opportunity-op").status, "applied");
  const saved = structuredClone(getState());
  openCharacterSession("sara-velaris", () => ({ status: "loaded", state: saved }));
  const before = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  const map = new Map(storage.values);
  assert.equal(getState().ui.turn.reactionUsed, true);
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(), req, "durable-opportunity-op").status, "replayed");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);
  assert.deepEqual(storage.values, map);
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(),
    { ...req, attack: { ...req.attack, targetLabel: "Другой противник" } },
    "durable-opportunity-op").reason, "operation-collision");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);
  assert.deepEqual(storage.values, map);
  } finally {
    storage.restore();
  }
});

test("opportunity rejects a retained normal-attack operation ID after canonical reload", () => {
  const storage = installOpportunityCollisionStorage();
  try {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const normal = {
    sequenceId: "retained-normal-sequence",
    attackId: "retained-normal-attack",
    battleId: null,
    ownTurnId: null,
    turnMarker: 1,
    expectedUsedSlots: 0,
    attack: {
      profileId: "unarmed",
      rollMode: "normal",
      firstD20: "10",
      secondD20: "",
      targetArmorClass: "",
      dmHitResult: "miss",
      targetLabel: "",
    },
    damageRolls: [],
  };
  assert.equal(commitCompletedNormalAttack(
    getSessionContext(), normal, "shared-retained-operation",
  ).status, "applied");
  const persisted = structuredClone(getState());
  openCharacterSession("sara-velaris", () => ({ status: "loaded", state: persisted }));
  const before = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  const storageBeforeCollision = new Map(storage.values);
  const collision = commitCompletedOpportunityAttack(
    getSessionContext(),
    request({
      sequenceId: "fresh-opportunity-sequence",
      attackId: "fresh-opportunity-attack",
    }),
    "shared-retained-operation",
  );
  assert.equal(collision.status, "rejected");
  assert.equal(collision.reason, "operation-collision");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);
  assert.deepEqual(storage.values, storageBeforeCollision);
  } finally {
    storage.restore();
  }
});

function installOpportunityCollisionStorage() {
  const values = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };
  return { values, restore: () => { globalThis.window = previousWindow; } };
}

function makeRetainedKindRecord(kind, operationId) {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  updateState((state) => {
    state.profile.level = 6;
    state.monk.ordinaryTechniqueIds[0] = kind === "gentling"
      ? "ll-monk:gentling-touch" : "ll-monk:seeking-strike";
    if (kind === "incomingReply") {
      state.battleConsole.current = {
        id: "retained-reply-battle", phase: "waiting", ownTurnId: null,
      };
    }
    return state;
  });
  if (kind === "incomingReply") {
    const identity = {
      battleId: "retained-reply-battle",
      phaseAtOpen: "waiting",
      ownTurnIdAtOpen: null,
      eventId: "retained-reply-event",
    };
    assert.equal(commitIncomingEvent(getSessionContext(), {
      kind: "deflection", source: "melee", damage: "0", deflectRoll: "1",
      ...identity,
    }, "retained-reply-parent").status, "applied");
    const request = {
      ...identity, replyKind: "deflect-counter",
      parentOperationId: "retained-reply-parent", continuationId: null,
      trigger: null,
      attack: {
        rollMode: "normal", firstD20: "10", secondD20: null,
        targetArmorClass: null, dmHitResult: "miss", targetLabel: "",
      },
      damageRolls: [],
    };
    assert.equal(commitIncomingReply(getSessionContext(), request, operationId).status, "applied");
  } else if (kind === "seeking") {
    assert.equal(startAttackSequence(getSessionContext(), {
      kind: "attack-action", sequenceId: "retained-seeking-sequence",
    }, "retained-seeking-start").status, "applied");
    assert.equal(recordAttackOutcome(getSessionContext(), "retained-seeking-sequence",
      "retained-seeking-parent-attack", {
        kind: "attack-action", profileId: "unarmed", rollMode: "normal",
        firstD20: "2", secondD20: "", targetArmorClass: "30",
      }, "retained-seeking-parent-op").status, "applied");
    const sequence = getState().monk.combatAssistant.activeSequences[0];
    const attack = sequence.resolvedAttacks[0];
    const history = readSeekingHistory(attack, {
      actionId: sequence.id, attackId: attack.id,
    });
    const seeking = {
      actionId: sequence.id, attackId: attack.id, invocationId: operationId,
      battleId: null, phaseAtOpen: "waiting", ownTurnId: null, turnMarker: 1,
      expectedParentBasis: buildSeekingParentBasis(sequence, attack, history),
      replacement: {
        rollMode: "normal", firstD20: "10", secondD20: "",
        targetArmorClass: "30", dmHitResult: null, dmExceptionConfirmed: false,
      },
      damageRolls: [],
    };
    assert.equal(commitCompletedSeekingStrike(
      getSessionContext(), seeking, operationId,
    ).status, "applied");
    assert.equal(closeAttackSequence(
      getSessionContext(), sequence.id, "retained-seeking-close",
    ).status, "applied");
  } else {
    const state = getState();
    const request = {
      sequenceId: "retained-gentling-sequence", sequenceKind: "attack-action",
      battleId: null, phaseAtOpen: "waiting", ownTurnId: null,
      turnMarker: Number(state.ui.turn.turnNumber), expectedSequenceExists: false,
      expectedUsedSlots: 0,
      expectedMechanicsBasis: buildGentlingMechanicsBasis(state, null),
      confirmSeparateAction: false, extraKi: 0, targetHp: 10, sum: 20,
    };
    const preview = previewCompletedGentlingTouch(state, request);
    assert.equal(preview.ok, true, preview.reason);
    assert.equal(commitCompletedGentlingTouch(
      getSessionContext(), preview.request, operationId,
    ).status, "applied");
    assert.equal(closeAttackSequence(
      getSessionContext(), request.sequenceId, "retained-gentling-close",
    ).status, "applied");
  }
  updateState((state) => {
    state.ui.turn.reactionUsed = false;
    return state;
  });
}

test("opportunity rejects canonical incoming reply, Seeking, and Gentling IDs after reload", () => {
  const storage = installOpportunityCollisionStorage();
  try {
    for (const kind of ["incomingReply", "seeking", "gentling"]) {
      const operationId = `retained-${kind}-operation`;
      makeRetainedKindRecord(kind, operationId);
      const canonical = structuredClone(getState());
      openCharacterSession("sara-velaris", () => ({
        status: "loaded", state: canonical,
      }));
      const baselineRequest = request({
        sequenceId: `free-${kind}-sequence`, attackId: `free-${kind}-attack`,
        battleId: getState().battleConsole.current?.id ?? null,
        phaseAtOpen: getState().battleConsole.current?.phase ?? "waiting",
        ownTurnId: getState().battleConsole.current?.phase === "own-turn"
          ? getState().battleConsole.current.ownTurnId : null,
        turnMarker: Number(getState().ui.turn.turnNumber),
        attack: { ...request().attack, dmHitResult: "miss" }, damageRolls: [],
      });
      const eligible = previewCompletedOpportunityAttack(getState(), baselineRequest);
      assert.equal(eligible.stage, "complete", `${kind}: ${eligible.reason}`);
      assert.equal(commitCompletedOpportunityAttack(
        getSessionContext(), baselineRequest, `free-control-${kind}`,
      ).status, "applied");
      openCharacterSession("sara-velaris", () => ({
        status: "loaded", state: canonical,
      }));
      const before = structuredClone(getState());
      const revision = getSessionContext().stateRevision;
      const saved = new Map(storage.values);
      const collision = commitCompletedOpportunityAttack(
        getSessionContext(), baselineRequest, operationId,
      );
      assert.equal(collision.status, "rejected", `${kind}: ${collision.reason}`);
      assert.equal(collision.reason, "operation-collision");
      assert.deepEqual(getState(), before);
      assert.equal(getSessionContext().stateRevision, revision);
      assert.deepEqual(storage.values, saved);
    }
  } finally {
    storage.restore();
  }
});

test("matching malformed operation evidence blocks opportunity, unrelated malformed evidence does not", () => {
  const saved = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
      removeItem: (key) => saved.delete(key),
    },
  };
  try {
    openCharacterSession("sara-velaris", () => ({ status: "missing" }));
    updateState((state) => {
      state.monk.combatAssistant.activeSequences.push({
        id: "malformed-matching-evidence",
        kind: "attack-action",
        status: "complete",
        resolvedAttacks: [],
        replacementResults: [{
          id: "matching-malformed-operation",
          operationId: "matching-malformed-operation",
        }],
      });
      return state;
    });
    const requestWith = (operationId) => request({
      sequenceId: `request-${operationId}`, attackId: `attack-${operationId}`,
      attack: { ...request().attack, dmHitResult: "miss" }, damageRolls: [],
    });
    const malformedBefore = structuredClone(getState());
    const malformedRevision = getSessionContext().stateRevision;
    const malformedStorage = new Map(saved);
    const matching = commitCompletedOpportunityAttack(
      getSessionContext(), requestWith("matching-malformed-operation"),
      "matching-malformed-operation",
    );
    assert.equal(matching.status, "rejected");
    assert.equal(matching.reason, "operation-collision");
    assert.deepEqual(getState(), malformedBefore);
    assert.equal(getSessionContext().stateRevision, malformedRevision);
    assert.deepEqual(saved, malformedStorage);

    updateState((state) => {
      state.monk.combatAssistant.activeSequences.push({
        id: "unrelated-malformed-evidence",
        kind: "attack-action",
        status: "complete",
        resolvedAttacks: [],
        replacementResults: { operationId: "different-retained-operation" },
      });
      return state;
    });
    const unrelatedBefore = structuredClone(getState());
    const unrelatedRevision = getSessionContext().stateRevision;
    const unrelatedStorage = new Map(saved);
    const allowed = commitCompletedOpportunityAttack(
      getSessionContext(), requestWith("otherwise-free-operation"),
      "otherwise-free-operation",
    );
    assert.equal(allowed.status, "applied");
    assert.equal(getSessionContext().stateRevision, unrelatedRevision + 1);
    assert.notDeepEqual(getState(), unrelatedBefore);
    assert.notDeepEqual(saved, unrelatedStorage);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("opportunity rejects battle, phase, ownTurnId, turn-marker, and owner-generation staleness independently", () => {
  const storage = installOpportunityCollisionStorage();
  try {
  for (const staleField of ["battleId", "phase", "ownTurnId", "turnMarker"]) {
    openCharacterSession("sara-velaris", () => ({ status: "missing" }));
    updateState((state) => {
      state.battleConsole.current = {
        id: "opportunity-stale-battle",
        phase: "own-turn",
        ownTurnId: "opportunity-stale-turn",
      };
      return state;
    });
    const oldRequest = request({
      battleId: "opportunity-stale-battle",
      phaseAtOpen: "own-turn",
      ownTurnId: "opportunity-stale-turn",
      turnMarker: Number(getState().ui.turn.turnNumber),
      attack: { ...request().attack, dmHitResult: "miss" },
      damageRolls: [],
    });
    updateState((state) => {
      if (staleField === "battleId") state.battleConsole.current.id += "-changed";
      if (staleField === "phase") state.battleConsole.current.phase = "waiting";
      if (staleField === "ownTurnId") state.battleConsole.current.ownTurnId += "-changed";
      if (staleField === "turnMarker") state.ui.turn.turnNumber += 1;
      return state;
    });
    const before = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const saved = new Map(storage.values);
    const rejected = commitCompletedOpportunityAttack(
      getSessionContext(), oldRequest, `stale-${staleField}`,
    );
    assert.equal(rejected.status, "rejected", staleField);
    assert.notEqual(rejected.reason, "operation-collision");
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.deepEqual(storage.values, saved);
  }

  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const staleContext = getSessionContext();
  const staleRequest = request({
    attack: { ...request().attack, dmHitResult: "miss" }, damageRolls: [],
  });
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const newOwnerState = structuredClone(getState());
  const newOwnerRevision = getSessionContext().stateRevision;
  const newOwnerStorage = new Map(storage.values);
  const staleOwner = commitCompletedOpportunityAttack(
    staleContext, staleRequest, "stale-opportunity-owner",
  );
  assert.equal(staleOwner.status, "rejected");
  assert.equal(staleOwner.reason, "stale-session");
  assert.deepEqual(getState(), newOwnerState);
  assert.equal(getSessionContext().stateRevision, newOwnerRevision);
  assert.deepEqual(storage.values, newOwnerStorage);
  } finally {
    storage.restore();
  }
});

test("opportunity rejects invalid physical damage, natural-rule exceptions, and occupied IDs", () => {
  const storage = installOpportunityCollisionStorage();
  try {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const before = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  const storageBefore = new Map(storage.values);
  for (const raw of ["", "0", "99"]) {
    const invalid = commitCompletedOpportunityAttack(getSessionContext(),
      request({ damageRolls: [raw] }), `invalid-damage-${raw}`);
    assert.equal(invalid.status, "rejected");
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.deepEqual(storage.values, storageBefore);
  }
  const naturalContradiction = commitCompletedOpportunityAttack(getSessionContext(),
    request({ attack: { ...request().attack, firstD20: "1", dmHitResult: "hit" } }),
    "natural-contradiction-op");
  assert.equal(naturalContradiction.status, "rejected");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);
  assert.deepEqual(storage.values, storageBefore);

  const validMiss = request({
    attackId: "occupied-attack",
    attack: { ...request().attack, firstD20: "1", dmHitResult: null },
    damageRolls: [],
  });
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(), validMiss, "occupied-attack-op").status, "applied");
  const after = structuredClone(getState());
  const afterRevision = getSessionContext().stateRevision;
  const storageAfter = new Map(storage.values);
  const occupiedAttack = commitCompletedOpportunityAttack(getSessionContext(),
    { ...request(), sequenceId: "another-sequence", attackId: "occupied-attack" },
    "occupied-attack-collision");
  assert.equal(occupiedAttack.status, "rejected");
  assert.deepEqual(getState(), after);
  assert.equal(getSessionContext().stateRevision, afterRevision);
  assert.deepEqual(storage.values, storageAfter);
  } finally {
    storage.restore();
  }
});

test("free reaction cannot be claimed twice and occupied sequence/attack IDs reject independently", () => {
  const storage = installOpportunityCollisionStorage();
  try {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const first = request({
    sequenceId: "first-reaction-sequence",
    attackId: "first-reaction-attack",
    attack: { ...request().attack, dmHitResult: "miss" },
    damageRolls: [],
  });
  assert.equal(commitCompletedOpportunityAttack(
    getSessionContext(), first, "first-reaction-operation",
  ).status, "applied");
  const afterFirst = structuredClone(getState());
  const revisionAfterFirst = getSessionContext().stateRevision;
  const storageAfterFirst = new Map(storage.values);
  const second = commitCompletedOpportunityAttack(
    getSessionContext(),
    request({
      sequenceId: "second-reaction-sequence",
      attackId: "second-reaction-attack",
      attack: { ...request().attack, dmHitResult: "miss" },
      damageRolls: [],
    }),
    "second-reaction-operation",
  );
  assert.equal(second.status, "rejected");
  assert.deepEqual(getState(), afterFirst);
  assert.equal(getSessionContext().stateRevision, revisionAfterFirst);
  assert.deepEqual(storage.values, storageAfterFirst);

  for (const [sequenceId, attackId] of [
    ["occupied-sequence", "free-attack"],
    ["free-sequence", "occupied-attack"],
  ]) {
    openCharacterSession("sara-velaris", () => ({ status: "missing" }));
    updateState((draft) => {
      draft.monk.combatAssistant.activeSequences.push({
        id: "occupied-sequence",
        kind: "reaction-unarmed",
        status: "complete",
        maximumAttacks: 1,
        resolvedAttacks: [{ id: "occupied-attack" }],
      });
    });
    const beforeCollision = structuredClone(getState());
    const collisionRevision = getSessionContext().stateRevision;
    const storageBeforeCollision = new Map(storage.values);
    const collision = commitCompletedOpportunityAttack(
      getSessionContext(),
      request({
        sequenceId,
        attackId,
        attack: { ...request().attack, dmHitResult: "miss" },
        damageRolls: [],
      }),
      `free-reaction-${sequenceId}-${attackId}`,
    );
    assert.equal(collision.status, "rejected");
    assert.equal(getState().ui.turn.reactionUsed, false);
    assert.deepEqual(getState(), beforeCollision);
    assert.equal(getSessionContext().stateRevision, collisionRevision);
    assert.deepEqual(storage.values, storageBeforeCollision);
  }
  } finally {
    storage.restore();
  }
});

test("opportunity accepts all physical roll modes but rejects every non-unarmed profile", () => {
  const storage = installOpportunityCollisionStorage();
  try {
  for (const [mode, firstD20, secondD20] of [
    ["normal", "10", ""],
    ["advantage", "8", "17"],
    ["disadvantage", "17", "8"],
  ]) {
    openCharacterSession("sara-velaris", () => ({ status: "missing" }));
    const req = request({
      attack: {
        ...request().attack,
        rollMode: mode,
        firstD20,
        secondD20,
        targetArmorClass: "10",
        dmHitResult: null,
      },
    });
    assert.equal(previewCompletedOpportunityAttack(getState(), req).stage, "complete");
    assert.equal(commitCompletedOpportunityAttack(
      getSessionContext(), req, `opportunity-${mode}-op`,
    ).status, "applied");
    const recorded = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
    assert.equal(recorded.rollMode, mode);
    assert.deepEqual(recorded.rawD20Rolls, mode === "normal"
      ? [10] : [Number(firstD20), Number(secondD20)]);
  }
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const before = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  const storageBefore = new Map(storage.values);
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(),
    request({ attack: { ...request().attack, profileId: "quarterstaff" } }),
    "opportunity-weapon-rejected").status, "rejected");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);
  assert.deepEqual(storage.values, storageBefore);
  } finally {
    storage.restore();
  }
});

test("opportunity applies in waiting, own-turn, and out-of-battle contexts but rejects paused", () => {
  const storage = installOpportunityCollisionStorage();
  try {
  for (const [phase, ownTurnId] of [["waiting", null], ["own-turn", "own-turn-id"]]) {
    openCharacterSession("sara-velaris", () => ({ status: "missing" }));
    updateState((draft) => {
      draft.battleConsole.current = { id: "opportunity-context-battle", phase, ownTurnId };
      return draft;
    });
    const req = request({
      battleId: "opportunity-context-battle",
      phaseAtOpen: phase,
      ownTurnId,
    });
    assert.equal(commitCompletedOpportunityAttack(
      getSessionContext(), req, `opportunity-context-${phase}`,
    ).status, "applied");
  }
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const outsideRevision = getSessionContext().stateRevision;
  assert.equal(commitCompletedOpportunityAttack(
    getSessionContext(), request(), "opportunity-outside-battle",
  ).status, "applied");
  assert.equal(getSessionContext().stateRevision, outsideRevision + 1);

  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  updateState((draft) => {
    draft.battleConsole.current = {
      id: "opportunity-paused-battle",
      phase: "paused",
      ownTurnId: null,
    };
    return draft;
  });
  const before = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  const storageBefore = new Map(storage.values);
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(),
    request({ battleId: "opportunity-paused-battle", phaseAtOpen: "waiting" }),
    "opportunity-paused").status, "rejected");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);
  assert.deepEqual(storage.values, storageBefore);
  } finally {
    storage.restore();
  }
});

function createSeekingOpportunityMiss() {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  updateState((draft) => {
    draft.profile.level = 6;
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    draft.battleConsole.current = {
      id: "opportunity-seeking-battle",
      phase: "waiting",
      ownTurnId: null,
    };
    return draft;
  });
  const opportunity = request({
    sequenceId: "seeking-opportunity-sequence",
    attackId: "seeking-opportunity-attack",
    battleId: "opportunity-seeking-battle",
    phaseAtOpen: "waiting",
    ownTurnId: null,
    attack: {
      ...request().attack,
      firstD20: "2",
      targetArmorClass: "30",
      dmHitResult: null,
    },
    damageRolls: [],
  });
  assert.equal(commitCompletedOpportunityAttack(
    getSessionContext(), opportunity, "seeking-opportunity-miss-op",
  ).status, "applied");
  return opportunity;
}

function resolveOpportunitySeeking(outcome, operationId) {
  const sequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === "seeking-opportunity-sequence");
  const attack = sequence.resolvedAttacks[0];
  const history = readSeekingHistory(attack, {
    actionId: sequence.id,
    attackId: attack.id,
  });
  const request = {
    actionId: sequence.id,
    attackId: attack.id,
    invocationId: `${operationId}-invocation`,
    battleId: "opportunity-seeking-battle",
    phaseAtOpen: "waiting",
    ownTurnId: null,
    turnMarker: Number(getState().ui.turn.turnNumber),
    expectedParentBasis: buildSeekingParentBasis(sequence, attack, history),
    replacement: {
      rollMode: "normal",
      firstD20: "10",
      secondD20: "",
      targetArmorClass: outcome === "hit" ? "1" : "30",
      dmHitResult: null,
      dmExceptionConfirmed: false,
    },
    damageRolls: outcome === "hit" ? ["3"] : [],
  };
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), request, request.invocationId,
  ).status, "applied");
  return request;
}

test("opportunity miss receipt survives Seeking hit and miss, replay, and canonical reload", () => {
  for (const outcome of ["hit", "miss"]) {
    const saved = new Map();
    const previousWindow = globalThis.window;
    globalThis.window = {
      localStorage: {
        getItem: (key) => saved.get(key) ?? null,
        setItem: (key, value) => saved.set(key, value),
        removeItem: (key) => saved.delete(key),
      },
    };
    try {
      const opportunity = createSeekingOpportunityMiss();
      resolveOpportunitySeeking(outcome, `seeking-${outcome}`);
      const receipt = readCompletedOpportunityAttackReceipt(
        getState(), "seeking-opportunity-miss-op",
      );
      assert.equal(receipt.outcome, "miss", JSON.stringify({
        receipt,
        attack: getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0],
      }));
      const stateBeforeReplay = structuredClone(getState());
      const revisionBeforeReplay = getSessionContext().stateRevision;
      const storageBeforeReplay = new Map(saved);
      assert.equal(commitCompletedOpportunityAttack(
        getSessionContext(), opportunity, "seeking-opportunity-miss-op",
      ).status, "replayed");
      assert.deepEqual(getState(), stateBeforeReplay);
      assert.equal(getSessionContext().stateRevision, revisionBeforeReplay);
      assert.deepEqual(saved, storageBeforeReplay);
      const persisted = structuredClone(getState());
      openCharacterSession("sara-velaris", () => ({
        status: "loaded",
        state: persisted,
      }));
      const reloadState = structuredClone(getState());
      const reloadRevision = getSessionContext().stateRevision;
      const reloadStorage = new Map(saved);
      assert.equal(readCompletedOpportunityAttackReceipt(
        getState(), "seeking-opportunity-miss-op",
      ).outcome, "miss");
      assert.equal(commitCompletedOpportunityAttack(
        getSessionContext(), opportunity, "seeking-opportunity-miss-op",
      ).status, "replayed");
      assert.deepEqual(getState(), reloadState);
      assert.equal(getSessionContext().stateRevision, reloadRevision);
      assert.deepEqual(saved, reloadStorage);
      assert.equal(getState().combat.ki.current,
        persisted.combat.ki.current);
    } finally {
      globalThis.window = previousWindow;
    }
  }
});

test("opportunity miss receipt replays after successive Seeking misses and hit across reload", () => {
  const saved = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
      removeItem: (key) => saved.delete(key),
    },
  };
  try {
    const opportunity = createSeekingOpportunityMiss();
    resolveOpportunitySeeking("miss", "successive-seeking-1");
    resolveOpportunitySeeking("miss", "successive-seeking-2");
    resolveOpportunitySeeking("hit", "successive-seeking-3");
    const sequence = getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === opportunity.sequenceId);
    const attack = sequence.resolvedAttacks.find((entry) => entry.id === opportunity.attackId);
    assert.equal(attack.hitResult, "hit");
    assert.equal(attack.damageStatus, "recorded");
    assert.equal(readSeekingHistory(attack, {
      actionId: sequence.id, attackId: attack.id,
    }).length, 3);
    const beforeReplay = structuredClone(getState());
    const revisionBeforeReplay = getSessionContext().stateRevision;
    const storageBeforeReplay = new Map(saved);
    assert.equal(readCompletedOpportunityAttackReceipt(
      getState(), "seeking-opportunity-miss-op",
    ).outcome, "miss");
    assert.equal(commitCompletedOpportunityAttack(
      getSessionContext(), opportunity, "seeking-opportunity-miss-op",
    ).status, "replayed");
    assert.deepEqual(getState(), beforeReplay);
    assert.equal(getSessionContext().stateRevision, revisionBeforeReplay);
    assert.deepEqual(saved, storageBeforeReplay);

    const persisted = structuredClone(getState());
    openCharacterSession("sara-velaris", () => ({ status: "loaded", state: persisted }));
    const afterReload = structuredClone(getState());
    const revisionAfterReload = getSessionContext().stateRevision;
    const storageAfterReload = new Map(saved);
    assert.equal(readCompletedOpportunityAttackReceipt(
      getState(), "seeking-opportunity-miss-op",
    ).outcome, "miss");
    assert.equal(commitCompletedOpportunityAttack(
      getSessionContext(), opportunity, "seeking-opportunity-miss-op",
    ).status, "replayed");
    assert.deepEqual(getState(), afterReload);
    assert.equal(getSessionContext().stateRevision, revisionAfterReload);
    assert.deepEqual(saved, storageAfterReload);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("opportunity evidence rejects an effective result that disagrees with valid Seeking history", () => {
  const saved = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
      removeItem: (key) => saved.delete(key),
    },
  };
  try {
    const opportunity = createSeekingOpportunityMiss();
    resolveOpportunitySeeking("miss", "consistent-seeking-1");
    resolveOpportunitySeeking("hit", "consistent-seeking-2");
    const attack = structuredClone(
      getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0],
    );
    assert.deepEqual(attack.seekingAmendment, attack.seekingAmendments.at(-1));
    attack.chosenD20 += 1;
    updateState((state) => {
      state.monk.combatAssistant.activeSequences[0].resolvedAttacks[0] = attack;
      return state;
    });
    const corrupted = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const storageBefore = new Map(saved);
    assert.equal(readCompletedOpportunityAttackReceipt(
      getState(), "seeking-opportunity-miss-op",
    ).malformed, true);
    const result = commitCompletedOpportunityAttack(
      getSessionContext(), opportunity, "seeking-opportunity-miss-op",
    );
    assert.equal(result.status, "rejected");
    assert.deepEqual(getState(), corrupted);
    assert.equal(getSessionContext().stateRevision, revision);
    assert.deepEqual(saved, storageBefore);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("opportunity evidence rejects ambiguous matching Seeking history", () => {
  const storage = installOpportunityCollisionStorage();
  try {
  const opportunity = createSeekingOpportunityMiss();
  resolveOpportunitySeeking("miss", "ambiguous-seeking-1");
  const attack = structuredClone(
    getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0],
  );
  attack.seekingAmendments.push(structuredClone(attack.seekingAmendments[0]));
  updateState((state) => {
    state.monk.combatAssistant.activeSequences[0].resolvedAttacks[0] = attack;
    return state;
  });
  const before = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  const storageBefore = new Map(storage.values);
  const result = commitCompletedOpportunityAttack(
    getSessionContext(), opportunity, "seeking-opportunity-miss-op",
  );
  assert.equal(result.status, "rejected");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);
  assert.deepEqual(storage.values, storageBefore);
  } finally {
    storage.restore();
  }
});
