import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import {
  SARA_BUILD_PATCH_ID,
  applySaraBuildUpdate,
  proposeSaraBuildUpdate
} from "../../scripts/migrations/sara-build-20261031.js";
import { applyDamagePools } from "../../scripts/combat/damage-pools.js";
import {
  calculateAttackDamage,
  calculateAttackPreview,
  getSaraAttackProfiles,
  parsePhysicalInteger
} from "../../scripts/combat/sara-combat.js";
import { getEffectiveSelectedTechniqueIds } from "../../scripts/selectors/techniques.js";

const persisted = new Map();
let storageFails = false;
globalThis.window = {
  localStorage: {
    getItem: (key) => persisted.get(key) ?? null,
    setItem: (key, value) => {
      if (storageFails) throw new Error("storage unavailable");
      persisted.set(key, value);
    },
    removeItem: (key) => persisted.delete(key)
  }
};

const stateModule = await import("../../scripts/state.js");
const {
  getSessionContext,
  getState,
  openCharacterSession,
  retryPersistedState,
  updateSessionState
} = stateModule;
const combatActions = await import("../../scripts/actions/sara-combat.js");

function openFreshSession() {
  persisted.clear();
  storageFails = false;
  assert.equal(openCharacterSession("sara-velaris").status, "missing");
  return getSessionContext();
}

function recordAttack(actionId, attackId, {
  kind = "attack-action",
  firstD20 = "12",
  targetArmorClass = "10",
  ...options
} = {}, operationId = attackId) {
  return combatActions.recordAttackOutcome(
    getSessionContext(),
    actionId,
    attackId,
    {
      kind,
      profileId: "unarmed",
      rollMode: "normal",
      firstD20,
      targetArmorClass,
      ...options
    },
    operationId
  );
}

test("physical dice parsing and attack profiles are strict and keep projectile bonuses separate", () => {
  assert.deepEqual(parsePhysicalInteger("20", 1, 20), { ok: true, value: 20 });
  for (const invalid of ["", "1.5", "NaN", "21"]) {
    assert.equal(parsePhysicalInteger(invalid, 1, 20).ok, false);
  }

  const derived = getDerivedStats(sara);
  const profiles = getSaraAttackProfiles(sara, derived);
  assert.equal(profiles.unarmed.attackBonus, 10);
  assert.equal(profiles.unarmed.damageModifier, 6);
  assert.equal(profiles.returnedProjectile.attackBonus, 9);
  assert.equal(profiles.returnedProjectile.damageModifier, 5);
  assert.equal(profiles.returnedProjectile.range, "20/60");

  const preview = calculateAttackPreview(sara, {
    profileId: "unarmed",
    rollMode: "advantage",
    firstD20: "4",
    secondD20: "18",
    targetArmorClass: "28"
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.chosenD20, 18);
  assert.equal(preview.attackTotal, 28);
  assert.equal(preview.hitResult, true);

  assert.deepEqual(
    calculateAttackDamage(profiles.unarmed, ["4"], false).damageTotalBeforeTargetModifiers,
    10
  );
  assert.equal(calculateAttackDamage(profiles.unarmed, ["4"], true).ok, false);
  assert.equal(calculateAttackDamage(profiles.unarmed, ["4", "7"], true)
    .damageTotalBeforeTargetModifiers, 17);
});

test("temporary HP absorbs damage first and healing leaves temporary HP unchanged", () => {
  assert.deepEqual(applyDamagePools(20, 7, 5), {
    ok: true,
    hpBefore: 20,
    tempHpBefore: 7,
    damage: 5,
    absorbedByTemp: 5,
    remainingForHp: 0,
    hpAfter: 20,
    tempHpAfter: 2
  });
});

test("saved techniques are effective only when their prerequisites and choices are valid", () => {
  const unavailable = structuredClone(sara);
  unavailable.monk.ordinaryTechniqueIds.push("ll-monk:warrior-adept");
  assert.equal(getEffectiveSelectedTechniqueIds(unavailable).has("ll-monk:warrior-adept"), false);
  unavailable.monk.techniqueChoices["ll-monk:warrior-adept"] = {
    styleId: "ll-style:featherweight-fighting"
  };
  assert.equal(getEffectiveSelectedTechniqueIds(unavailable).has("ll-monk:warrior-adept"), true);

  const invalidCantripChoice = structuredClone(sara);
  invalidCantripChoice.monk.ordinaryTechniqueIds.push("ll-monk:divine-light");
  assert.equal(getEffectiveSelectedTechniqueIds(invalidCantripChoice).has("ll-monk:divine-light"), false);
});

test("build update proposes exact defaults, preserves unrelated state, and records an idempotency marker", () => {
  const oldBuild = structuredClone(sara);
  oldBuild.monk.ordinaryTechniqueIds = oldBuild.monk.ordinaryTechniqueIds
    .map((id) => id === "ll-monk:slowing-strike" ? "ll-monk:heavenly-step" : id);
  oldBuild.inventory.items = oldBuild.inventory.items.filter((item) => item.id !== "insignia-of-claws");
  oldBuild.combat.ki.current = 9;
  oldBuild.combat.hp.temp = 6;
  oldBuild.notes = "Keep this note";

  const proposal = proposeSaraBuildUpdate(oldBuild);
  assert.equal(proposal.status, "proposal");
  assert.equal(proposal.techniqueDelta.add, "ll-monk:slowing-strike");
  assert.equal(proposal.itemDelta.addId, "insignia-of-claws");
  const result = applySaraBuildUpdate(oldBuild, proposal, {
    techniques: "apply",
    insignia: "add",
    wearInsignia: false
  });
  assert.equal(result.status, "applied");
  assert.equal(result.state.combat.ki.current, 9);
  assert.equal(result.state.combat.hp.temp, 6);
  assert.equal(result.state.notes, "Keep this note");
  assert.equal(result.state.inventory.items.at(-1).equipped, false);
  assert.equal(result.state.monk.buildUpdateMarkers[SARA_BUILD_PATCH_ID].techniques, "applied");
  assert.equal(proposeSaraBuildUpdate(result.state).status, "already-current");

  const conflict = structuredClone(oldBuild);
  conflict.monk.ordinaryTechniqueIds.push("ll-monk:arresting-strike");
  const conflictProposal = proposeSaraBuildUpdate(conflict);
  assert.equal(conflictProposal.conflicts.some((entry) => entry.kind === "custom-techniques"), true);
  const kept = applySaraBuildUpdate(conflict, conflictProposal, {
    techniques: "keep",
    insignia: "add"
  });
  assert.equal(kept.status, "applied");
  assert.equal(kept.state.monk.ordinaryTechniqueIds.includes("ll-monk:arresting-strike"), true);
});

test("attack actions mark the action on the first physical roll and reject retries", () => {
  openFreshSession();
  assert.equal(getState().ui.turn.actionUsed, false);
  const result = recordAttack("attack-1", "attack-1:1", {}, "attack-op-1");
  assert.equal(result.status, "applied");
  assert.equal(getState().ui.turn.actionUsed, true);
  assert.equal(getState().monk.combatAssistant.activeSequences[0].resolvedAttacks[0].hitResult, "hit");
  assert.equal(recordAttack("attack-1", "attack-1:1", {}, "attack-op-2").status, "rejected");
  assert.equal(recordAttack("attack-1", "attack-1:1", {}, "attack-op-1").reason, "duplicate-operation");
});

test("invalid physical rolls do not consume the action and attack sequences enforce their limit", () => {
  openFreshSession();
  const invalid = recordAttack("invalid-attack", "invalid-attack:1", {
    firstD20: "2.5"
  });
  assert.equal(invalid.status, "rejected");
  assert.equal(getState().ui.turn.actionUsed, false);

  const started = combatActions.startAttackSequence(
    getSessionContext(),
    { kind: "attack-action", sequenceId: "two-attacks" },
    "two-attacks-start"
  );
  assert.equal(started.status, "applied");
  assert.equal(recordAttack("two-attacks", "two-attacks:1", {}, "two-attacks-1").status, "applied");
  assert.equal(recordAttack("two-attacks", "two-attacks:2", {
    firstD20: "20",
    targetArmorClass: "30"
  }, "two-attacks-2").status, "applied");
  assert.equal(getState().monk.combatAssistant.activeSequences[0].status, "complete");
  assert.equal(recordAttack("two-attacks", "two-attacks:3", {}, "two-attacks-3").status, "rejected");
});

test("bonus attack consumption occurs only on attempt and cannot be repeated in the same turn", () => {
  openFreshSession();
  const before = getState().combat.ki.current;
  const result = recordAttack("bonus-1", "bonus-1:1", {
    kind: "bonus-unarmed",
    triggerConfirmed: true
  }, "bonus-1-op");
  assert.equal(result.status, "applied");
  assert.equal(getState().ui.turn.bonusActionUsed, true);
  assert.equal(getState().combat.ki.current, before);
  const repeat = recordAttack("bonus-2", "bonus-2:1", {
    kind: "bonus-unarmed",
    triggerConfirmed: true
  }, "bonus-2-op");
  assert.equal(repeat.status, "rejected");
});

test("attack damage and Strike are recorded after a hit; target save remains a manual outcome", () => {
  openFreshSession();
  const attack = recordAttack("strike-action", "strike-action:1", {}, "strike-attack-op");
  assert.equal(attack.status, "applied");
  const damage = combatActions.recordAttackDamage(
    getSessionContext(),
    "strike-action",
    "strike-action:1",
    ["4"],
    "strike-damage-op"
  );
  assert.equal(damage.status, "applied");
  assert.equal(getState().monk.combatAssistant.activeSequences[0]
    .resolvedAttacks[0].damageTotalBeforeTargetModifiers, 10);

  const strike = combatActions.applyTechniqueToHit(
    getSessionContext(),
    "strike-action",
    "strike-action:1",
    "ll-monk:slowing-strike",
    { confirmed: true, paymentMode: "ki" },
    "strike-application-op"
  );
  assert.equal(strike.status, "applied");
  const application = getState().monk.combatAssistant.pendingApplications[0];
  assert.equal(application.targetOutcome, "unknown");
  assert.equal(application.dc, 16);
  assert.equal(getState().combat.ki.current, 15);
  const save = combatActions.recordTargetSaveOutcome(
    getSessionContext(),
    application.id,
    "failure",
    "target-save-op"
  );
  assert.equal(save.status, "applied");
  assert.equal(getState().monk.combatAssistant.pendingApplications[0].targetOutcome, "failure");
});

test("Battle deflection and regeneration persist shared HP/resource effects", () => {
  openFreshSession();
  updateSessionState(getSessionContext(), (draft) => {
    draft.combat.hp.current = 20;
    draft.combat.hp.temp = 5;
    return draft;
  });
  const deflection = combatActions.commitDeflection(
    getSessionContext(),
    {
      kind: "melee",
      mode: "weapon-melee",
      incomingDamage: "40",
      deflectRoll: "1",
      applyDamageToSara: true
    },
    "deflection-op"
  );
  assert.equal(deflection.status, "applied");
  assert.equal(deflection.outcome.finalRemainder, 22);
  assert.equal(getState().combat.hp.temp, 0);
  assert.equal(getState().combat.hp.current, 3);

  openFreshSession();
  updateSessionState(getSessionContext(), (draft) => {
    draft.combat.hp.current = 100;
    return draft;
  });
  const regeneration = combatActions.commitRegeneration(
    getSessionContext(),
    "2",
    "regeneration-op"
  );
  assert.equal(regeneration.status, "applied");
  assert.equal(getState().combat.hp.current, 106);
  assert.equal(getState().combat.ki.current, 14);
  assert.equal(getState().ui.turn.actionUsed, true);
});

test("applied-but-unsaved attack remains exactly once and can be saved with retry", () => {
  openFreshSession();
  storageFails = true;
  const result = recordAttack("unsaved-attack", "unsaved-attack:1", {}, "unsaved-op");
  assert.equal(result.status, "applied");
  assert.equal(result.persistence.ok, false);
  assert.equal(getState().ui.turn.actionUsed, true);
  assert.equal(recordAttack("unsaved-attack", "unsaved-attack:1", {}, "unsaved-op").reason, "duplicate-operation");

  storageFails = false;
  assert.equal(retryPersistedState().ok, true);
  const saved = JSON.parse(persisted.get("character-sheet:sara-velaris:v1"));
  assert.equal(saved.ui.turn.actionUsed, true);
});

test("build update refuses a stale proposal without changing the saved build", () => {
  const original = structuredClone(sara);
  original.monk.ordinaryTechniqueIds = original.monk.ordinaryTechniqueIds
    .map((id) => id === "ll-monk:slowing-strike" ? "ll-monk:heavenly-step" : id);
  original.inventory.items = original.inventory.items.filter((item) => item.id !== "insignia-of-claws");
  const proposal = proposeSaraBuildUpdate(original);
  original.inventory.items[0].name = "Modified item";
  const result = applySaraBuildUpdate(original, proposal, {
    techniques: "apply",
    insignia: "add"
  });
  assert.equal(result.status, "rejected");
  assert.equal(original.inventory.items.some((item) => item.id === "insignia-of-claws"), false);
  assert.equal(original.monk.buildUpdateMarkers?.[SARA_BUILD_PATCH_ID], undefined);
});
