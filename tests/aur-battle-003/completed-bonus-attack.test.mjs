import test from "node:test";
import assert from "node:assert/strict";
import {
  getSessionContext,
  getState,
  openCharacterSession,
  updateState,
} from "../../scripts/state.js";
import { getWorkspaceAttackFingerprint } from "../../scripts/workspace/attack-adapter.js";
import { beginOwnTurn, startBattle } from "../../scripts/battle/transitions.js";
import {
  commitCompletedNormalAttack,
  commitCompletedBonusAttack,
  previewCompletedBonusAttack,
  readCompletedBonusAttackReceipt,
  startAttackSequence,
} from "../../scripts/actions/sara-combat.js";

function request(kind = "flurry", overrides = {}) {
  return {
    sequenceId: `bonus-${kind}-sequence`,
    attackId: `bonus-${kind}-attack-1`,
    sequenceKind: kind,
    battleId: null,
    ownTurnId: null,
    turnMarker: Number(getState().ui?.turn?.turnNumber ?? 1),
    expectedUsedSlots: 0,
    start: {
      confirmed: kind === "flurry",
      triggerConfirmed: kind === "bonus-unarmed",
      parentId: "ordinary-bonus-command",
      parentFeature: null,
    },
    attack: {
      profileId: "unarmed",
      rollMode: "normal",
      firstD20: "10",
      secondD20: "",
      targetArmorClass: "",
      dmHitResult: "hit",
      targetLabel: "",
      confirmSeparateAction: false,
      dmExceptionConfirmed: false,
    },
    damageRolls: ["3"],
    ...overrides,
  };
}

function openSara() {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
}

test("first completed flurry hit pays once and records attack plus damage in one revision", () => {
  openSara();
  const req = request();
  const revision = getSessionContext().stateRevision;
  const ki = getState().combat.ki.current;
  const preview = previewCompletedBonusAttack(getState(), req);
  assert.equal(preview.ok, true);
  assert.equal(preview.stage, "complete");
  assert.equal(preview.request.sequenceKind, "flurry");
  assert.equal(getSessionContext().stateRevision, revision);
  const result = commitCompletedBonusAttack(getSessionContext(), req, "bonus-flurry-hit");
  assert.equal(result.status, "applied");
  assert.equal(getSessionContext().stateRevision, revision + 1);
  const sequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === req.sequenceId);
  assert.equal(sequence.kind, "flurry");
  assert.equal(sequence.resourcePaymentApplied, true);
  assert.equal(sequence.actionFlagApplied, true);
  assert.equal(sequence.resolvedAttacks.length, 1);
  assert.equal(sequence.resolvedAttacks[0].damageStatus, "recorded");
  assert.equal(getState().combat.ki.current, ki - 1);
  assert.equal(getState().ui.turn.bonusActionUsed, true);
  assert.equal(getState().ui.turn.actionUsed, false);
  assert.equal(readCompletedBonusAttackReceipt(getState(), "bonus-flurry-hit").outcome, "hit");
});

test("first flurry miss pays once and records damage as not applicable", () => {
  openSara();
  const req = request("flurry", {
    attackId: "bonus-flurry-miss",
    attack: {
      profileId: "unarmed", rollMode: "normal", firstD20: "1",
      secondD20: "", targetArmorClass: "", dmHitResult: null, targetLabel: "",
      confirmSeparateAction: false, dmExceptionConfirmed: false,
    },
    damageRolls: [],
  });
  const ki = getState().combat.ki.current;
  const result = commitCompletedBonusAttack(getSessionContext(), req, "bonus-flurry-miss-op");
  assert.equal(result.status, "applied");
  const sequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === req.sequenceId);
  assert.equal(sequence.resolvedAttacks[0].hitResult, "miss");
  assert.equal(sequence.resolvedAttacks[0].damageStatus, "not-applicable");
  assert.equal(getState().combat.ki.current, ki - 1);
  assert.equal(getState().ui.turn.bonusActionUsed, true);
});

test("bonus-unarmed commits without ki payment and a hit missing damage is mutation-free", () => {
  openSara();
  const revision = getSessionContext().stateRevision;
  const before = structuredClone(getState());
  const invalid = commitCompletedBonusAttack(
    getSessionContext(), request("bonus-unarmed", { damageRolls: [] }), "bonus-empty-hit",
  );
  assert.equal(invalid.status, "rejected");
  assert.equal(getSessionContext().stateRevision, revision);
  assert.deepEqual(getState(), before);

  const req = request("bonus-unarmed");
  const ki = getState().combat.ki.current;
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), req, "bonus-unarmed-hit",
  ).status, "applied");
  assert.equal(getState().combat.ki.current, ki);
  assert.equal(getState().ui.turn.bonusActionUsed, true);
});

test("completed flurry continuation uses the paid sequence without charging ki again", () => {
  openSara();
  const first = request();
  const ki = getState().combat.ki.current;
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), first, "bonus-flurry-first",
  ).status, "applied");
  const stateAfterFirst = getState();
  const second = request("flurry", {
    attackId: "bonus-flurry-attack-2",
    expectedUsedSlots: 1,
  });
  const result = commitCompletedBonusAttack(
    getSessionContext(), second, "bonus-flurry-second",
  );
  assert.equal(result.status, "applied");
  const sequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === first.sequenceId);
  assert.equal(sequence.resolvedAttacks.length, 2);
  assert.equal(sequence.status, "complete");
  assert.equal(getState().combat.ki.current, ki - 1);
  assert.equal(stateAfterFirst.ui.turn.bonusActionUsed, true);
});

test("completed bonus receipt replays canonical request and rejects collisions", () => {
  openSara();
  const req = request();
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), req, "bonus-replay",
  ).status, "applied");
  const revision = getSessionContext().stateRevision;
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), req, "bonus-replay",
  ).status, "replayed");
  assert.equal(getSessionContext().stateRevision, revision);
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), request("bonus-unarmed"), "bonus-replay",
  ).reason, "operation-collision");
});

test("legacy paid flurry can continue through completed path without another payment", () => {
  openSara();
  const first = request();
  const start = startAttackSequence(getSessionContext(), {
    kind: "flurry",
    sequenceId: first.sequenceId,
    confirmed: true,
    triggerConfirmed: false,
  }, "legacy-paid-flurry");
  assert.equal(start.status, "applied");
  const paidKi = getState().combat.ki.current;
  const legacySequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === first.sequenceId);
  assert.equal(legacySequence.resourcePaymentApplied, true);
  assert.equal(legacySequence.actionFlagApplied, true);
  assert.equal(legacySequence.resolvedAttacks.length, 0);

  const continuation = request("flurry", {
    attackId: "legacy-flurry-completed-hit",
    expectedUsedSlots: 0,
  });
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), continuation, "legacy-flurry-completed-op",
  ).status, "applied");
  assert.equal(getState().combat.ki.current, paidKi);
  assert.equal(getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === first.sequenceId).resolvedAttacks.length, 1);
});

test("slot and sequence-kind conflicts reject without applying bonus payment", () => {
  openSara();
  const first = request();
  const initialRevision = getSessionContext().stateRevision;
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), first, "bonus-slot-first",
  ).status, "applied");
  const afterFirst = structuredClone(getState());
  const conflict = commitCompletedBonusAttack(
    getSessionContext(),
    request("bonus-unarmed", { sequenceId: first.sequenceId }),
    "bonus-kind-conflict",
  );
  assert.equal(conflict.status, "rejected");
  assert.deepEqual(getState(), afterFirst);
  assert.equal(getSessionContext().stateRevision, initialRevision + 1);
  const before = structuredClone(getState());
  const stale = request("flurry", {
    attackId: "bonus-slot-stale",
    expectedUsedSlots: 0,
  });
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), stale, "bonus-slot-stale-op",
  ).status, "rejected");
  assert.deepEqual(getState(), before);
});

test("bonus fingerprint ignores ki availability while first flurry fingerprints it", () => {
  openSara();
  const state = getState();
  const zeroKi = structuredClone(state);
  zeroKi.combat.ki.current = 0;
  assert.equal(
    getWorkspaceAttackFingerprint(state, "unstarted", "bonus-unarmed", true),
    getWorkspaceAttackFingerprint(zeroKi, "unstarted", "bonus-unarmed", true),
  );
  assert.notEqual(
    getWorkspaceAttackFingerprint(state, "unstarted", "flurry", true),
    getWorkspaceAttackFingerprint(zeroKi, "unstarted", "flurry", true),
  );
  const paidFlurry = {
    id: "paid-flurry-fingerprint",
    kind: "flurry",
    status: "open",
    maximumAttacks: 2,
    turnMarker: state.ui.turn.turnNumber,
    battleId: null,
    ownTurnId: null,
    resolvedAttacks: [],
  };
  const paidState = structuredClone(state);
  paidState.monk.combatAssistant.activeSequences = [paidFlurry];
  paidState.combat.ki.current = 1;
  const paidZeroKi = structuredClone(paidState);
  paidZeroKi.combat.ki.current = 0;
  assert.equal(
    getWorkspaceAttackFingerprint(paidState, paidFlurry.id, "flurry", false),
    getWorkspaceAttackFingerprint(paidZeroKi, paidFlurry.id, "flurry", false),
  );
});

test("level and resource guards reject without mutation; level 2 permits a bonus attack", () => {
  for (const kind of ["flurry", "bonus-unarmed"]) {
    openSara();
    updateState((draft) => { draft.profile.level = 1; });
    const req = request(kind);
    const before = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const result = commitCompletedBonusAttack(
      getSessionContext(), req, `level-one-${kind}`,
    );
    assert.equal(result.status, "rejected");
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revision);
  }
  openSara();
  updateState((draft) => { draft.profile.level = 2; });
  const req = request("bonus-unarmed");
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), req, "level-two-bonus",
  ).status, "applied");
});

test("flurry attack count is two at level 16 and three at 17 with one total ki payment", () => {
  for (const [level, count] of [[16, 2], [17, 3]]) {
    openSara();
    updateState((draft) => {
      draft.profile.level = level;
      draft.combat.ki.current = 1;
    });
    const kiBefore = getState().combat.ki.current;
    for (let slot = 0; slot < count; slot += 1) {
      const req = request("flurry", {
        attackId: `flurry-${level}-${slot}`,
        expectedUsedSlots: slot,
        attack: {
          profileId: "unarmed", rollMode: "normal", firstD20: "1",
          secondD20: "", targetArmorClass: "", dmHitResult: null,
          targetLabel: "", confirmSeparateAction: false, dmExceptionConfirmed: false,
        },
        damageRolls: [],
      });
      assert.equal(commitCompletedBonusAttack(
        getSessionContext(), req, `flurry-${level}-op-${slot}`,
      ).status, "applied");
      const sequence = getState().monk.combatAssistant.activeSequences
        .find((entry) => entry.id === req.sequenceId);
      assert.equal(sequence.maximumAttacks, count);
      assert.equal(sequence.resolvedAttacks.length, slot + 1);
      assert.equal(getState().combat.ki.current, slot === 0 ? 0 : kiBefore - 1);
    }
    assert.equal(getState().combat.ki.current, 0);
  }
});

test("unavailable ki and an already-used bonus action reject first flurry without mutation", () => {
  openSara();
  updateState((draft) => { draft.combat.ki.current = 0; });
  let before = structuredClone(getState());
  let revision = getSessionContext().stateRevision;
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), request(), "no-ki-first-flurry",
  ).status, "rejected");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);

  openSara();
  updateState((draft) => { draft.ui.turn.bonusActionUsed = true; });
  before = structuredClone(getState());
  revision = getSessionContext().stateRevision;
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), request(), "used-bonus-first-flurry",
  ).status, "rejected");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);
});

test("hit damage rejects empty and invalid rolls with exact state, revision, and Map storage unchanged", () => {
  const previousWindow = globalThis.window;
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };
  try {
    openSara();
    for (const [damageRolls, operationId] of [
      [[], "empty-damage"],
      [["999"], "invalid-damage"],
    ]) {
      const before = structuredClone(getState());
      const revision = getSessionContext().stateRevision;
      const storage = new Map(values);
      const result = commitCompletedBonusAttack(
        getSessionContext(), request("flurry", { damageRolls }), operationId,
      );
      assert.equal(result.status, "rejected");
      assert.deepEqual(getState(), before);
      assert.equal(getSessionContext().stateRevision, revision);
      assert.deepEqual(values, storage);
    }
  } finally {
    globalThis.window = previousWindow;
  }
});

test("stale owner, battle, own turn, and turn marker reject without mutation", () => {
  openSara();
  updateState((draft) => {
    startBattle(draft, { rawD20: "10" }, { id: "bonus-stale-battle" });
    beginOwnTurn(draft, { id: "bonus-stale-own-turn" });
  });
  const base = request("bonus-unarmed");
  const wrongOwner = { ...getSessionContext(), sessionGeneration: "replaced-generation" };
  const invalidCases = [
    [wrongOwner, base, "stale-owner"],
    [getSessionContext(), { ...base, battleId: "wrong-battle", ownTurnId: "bonus-stale-own-turn" }, "stale-battle"],
    [getSessionContext(), { ...base, battleId: "bonus-stale-battle", ownTurnId: "wrong-own-turn" }, "stale-own-turn"],
    [getSessionContext(), { ...base, battleId: "bonus-stale-battle", ownTurnId: "bonus-stale-own-turn", turnMarker: base.turnMarker + 1 }, "stale-turn-marker"],
  ];
  for (const [owner, req, id] of invalidCases) {
    const before = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    assert.equal(commitCompletedBonusAttack(owner, req, id).status, "rejected");
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revision);
  }
});

test("unsupported sequence kind and ineligible attack profile reject without mutation", () => {
  openSara();
  const before = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), request("reaction-unarmed"), "unsupported-bonus-kind",
  ).status, "rejected");
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), request("flurry", {
      attack: { ...request().attack, profileId: "returnedProjectile" },
    }), "disallowed-bonus-profile",
  ).status, "rejected");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);
});

test("critical bonus hit records two separate physical damage dice", () => {
  openSara();
  const req = request("bonus-unarmed", {
    attack: {
      profileId: "unarmed", rollMode: "normal", firstD20: "20",
      secondD20: "", targetArmorClass: "", dmHitResult: null,
      targetLabel: "", confirmSeparateAction: false, dmExceptionConfirmed: false,
    },
    damageRolls: ["2", "3"],
  });
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), req, "bonus-critical-hit",
  ).status, "applied");
  const attack = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
  assert.equal(attack.critical, true);
  assert.deepEqual(attack.damageRolls, [2, 3]);
  assert.equal(attack.damageStatus, "recorded");
});

test("confirmed DM exception for natural 1 remains attached to completed bonus result", () => {
  openSara();
  const req = request("bonus-unarmed", {
    attack: {
      profileId: "unarmed", rollMode: "normal", firstD20: "1",
      secondD20: "", targetArmorClass: "", dmHitResult: "hit",
      targetLabel: "", confirmSeparateAction: false, dmExceptionConfirmed: true,
    },
    damageRolls: ["3"],
  });
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), req, "bonus-dm-exception",
  ).status, "applied");
  const attack = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
  assert.equal(attack.hitResult, "hit");
  assert.equal(attack.hitResolutionSource, "dm");
  assert.equal(attack.rawD20Rolls[0], 1);
});

test("legacy flurry with inconsistent payment flags is rejected without repair or payment", () => {
  openSara();
  const req = request("flurry");
  assert.equal(startAttackSequence(getSessionContext(), {
    kind: "flurry", sequenceId: req.sequenceId, confirmed: true,
  }, "legacy-inconsistent-start").status, "applied");
  updateState((draft) => {
    const sequence = draft.monk.combatAssistant.activeSequences
      .find((entry) => entry.id === req.sequenceId);
    sequence.resourcePaymentApplied = false;
  });
  const before = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), { ...req, expectedUsedSlots: 0 }, "legacy-inconsistent-continue",
  ).status, "rejected");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);
});

test("bonus completion preserves existing action and reaction flags", () => {
  openSara();
  updateState((draft) => {
    draft.ui.turn.actionUsed = true;
    draft.ui.turn.reactionUsed = true;
  });
  const req = request("bonus-unarmed");
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), req, "bonus-preserve-other-flags",
  ).status, "applied");
  assert.equal(getState().ui.turn.actionUsed, true);
  assert.equal(getState().ui.turn.reactionUsed, true);
});

test("bonus sequence coexists with normal Attack while competing bonus sequences are rejected", () => {
  openSara();
  const normal = {
    sequenceId: "coexisting-normal-attack",
    attackId: "coexisting-normal-hit",
    battleId: null,
    ownTurnId: null,
    turnMarker: Number(getState().ui.turn.turnNumber),
    expectedUsedSlots: 0,
    attack: {
      profileId: "unarmed", rollMode: "normal", firstD20: "10",
      secondD20: "", targetArmorClass: "", dmHitResult: "hit",
      targetLabel: "", confirmSeparateAction: false, dmExceptionConfirmed: false,
    },
    damageRolls: ["3"],
  };
  assert.equal(commitCompletedNormalAttack(
    getSessionContext(), normal, "coexist-normal-op",
  ).status, "applied");
  assert.equal(getState().ui.turn.actionUsed, true);
  const bonus = request("bonus-unarmed", {
    sequenceId: "coexisting-bonus-sequence",
    attackId: "coexisting-bonus-hit",
  });
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), bonus, "coexist-bonus-op",
  ).status, "applied");
  assert.equal(getState().monk.combatAssistant.activeSequences.length, 2);
  assert.equal(getState().ui.turn.actionUsed, true);
  const before = structuredClone(getState());
  const competing = request("bonus-unarmed", {
    sequenceId: "second-bonus-sequence",
    attackId: "second-bonus-hit",
  });
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), competing, "competing-bonus-op",
  ).status, "rejected");
  assert.deepEqual(getState(), before);
});
