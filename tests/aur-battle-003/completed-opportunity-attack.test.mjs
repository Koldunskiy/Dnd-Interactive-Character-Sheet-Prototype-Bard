import test from "node:test";
import assert from "node:assert/strict";
import {
  getState,
  getSessionContext,
  openCharacterSession,
  updateState,
} from "../../scripts/state.js";
import {
  commitCompletedNormalAttack,
  buildSeekingParentBasis,
  commitCompletedSeekingStrike,
  commitCompletedOpportunityAttack,
  previewCompletedOpportunityAttack,
  readCompletedOpportunityAttackReceipt,
} from "../../scripts/actions/sara-combat.js";
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
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const req = request();
  const before = structuredClone(getState());
  const incomplete = commitCompletedOpportunityAttack(getSessionContext(),
    { ...req, damageRolls: [] }, "opportunity-hit-op");
  assert.equal(incomplete.status, "rejected");
  assert.deepEqual(getState(), before);
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(), req, "opportunity-hit-op").status, "applied");
  const revision = getSessionContext().stateRevision;
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(), req, "opportunity-hit-op").status, "replayed");
  assert.equal(getSessionContext().stateRevision, revision);
  assert.equal(readCompletedOpportunityAttackReceipt(getState(), "opportunity-hit-op").outcome, "hit");
  assert.equal(getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0].damageStatus, "recorded");
});

test("canonical replay survives session reload and mismatched requests collide", () => {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const req = request();
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(), req, "durable-opportunity-op").status, "applied");
  const saved = structuredClone(getState());
  openCharacterSession("sara-velaris", () => ({ status: "loaded", state: saved }));
  const revision = getSessionContext().stateRevision;
  assert.equal(getState().ui.turn.reactionUsed, true);
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(), req, "durable-opportunity-op").status, "replayed");
  assert.equal(getSessionContext().stateRevision, revision);
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(),
    { ...req, attack: { ...req.attack, targetLabel: "Другой противник" } },
    "durable-opportunity-op").reason, "operation-collision");
  assert.equal(getSessionContext().stateRevision, revision);
});

test("opportunity rejects a retained normal-attack operation ID after canonical reload", () => {
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
});

test("opportunity rejects invalid physical damage, natural-rule exceptions, and occupied IDs", () => {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const before = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  for (const raw of ["", "0", "99"]) {
    const invalid = commitCompletedOpportunityAttack(getSessionContext(),
      request({ damageRolls: [raw] }), `invalid-damage-${raw}`);
    assert.equal(invalid.status, "rejected");
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revision);
  }
  const naturalContradiction = commitCompletedOpportunityAttack(getSessionContext(),
    request({ attack: { ...request().attack, firstD20: "1", dmHitResult: "hit" } }),
    "natural-contradiction-op");
  assert.equal(naturalContradiction.status, "rejected");
  assert.deepEqual(getState(), before);

  const validMiss = request({
    attackId: "occupied-attack",
    attack: { ...request().attack, firstD20: "1", dmHitResult: null },
    damageRolls: [],
  });
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(), validMiss, "occupied-attack-op").status, "applied");
  const after = structuredClone(getState());
  const occupiedAttack = commitCompletedOpportunityAttack(getSessionContext(),
    { ...request(), sequenceId: "another-sequence", attackId: "occupied-attack" },
    "occupied-attack-collision");
  assert.equal(occupiedAttack.status, "rejected");
  assert.deepEqual(getState(), after);
});

test("free reaction cannot be claimed twice and occupied sequence/attack IDs reject independently", () => {
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
  }
});

test("opportunity accepts all physical roll modes but rejects every non-unarmed profile", () => {
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
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(),
    request({ attack: { ...request().attack, profileId: "quarterstaff" } }),
    "opportunity-weapon-rejected").status, "rejected");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);
});

test("opportunity applies in waiting, own-turn, and out-of-battle contexts but rejects paused", () => {
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
  assert.equal(commitCompletedOpportunityAttack(getSessionContext(),
    request({ battleId: "opportunity-paused-battle", phaseAtOpen: "waiting" }),
    "opportunity-paused").status, "rejected");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);
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
