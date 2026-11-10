import test from "node:test";
import assert from "node:assert/strict";
import { getState, getSessionContext, openCharacterSession } from "../../scripts/state.js";
import {
  commitCompletedOpportunityAttack,
  previewCompletedOpportunityAttack,
  readCompletedOpportunityAttackReceipt,
} from "../../scripts/actions/sara-combat.js";

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
