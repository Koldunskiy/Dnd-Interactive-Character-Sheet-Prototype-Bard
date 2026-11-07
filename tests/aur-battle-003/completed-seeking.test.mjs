import test from "node:test";
import assert from "node:assert/strict";
import {
  getSessionContext,
  getState,
  openCharacterSession,
  updateState,
} from "../../scripts/state.js";
import {
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
