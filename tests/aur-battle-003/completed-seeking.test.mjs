import test from "node:test";
import assert from "node:assert/strict";
import {
  getSessionContext,
  getState,
  openCharacterSession,
  updateState,
} from "../../scripts/state.js";
import {
  beginSeekingStrike,
  commitCompletedBonusAttack,
  commitCompletedNormalAttack,
  buildSeekingParentBasis,
  commitCompletedSeekingStrike,
  previewCompletedSeekingStrike,
  readCompletedSeekingStrikeReceipt,
  recordAttackOutcome,
  startAttackSequence,
} from "../../scripts/actions/sara-combat.js";
import { readSeekingHistory } from "../../scripts/combat/seeking-history.js";

function prepareParent({ level = 6, sequenceKind = "attack-action", battle = false } = {}) {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  updateState((draft) => {
    draft.profile.level = level;
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    if (battle) {
      draft.battleConsole.current = {
        id: "seeking-boundary-battle",
        phase: "own-turn",
        ownTurnId: "seeking-boundary-turn",
      };
    }
    return draft;
  });
  let context = getSessionContext();
  const sequenceId = `seeking-parent-${sequenceKind}`;
  assert.equal(startAttackSequence(context, {
    kind: sequenceKind,
    sequenceId,
    confirmed: sequenceKind === "flurry",
    triggerConfirmed: sequenceKind === "bonus-unarmed",
  }, `start-${sequenceId}`).status, "applied");
  context = getSessionContext();
  assert.equal(recordAttackOutcome(context, sequenceId, "seeking-parent-miss", {
    kind: sequenceKind,
    profileId: "unarmed",
    rollMode: "normal",
    firstD20: "2",
    secondD20: "",
    targetArmorClass: "30",
  }, `miss-${sequenceId}`).status, "applied");
  return { sequenceId, attackId: "seeking-parent-miss" };
}

function makeRequest({ sequenceId, attackId, overrides = {} }) {
  const state = getState();
  const sequence = state.monk.combatAssistant.activeSequences
    .find((entry) => entry.id === sequenceId);
  const attack = sequence.resolvedAttacks.find((entry) => entry.id === attackId);
  const history = readSeekingHistory(attack, { actionId: sequenceId, attackId });
  return {
    actionId: sequenceId,
    attackId,
    invocationId: overrides.invocationId ?? "completed-seeking-invocation",
    battleId: state.battleConsole.current?.id ?? null,
    phaseAtOpen: state.battleConsole.current?.phase ?? "waiting",
    ownTurnId: state.battleConsole.current?.phase === "own-turn"
      ? state.battleConsole.current.ownTurnId : null,
    turnMarker: Number(state.ui.turn.turnNumber),
    expectedParentBasis: buildSeekingParentBasis(sequence, attack, history),
    replacement: {
      rollMode: "normal",
      firstD20: "10",
      secondD20: "",
      targetArmorClass: "30",
      dmHitResult: null,
      dmExceptionConfirmed: false,
    },
    damageRolls: [],
    ...overrides,
  };
}

test("completed Seeking miss atomically spends ki and replaces the same attack", () => {
  const { sequenceId, attackId } = prepareParent();
  const request = makeRequest({ sequenceId, attackId });
  const stateBefore = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  const preview = previewCompletedSeekingStrike(getState(), request);
  assert.equal(preview.ok, true);
  assert.equal(preview.stage, "complete");
  assert.equal(getSessionContext().stateRevision, revision);
  const result = commitCompletedSeekingStrike(
    getSessionContext(), preview.request, request.invocationId,
  );
  assert.equal(result.status, "applied", result.reason);
  assert.equal(getSessionContext().stateRevision, revision + 1);
  const sequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === sequenceId);
  const attack = sequence.resolvedAttacks[0];
  assert.equal(sequence.resolvedAttacks.length, 1);
  assert.equal(attack.id, attackId);
  assert.equal(attack.slotNumber, stateBefore.monk.combatAssistant.activeSequences
    .find((entry) => entry.id === sequenceId).resolvedAttacks[0].slotNumber);
  assert.equal(attack.hitResult, "miss");
  assert.equal(attack.damageStatus, "not-applicable");
  assert.equal(getState().combat.ki.current, stateBefore.combat.ki.current - 1);
  const history = readSeekingHistory(attack, { actionId: sequenceId, attackId });
  assert.equal(history.length, 1);
  assert.equal(history[0].status, "resolved");
  assert.equal(history[0].kiPaid, 1);
  assert.equal(history[0].resolutionOperationId, request.invocationId);
  assert.equal(attack.seekingAmendment.paidOperationId, history[0].paidOperationId);
  assert.equal(readCompletedSeekingStrikeReceipt(getState(), request.invocationId).outcome, "miss");
});

test("completed Seeking hit commits damage from the stored parent snapshot atomically", () => {
  const { sequenceId, attackId } = prepareParent();
  const parent = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
  const savedBonus = parent.attackBonusSnapshot;
  updateState((draft) => {
    draft.abilities.strength = 3;
    return draft;
  });
  const request = makeRequest({
    sequenceId,
    attackId,
    overrides: {
      invocationId: "completed-seeking-hit",
      replacement: {
        rollMode: "normal", firstD20: "19", secondD20: "",
        targetArmorClass: "10", dmHitResult: null, dmExceptionConfirmed: false,
      },
      damageRolls: ["3"],
    },
  });
  const revision = getSessionContext().stateRevision;
  const preview = previewCompletedSeekingStrike(getState(), request);
  assert.equal(preview.ok, true);
  assert.equal(preview.stage, "complete");
  assert.equal(preview.replacement.attackBonusSnapshot, savedBonus);
  const result = commitCompletedSeekingStrike(
    getSessionContext(), preview.request, request.invocationId,
  );
  assert.equal(result.status, "applied", result.reason);
  assert.equal(getSessionContext().stateRevision, revision + 1);
  const attack = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
  assert.equal(attack.hitResult, "hit");
  assert.equal(attack.damageStatus, "recorded");
  assert.deepEqual(attack.damageRolls, [3]);
  assert.equal(attack.damageTotalBeforeTargetModifiers,
    3 + attack.profileSnapshot.damageModifier);
  assert.notEqual(attack.damageStatus, "awaiting-damage");
});

test("completed Seeking hit requires complete damage and rejects invalid rolls without mutation", () => {
  const { sequenceId, attackId } = prepareParent();
  for (const [damageRolls, invocationId] of [
    [[], "seeking-no-damage"],
    [["999"], "seeking-invalid-damage"],
  ]) {
    const request = makeRequest({
      sequenceId,
      attackId,
      overrides: {
        invocationId,
        replacement: {
          rollMode: "normal", firstD20: "19", secondD20: "",
          targetArmorClass: "10", dmHitResult: null, dmExceptionConfirmed: false,
        },
        damageRolls,
      },
    });
    const before = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const result = commitCompletedSeekingStrike(
      getSessionContext(), request, invocationId,
    );
    assert.equal(result.status, "rejected");
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revision);
  }
});

test("Seeking replay survives a later invocation and a second invocation uses the new miss basis", () => {
  const { sequenceId, attackId } = prepareParent();
  const first = makeRequest({ sequenceId, attackId });
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), first, first.invocationId,
  ).status, "applied");
  const afterFirst = structuredClone(getState());
  const firstReceiptRequest = readCompletedSeekingStrikeReceipt(
    getState(), first.invocationId,
  ).request;
  const second = makeRequest({
    sequenceId,
    attackId,
    overrides: {
      invocationId: "second-seeking-invocation",
      replacement: {
        rollMode: "normal", firstD20: "11", secondD20: "",
        targetArmorClass: "30", dmHitResult: null, dmExceptionConfirmed: false,
      },
    },
  });
  assert.notEqual(first.expectedParentBasis, second.expectedParentBasis);
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), second, second.invocationId,
  ).status, "applied");
  const revision = getSessionContext().stateRevision;
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), firstReceiptRequest, first.invocationId,
  ).status, "replayed");
  assert.equal(getSessionContext().stateRevision, revision);
  const attack = getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0];
  const history = readSeekingHistory(attack, { actionId: sequenceId, attackId });
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((entry) => entry.status), ["resolved", "resolved"]);
  assert.deepEqual(history[1].original.rawD20Rolls, [10]);
  assert.equal(getState().combat.ki.current, afterFirst.combat.ki.current - 1);
});

test("stale parent basis, turn context, and operation collision reject without payment", () => {
  const { sequenceId, attackId } = prepareParent({ battle: true });
  const request = makeRequest({ sequenceId, attackId, overrides: {
    battleId: "seeking-boundary-battle",
    phaseAtOpen: "own-turn",
    ownTurnId: "seeking-boundary-turn",
  } });
  const changedBasis = { ...request, expectedParentBasis: "stale-basis" };
  const before = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), changedBasis, request.invocationId,
  ).status, "rejected");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);

  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), request, request.invocationId,
  ).status, "applied");
  const committed = structuredClone(getState());
  const collision = { ...request, replacement: { ...request.replacement, firstD20: "12" } };
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), collision, request.invocationId,
  ).reason, "operation-collision");
  assert.deepEqual(getState(), committed);
});

test("natural 1 manual hit requires explicit DM exception confirmation", () => {
  const { sequenceId, attackId } = prepareParent();
  const request = makeRequest({
    sequenceId,
    attackId,
    overrides: {
      invocationId: "seeking-natural-exception",
      replacement: {
        rollMode: "normal", firstD20: "1", secondD20: "",
        targetArmorClass: "", dmHitResult: "hit", dmExceptionConfirmed: false,
      },
      damageRolls: ["2"],
    },
  });
  assert.equal(previewCompletedSeekingStrike(getState(), request).ok, false);
  request.replacement.dmExceptionConfirmed = true;
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), request, request.invocationId,
  ).status, "applied");
  assert.equal(getState().monk.combatAssistant.activeSequences[0]
    .resolvedAttacks[0].hitResult, "hit");
});

test("manual natural-20 miss uses the existing DM exception confirmation contract", () => {
  const { sequenceId, attackId } = prepareParent();
  const request = makeRequest({
    sequenceId,
    attackId,
    overrides: {
      invocationId: "seeking-natural-20-exception",
      replacement: {
        rollMode: "normal", firstD20: "20", secondD20: "",
        targetArmorClass: "", dmHitResult: "miss", dmExceptionConfirmed: false,
      },
    },
  });
  const before = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  assert.equal(previewCompletedSeekingStrike(getState(), request).ok, false);
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), request, request.invocationId,
  ).status, "rejected");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);
  request.replacement.dmExceptionConfirmed = true;
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), request, request.invocationId,
  ).status, "applied");
  assert.equal(getState().monk.combatAssistant.activeSequences[0]
    .resolvedAttacks[0].hitResult, "miss");
});

test("basis history is a nonrecursive semantic projection across successive misses", () => {
  const { sequenceId, attackId } = prepareParent();
  const requests = [];
  let priorBasis = null;
  for (let index = 0; index < 3; index += 1) {
    const request = makeRequest({
      sequenceId,
      attackId,
      overrides: {
        invocationId: `basis-history-${index}`,
        replacement: {
          rollMode: "normal", firstD20: String(10 + index), secondD20: "",
          targetArmorClass: "30", dmHitResult: null, dmExceptionConfirmed: false,
        },
      },
    });
    assert.notEqual(request.expectedParentBasis, priorBasis);
    const semanticHistory = JSON.parse(request.expectedParentBasis).history;
    assert.equal(JSON.stringify(semanticHistory).includes("expectedParentBasis"), false);
    assert.equal(JSON.stringify(semanticHistory).includes("resolutionRequest"), false);
    assert.equal(JSON.stringify(semanticHistory).includes("completedSeekingOperation"), false);
    assert.equal(commitCompletedSeekingStrike(
      getSessionContext(), request, request.invocationId,
    ).status, "applied");
    requests.push(request);
    priorBasis = request.expectedParentBasis;
  }
  const attack = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === sequenceId).resolvedAttacks[0];
  const history = readSeekingHistory(attack, { actionId: sequenceId, attackId });
  assert.equal(history.length, 3);
  assert.deepEqual(history.map((entry) => entry.status), ["resolved", "resolved", "resolved"]);
  const latestBasis = buildSeekingParentBasis(
    getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === sequenceId),
    attack,
    history,
  );
  assert.notEqual(latestBasis, requests[2].expectedParentBasis);
  const alteredHistory = structuredClone(history);
  alteredHistory[0].original.attackTotal += 1;
  assert.notEqual(buildSeekingParentBasis(
    getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === sequenceId), attack, alteredHistory,
  ), latestBasis);
  const changedReplacement = structuredClone(history);
  changedReplacement[0].replacement.attackTotal += 1;
  assert.notEqual(buildSeekingParentBasis(
    getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === sequenceId), attack, changedReplacement,
  ), latestBasis);
  const changedStatus = structuredClone(history);
  changedStatus[0].kiPaid = 2;
  assert.notEqual(buildSeekingParentBasis(
    getState().monk.combatAssistant.activeSequences
      .find((entry) => entry.id === sequenceId), attack, changedStatus,
  ), latestBasis);
  const revision = getSessionContext().stateRevision;
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), readCompletedSeekingStrikeReceipt(
      getState(), requests[0].invocationId,
    ).request, requests[0].invocationId,
  ).status, "replayed");
  assert.equal(getSessionContext().stateRevision, revision);
});

test("two invocations opened against one basis allow only the first completed miss", () => {
  const { sequenceId, attackId } = prepareParent();
  const first = makeRequest({
    sequenceId, attackId, overrides: { invocationId: "same-basis-first" },
  });
  const concurrent = makeRequest({
    sequenceId, attackId, overrides: { invocationId: "same-basis-second" },
  });
  assert.equal(first.expectedParentBasis, concurrent.expectedParentBasis);
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), first, first.invocationId,
  ).status, "applied");
  const afterFirst = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), concurrent, concurrent.invocationId,
  ).status, "rejected");
  assert.deepEqual(getState(), afterFirst);
  assert.equal(getSessionContext().stateRevision, revision);
  assert.equal(getState().monk.combatAssistant.activeSequences[0]
    .resolvedAttacks[0].seekingAmendments.length, 1);
});

test("rejected empty/invalid damage and stale basis preserve state, revision, and storage", () => {
  const previousWindow = globalThis.window;
  const stored = new Map();
  let writes = 0;
  globalThis.window = { localStorage: {
    getItem: (key) => stored.get(key) ?? null,
    setItem(key, value) { writes += 1; stored.set(key, String(value)); },
    removeItem: (key) => stored.delete(key),
  } };
  try {
    const { sequenceId, attackId } = prepareParent();
    const validHit = makeRequest({
      sequenceId,
      attackId,
      overrides: {
        invocationId: "empty-invalid-damage",
        replacement: {
          rollMode: "normal", firstD20: "19", secondD20: "",
          targetArmorClass: "10", dmHitResult: null, dmExceptionConfirmed: false,
        },
        damageRolls: [],
      },
    });
    writes = 0;
    const storedBefore = new Map(stored);
    const before = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    for (const [request, id] of [
      [validHit, "empty-invalid-damage"],
      [{ ...validHit, invocationId: "invalid-damage", damageRolls: ["99"] }, "invalid-damage"],
      [{ ...validHit, invocationId: "stale-basis", expectedParentBasis: "stale" }, "stale-basis"],
    ]) {
      assert.equal(commitCompletedSeekingStrike(
        getSessionContext(), request, id,
      ).status, "rejected");
      assert.deepEqual(getState(), before);
      assert.equal(getSessionContext().stateRevision, revision);
      assert.deepEqual(stored, storedBefore);
      assert.equal(writes, 0);
    }
  } finally {
    globalThis.window = previousWindow;
  }
});

test("replacement advantage/disadvantage and critical damage use the established roll contract", () => {
  let parent = prepareParent();
  let criticalRequest = makeRequest({
    sequenceId: parent.sequenceId,
    attackId: parent.attackId,
    overrides: {
      invocationId: "seeking-critical-advantage",
      replacement: {
        rollMode: "advantage", firstD20: "3", secondD20: "20",
        targetArmorClass: "30", dmHitResult: null, dmExceptionConfirmed: false,
      },
      damageRolls: ["2", "5"],
    },
  });
  assert.equal(previewCompletedSeekingStrike(getState(), criticalRequest).stage, "complete");
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), criticalRequest, criticalRequest.invocationId,
  ).status, "applied");
  let attack = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === parent.sequenceId).resolvedAttacks[0];
  assert.deepEqual(attack.rawD20Rolls, [3, 20]);
  assert.equal(attack.chosenD20, 20);
  assert.equal(attack.critical, true);
  assert.deepEqual(attack.damageRolls, [2, 5]);

  parent = prepareParent();
  const disadvantageRequest = makeRequest({
    sequenceId: parent.sequenceId,
    attackId: parent.attackId,
    overrides: {
      invocationId: "seeking-disadvantage",
      replacement: {
        rollMode: "disadvantage", firstD20: "19", secondD20: "4",
        targetArmorClass: "30", dmHitResult: null, dmExceptionConfirmed: false,
      },
    },
  });
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), disadvantageRequest, disadvantageRequest.invocationId,
  ).status, "applied");
  attack = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === parent.sequenceId).resolvedAttacks[0];
  assert.deepEqual(attack.rawD20Rolls, [19, 4]);
  assert.equal(attack.chosenD20, 4);
  assert.equal(attack.hitResult, "miss");
});

test("Seeking eligibility rejects unavailable resource, technique, parent, pending legacy, and invalid snapshot", () => {
  const mutations = [
    (draft) => { draft.combat.ki.current = 0; },
    (draft) => { draft.monk.ordinaryTechniqueIds = []; },
    (draft, attack) => { attack.profileId = "darts"; attack.profileSnapshot.martialArtsEligible = false; },
    (draft, attack) => { attack.hitResult = "hit"; },
    (draft, attack) => { attack.profileSnapshot = null; },
  ];
  for (let index = 0; index < mutations.length; index += 1) {
    const { sequenceId, attackId } = prepareParent();
    updateState((draft) => {
      const attack = draft.monk.combatAssistant.activeSequences
        .find((entry) => entry.id === sequenceId).resolvedAttacks[0];
      mutations[index](draft, attack);
      return draft;
    });
    const request = makeRequest({ sequenceId, attackId });
    const before = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    const result = previewCompletedSeekingStrike(getState(), request);
    assert.equal(result.ok, false, `eligibility case ${index}`);
    assert.equal(commitCompletedSeekingStrike(
      getSessionContext(), request, request.invocationId,
    ).status, "rejected");
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revision);
  }

  const { sequenceId, attackId } = prepareParent();
  assert.equal(beginSeekingStrike(getSessionContext(), sequenceId, attackId,
    "legacy-pending-seeking").status, "applied");
  const pendingRequest = makeRequest({ sequenceId, attackId });
  const before = structuredClone(getState());
  const revision = getSessionContext().stateRevision;
  assert.equal(previewCompletedSeekingStrike(getState(), pendingRequest).ok, false);
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), pendingRequest, pendingRequest.invocationId,
  ).status, "rejected");
  assert.deepEqual(getState(), before);
  assert.equal(getSessionContext().stateRevision, revision);
});

test("Seeking can replace a miss in a complete sequence with no free attack slots", () => {
  const { sequenceId, attackId } = prepareParent({ level: 6 });
  const sequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === sequenceId);
  if (sequence.maximumAttacks > 1) {
    assert.equal(recordAttackOutcome(getSessionContext(), sequenceId, "last-seeking-parent", {
      kind: "attack-action", profileId: "unarmed", rollMode: "normal",
      firstD20: "2", secondD20: "", targetArmorClass: "30",
    }, "last-seeking-parent-operation").status, "applied");
  }
  const completed = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === sequenceId);
  const lastAttack = completed.resolvedAttacks.at(-1);
  assert.equal(completed.status, "complete");
  assert.equal(completed.resolvedAttacks.length, completed.maximumAttacks);
  const request = makeRequest({ sequenceId, attackId: lastAttack.id });
  assert.equal(previewCompletedSeekingStrike(getState(), request).ok, true);
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), request, request.invocationId,
  ).status, "applied");
  assert.equal(completed.resolvedAttacks.length, completed.maximumAttacks);
});

test("reaction Seeking is allowed only in its current reaction window and never for returned projectile", () => {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  updateState((draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    draft.battleConsole.current = {
      id: "seeking-reaction-window", phase: "waiting", ownTurnId: null,
    };
    return draft;
  });
  const sequenceId = "completed-seeking-reaction-sequence";
  const attackId = "completed-seeking-reaction-miss";
  assert.equal(startAttackSequence(getSessionContext(), {
    sequenceId, kind: "reaction-unarmed", triggerConfirmed: true,
  }, "start-completed-seeking-reaction").status, "applied");
  assert.equal(recordAttackOutcome(getSessionContext(), sequenceId, attackId, {
    kind: "reaction-unarmed", profileId: "unarmed", rollMode: "normal",
    firstD20: "2", secondD20: "", targetArmorClass: "30",
  }, "completed-seeking-reaction-miss-op").status, "applied");
  const request = makeRequest({ sequenceId, attackId });
  assert.equal(previewCompletedSeekingStrike(getState(), request).ok, true);
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), request, request.invocationId,
  ).status, "applied");

  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  updateState((draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    draft.battleConsole.current = {
      id: "seeking-reaction-window-invalid", phase: "waiting", ownTurnId: null,
    };
    return draft;
  });
  const invalidSequence = "completed-seeking-reaction-invalid";
  const invalidAttack = "completed-seeking-reaction-invalid-miss";
  assert.equal(startAttackSequence(getSessionContext(), {
    sequenceId: invalidSequence, kind: "reaction-unarmed", triggerConfirmed: true,
  }, "start-completed-seeking-reaction-invalid").status, "applied");
  assert.equal(recordAttackOutcome(getSessionContext(), invalidSequence, invalidAttack, {
    kind: "reaction-unarmed", profileId: "unarmed", rollMode: "normal",
    firstD20: "2", secondD20: "", targetArmorClass: "30",
  }, "completed-seeking-reaction-invalid-miss-op").status, "applied");
  updateState((draft) => {
    draft.ui.turn.reactionUsed = false;
    return draft;
  });
  const invalidRequest = makeRequest({ sequenceId: invalidSequence, attackId: invalidAttack });
  const beforeInvalid = structuredClone(getState());
  const invalidRevision = getSessionContext().stateRevision;
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), invalidRequest, invalidRequest.invocationId,
  ).status, "rejected");
  assert.deepEqual(getState(), beforeInvalid);
  assert.equal(getSessionContext().stateRevision, invalidRevision);

  const projectileSequence = {
    id: "completed-seeking-returned-projectile",
    kind: "returned-projectile",
    status: "complete",
    maximumAttacks: 1,
    resolvedAttacks: [{
      ...structuredClone(getState().monk.combatAssistant.activeSequences
        .find((entry) => entry.id === invalidSequence).resolvedAttacks[0]),
      id: "completed-seeking-returned-projectile-attack",
      profileId: "unarmed",
      hitResult: "miss",
    }],
  };
  updateState((draft) => {
    draft.ui.turn.reactionUsed = true;
    draft.monk.combatAssistant.activeSequences.push(projectileSequence);
    return draft;
  });
  const projectileRequest = makeRequest({
    sequenceId: projectileSequence.id,
    attackId: projectileSequence.resolvedAttacks[0].id,
  });
  const beforeProjectile = structuredClone(getState());
  const projectileRevision = getSessionContext().stateRevision;
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), projectileRequest, projectileRequest.invocationId,
  ).status, "rejected");
  assert.deepEqual(getState(), beforeProjectile);
  assert.equal(getSessionContext().stateRevision, projectileRevision);
});

test("eligible weapon parent with a saved ammunition spend does not consume ammunition again", () => {
  const { sequenceId, attackId } = prepareParent();
  updateState((draft) => {
    const attack = draft.monk.combatAssistant.activeSequences
      .find((entry) => entry.id === sequenceId).resolvedAttacks[0];
    attack.profileId = "darts";
    attack.profileSnapshot = {
      ...attack.profileSnapshot,
      attackKind: "weapon",
      martialArtsEligible: true,
      damageDice: "1d4",
      damageType: "piercing",
    };
    attack.ammunitionSpend = { itemId: "darts", quantity: 1 };
    draft.inventory.items.find((entry) => entry.id === "darts").quantity -= 1;
    return draft;
  });
  const dartsAfterOriginal = getState().inventory.items.find((entry) => entry.id === "darts").quantity;
  const parent = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === sequenceId).resolvedAttacks[0];
  const ammunitionSpend = structuredClone(parent.ammunitionSpend);
  const request = makeRequest({
    sequenceId, attackId,
    overrides: { invocationId: "completed-seeking-dart-replacement" },
  });
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), request, request.invocationId,
  ).status, "applied");
  assert.equal(getState().inventory.items.find((entry) => entry.id === "darts").quantity,
    dartsAfterOriginal);
  assert.deepEqual(getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === sequenceId).resolvedAttacks[0].ammunitionSpend,
  ammunitionSpend);
});

test("completed normal and bonus API parents are both valid Seeking parents", () => {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  updateState((draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    return draft;
  });
  const normal = {
    sequenceId: "seeking-completed-normal-parent",
    attackId: "seeking-completed-normal-miss",
    battleId: null, ownTurnId: null, turnMarker: Number(getState().ui.turn.turnNumber),
    expectedUsedSlots: 0,
    attack: {
      profileId: "unarmed", rollMode: "normal", firstD20: "2", secondD20: "",
      targetArmorClass: "30", dmHitResult: null, targetLabel: "",
    },
    damageRolls: [],
  };
  assert.equal(commitCompletedNormalAttack(
    getSessionContext(), normal, "make-seeking-normal-parent",
  ).status, "applied");
  const normalActionUsed = getState().ui.turn.actionUsed;
  const normalSequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === normal.sequenceId);
  const normalCompletedEvidence = structuredClone(normalSequence.resolvedAttacks[0].completedOperation);
  const normalSequenceEvidence = Object.fromEntries([
    "kind", "status", "maximumAttacks", "resourcePaymentApplied", "actionFlagApplied",
    "bonusActionFlagApplied", "reactionFlagApplied", "replacementResults",
  ].map((key) => [key, normalSequence[key]]));
  const normalRequest = makeRequest({
    sequenceId: normal.sequenceId,
    attackId: normal.attackId,
    overrides: { invocationId: "seek-completed-normal" },
  });
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), normalRequest, normalRequest.invocationId,
  ).status, "applied");
  assert.equal(getState().ui.turn.actionUsed, normalActionUsed);
  const normalAfter = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === normal.sequenceId);
  assert.deepEqual(normalAfter.resolvedAttacks[0].completedOperation, normalCompletedEvidence);
  assert.deepEqual(Object.fromEntries([
    "kind", "status", "maximumAttacks", "resourcePaymentApplied", "actionFlagApplied",
    "bonusActionFlagApplied", "reactionFlagApplied", "replacementResults",
  ].map((key) => [key, normalAfter[key]])), normalSequenceEvidence);

  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  updateState((draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    return draft;
  });
  const bonus = {
    sequenceId: "seeking-completed-bonus-parent",
    attackId: "seeking-completed-bonus-miss",
    sequenceKind: "flurry", battleId: null, ownTurnId: null,
    turnMarker: Number(getState().ui.turn.turnNumber), expectedUsedSlots: 0,
    start: { confirmed: true, triggerConfirmed: false, parentId: "fixture" },
    attack: {
      profileId: "unarmed", rollMode: "normal", firstD20: "2", secondD20: "",
      targetArmorClass: "30", dmHitResult: null, targetLabel: "",
      confirmSeparateAction: false, dmExceptionConfirmed: false,
    },
    damageRolls: [],
  };
  assert.equal(commitCompletedBonusAttack(
    getSessionContext(), bonus, "make-seeking-bonus-parent",
  ).status, "applied");
  const bonusActionUsed = getState().ui.turn.bonusActionUsed;
  const bonusSequenceBefore = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === bonus.sequenceId).resourcePaymentApplied;
  const bonusSequenceBeforeObj = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === bonus.sequenceId);
  const bonusCompletedEvidence = structuredClone(bonusSequenceBeforeObj.resolvedAttacks[0].completedOperation);
  const bonusSequenceEvidence = Object.fromEntries([
    "kind", "status", "maximumAttacks", "resourcePaymentApplied", "actionFlagApplied",
    "bonusActionFlagApplied", "reactionFlagApplied", "replacementResults",
  ].map((key) => [key, bonusSequenceBeforeObj[key]]));
  const bonusSlotNumber = bonusSequenceBeforeObj.resolvedAttacks[0].slotNumber;
  const bonusRequest = makeRequest({
    sequenceId: bonus.sequenceId,
    attackId: bonus.attackId,
    overrides: { invocationId: "seek-completed-bonus" },
  });
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), bonusRequest, bonusRequest.invocationId,
  ).status, "applied");
  const bonusSequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === bonus.sequenceId);
  assert.equal(getState().ui.turn.bonusActionUsed, bonusActionUsed);
  assert.equal(bonusSequence.resourcePaymentApplied, bonusSequenceBefore);
  assert.equal(bonusSequence.resolvedAttacks.length, 1);
  assert.equal(bonusSequence.resolvedAttacks[0].slotNumber, bonusSlotNumber);
  assert.deepEqual(bonusSequence.resolvedAttacks[0].completedOperation, bonusCompletedEvidence);
  assert.deepEqual(Object.fromEntries([
    "kind", "status", "maximumAttacks", "resourcePaymentApplied", "actionFlagApplied",
    "bonusActionFlagApplied", "reactionFlagApplied", "replacementResults",
  ].map((key) => [key, bonusSequence[key]])), bonusSequenceEvidence);
});

test("owner, battle, phase, own-turn, and turn-marker staleness reject independently", () => {
  const current = prepareParent({ battle: true });
  const ownerRequest = makeRequest({
    sequenceId: current.sequenceId,
    attackId: current.attackId,
    overrides: {
      battleId: "seeking-boundary-battle",
      phaseAtOpen: "own-turn",
      ownTurnId: "seeking-boundary-turn",
    },
  });
  const beforeOwner = structuredClone(getState());
  const ownerRevision = getSessionContext().stateRevision;
  assert.equal(commitCompletedSeekingStrike({
    ...getSessionContext(), sessionGeneration: getSessionContext().sessionGeneration + 1,
  }, ownerRequest, ownerRequest.invocationId).status, "rejected");
  assert.deepEqual(getState(), beforeOwner);
  assert.equal(getSessionContext().stateRevision, ownerRevision);

  const staleCases = [
    (draft) => { draft.battleConsole.current.id = "different-battle"; },
    (draft) => { draft.battleConsole.current.phase = "waiting"; },
    (draft) => { draft.battleConsole.current.ownTurnId = "different-own-turn"; },
    (draft) => { draft.ui.turn.turnNumber += 1; },
  ];
  for (const [index, mutate] of staleCases.entries()) {
    const parent = prepareParent({ battle: true });
    const request = makeRequest({
      sequenceId: parent.sequenceId,
      attackId: parent.attackId,
      overrides: {
        invocationId: `stale-context-${index}`,
        battleId: "seeking-boundary-battle",
        phaseAtOpen: "own-turn",
        ownTurnId: "seeking-boundary-turn",
      },
    });
    updateState((draft) => { mutate(draft); return draft; });
    const before = structuredClone(getState());
    const revision = getSessionContext().stateRevision;
    assert.equal(commitCompletedSeekingStrike(
      getSessionContext(), request, request.invocationId,
    ).status, "rejected");
    assert.deepEqual(getState(), before);
    assert.equal(getSessionContext().stateRevision, revision);
  }
});

test("unrelated malformed history is local, but selected and matching-ID malformed history blocks", () => {
  const parent = prepareParent();
  const request = makeRequest(parent);
  const originalAttack = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === parent.sequenceId).resolvedAttacks[0];
  updateState((draft) => {
    draft.monk.combatAssistant.activeSequences.push({
      id: "seeking-unrelated-malformed-sequence",
      kind: "attack-action",
      status: "complete",
      resolvedAttacks: [{
        ...structuredClone(originalAttack),
        id: "seeking-unrelated-malformed-attack",
        seekingAmendments: [
          { id: "unrelated-malformed" },
          { id: "unrelated-malformed" },
        ],
        seekingAmendment: null,
      }],
    });
    return draft;
  });
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), request, request.invocationId,
  ).status, "applied");

  const selected = prepareParent();
  const selectedRequest = makeRequest(selected);
  updateState((draft) => {
    const attack = draft.monk.combatAssistant.activeSequences
      .find((entry) => entry.id === selected.sequenceId).resolvedAttacks[0];
    attack.seekingAmendments = [{ id: "selected-malformed" }, { id: "selected-malformed" }];
    attack.seekingAmendment = null;
    return draft;
  });
  const beforeSelected = structuredClone(getState());
  const selectedRevision = getSessionContext().stateRevision;
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), selectedRequest, selectedRequest.invocationId,
  ).status, "rejected");
  assert.deepEqual(getState(), beforeSelected);
  assert.equal(getSessionContext().stateRevision, selectedRevision);

  const collision = prepareParent();
  const collisionRequest = makeRequest(collision);
  const collisionAttack = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === collision.sequenceId).resolvedAttacks[0];
  updateState((draft) => {
    draft.monk.combatAssistant.activeSequences.push({
      id: "seeking-matching-malformed-sequence",
      kind: "attack-action",
      status: "complete",
      resolvedAttacks: [{
        ...structuredClone(collisionAttack),
        id: "seeking-matching-malformed-attack",
        seekingAmendments: [{ id: collisionRequest.invocationId }],
        seekingAmendment: null,
      }],
    });
    return draft;
  });
  const beforeCollision = structuredClone(getState());
  const collisionRevision = getSessionContext().stateRevision;
  assert.equal(commitCompletedSeekingStrike(
    getSessionContext(), collisionRequest, collisionRequest.invocationId,
  ).status, "rejected");
  assert.deepEqual(getState(), beforeCollision);
  assert.equal(getSessionContext().stateRevision, collisionRevision);
});
