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
import { completeSaraRest } from "../../scripts/actions/sara-functional.js";
import { getEligibleAttackProfiles } from "../../scripts/combat/attack-profile-eligibility.js";
import { getCurrentWorkspaceStrikeParent } from "../../scripts/workspace/attack-adapter.js";
import {
  applyGentlingTouchToAttackSlot,
  beginSeekingStrike,
  getUsedAttackSlots,
  resolveSeekingStrike,
} from "../../scripts/actions/sara-combat.js";

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

test("short-rest lifetime distinguishes unpaid preparation from paid Flurry and rejects crafted profiles", () => {
  let context = openFreshSession();
  assert.equal(completeSaraRest(context, {
    id: "rest-preparation",
    restId: "rest-preparation",
    kind: "short",
  }).status, "applied");
  context = getSessionContext();
  assert.equal(combatActions.startAttackSequence(context, {
    sequenceId: "unpaid-preparation",
    kind: "attack-action",
  }, "unpaid-preparation-op").status, "applied");
  assert.equal(getState().monk.functionalRuntime.rest.phase, "hit-dice");

  context = openFreshSession();
  assert.equal(completeSaraRest(context, {
    id: "rest-paid",
    restId: "rest-paid",
    kind: "short",
  }).status, "applied");
  context = getSessionContext();
  assert.equal(combatActions.startAttackSequence(context, {
    sequenceId: "paid-flurry",
    kind: "flurry",
    confirmed: true,
  }, "paid-flurry-op").status, "applied");
  assert.equal(getState().monk.functionalRuntime.rest.phase, "superseded");
  context = getSessionContext();
  const sequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === "paid-flurry");
  const craftedWeapon = combatActions.recordAttackOutcome(context, sequence.id,
    "crafted-weapon", {
      kind: "flurry",
      profileId: "club",
      firstD20: "12",
      targetArmorClass: "10",
    }, "crafted-weapon-op");
  assert.equal(craftedWeapon.status, "rejected");
  assert.equal(sequence.resolvedAttacks.length, 0);

  const profiles = getDerivedStats(getState()).saraAttackProfiles;
  assert.deepEqual(getEligibleAttackProfiles("flurry", profiles).map(([id]) => id), ["unarmed"]);
  assert.equal(getEligibleAttackProfiles("attack-action", profiles)
    .some(([id]) => id === "returnedProjectile"), false);
  assert.equal(combatActions.startAttackSequence(context, {
    sequenceId: "standalone-return",
    kind: "returned-projectile",
    parentId: "fabricated-parent",
    triggerConfirmed: true,
  }, "standalone-return-op").status, "rejected");
});

test("returned projectile requires an exact current continuation and pays once on recorded physical outcome", () => {
  const setupContinuation = (overrides = {}) => {
    let context = openFreshSession();
    const tokenId = "real-return-continuation";
    const token = {
      id: tokenId,
      kind: "missile-return",
      sourceSessionGeneration: context.sessionGeneration,
      reactionAlreadyUsed: true,
      ...overrides,
    };
    if (overrides.wrongSession) token.sourceSessionGeneration += 1;
    delete token.wrongSession;
    const setup = updateSessionState(context, (draft) => {
      draft.monk.techniqueRuntime.deflectContinuation = token;
      return draft;
    }, { operationId: "install-return-continuation", metadata: { kind: "test-setup" } });
    assert.equal(setup.status, "applied");
    context = getSessionContext();
    return { context, tokenId };
  };
  const attempt = (parentId, op, overrides = {}) => {
    const { context } = setupContinuation(overrides);
    return combatActions.recordAttackOutcome(context, `return-sequence-${op}`,
      `return-attack-${op}`, {
      kind: "returned-projectile",
      profileId: "returnedProjectile",
      rollMode: "normal",
      firstD20: "18",
      targetArmorClass: "10",
      sequenceId: `return-sequence-${op}`,
      parentId,
      proficiencyConfirmed: true,
    }, `return-start-${op}`);
  };
  for (const [parent, op, overrides] of [
    [undefined, "missing", {}],
    ["", "empty", {}],
    ["fabricated", "fabricated", {}],
    ["real-return-continuation", "wrong-session", { wrongSession: true }],
    ["real-return-continuation", "wrong-battle", { battleId: "expired-battle" }],
    ["real-return-continuation", "consumed", { consumed: true }],
  ]) {
    const rejected = attempt(parent, op, overrides);
    assert.equal(rejected.status, "rejected");
    assert.match(rejected.reason, /токен|продолжен/i);
    assert.equal(getState().monk.combatAssistant.activeSequences.length, 0);
    assert.equal(getState().monk.techniqueRuntime.deflectContinuation.consumed,
      op === "consumed" ? true : undefined);
  }

  const { context, tokenId } = setupContinuation();
  const beforeKi = getState().combat.ki.current;
  const first = combatActions.recordAttackOutcome(context, "return-sequence-valid",
    "return-attack-one", {
    kind: "returned-projectile",
    profileId: "returnedProjectile",
    rollMode: "normal",
    firstD20: "18",
    targetArmorClass: "10",
    sequenceId: "return-sequence-valid",
    parentId: tokenId,
    proficiencyConfirmed: true,
  }, "return-start-valid");
  assert.equal(first.status, "applied", first.reason);
  assert.equal(getState().combat.ki.current, beforeKi - 1);
  assert.equal(getState().monk.techniqueRuntime.deflectContinuation.consumed, true);
  assert.equal(getState().inventory.items.find((item) => item.id === "darts").quantity, 20);
  assert.equal(getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === "return-sequence-valid").resolvedAttacks[0].damageStatus,
  "awaiting-damage");
  const latest = getSessionContext();
  const repeated = combatActions.recordAttackOutcome(latest, "return-sequence-valid",
    "return-attack-two", {
      kind: "returned-projectile",
      profileId: "returnedProjectile",
      rollMode: "normal",
      firstD20: "18",
      targetArmorClass: "10",
    }, "return-attack-repeat");
  assert.equal(repeated.status, "rejected");
  assert.equal(getState().combat.ki.current, beforeKi - 1);
});

test("returned projectile validates before mutation, survives save retry/load, and uses ordinary pending damage", () => {
  let context = openFreshSession();
  const tokenId = "atomic-return-token";
  const setup = updateSessionState(context, (draft) => {
    draft.combat.ki.current = 0;
    draft.monk.techniqueRuntime.deflectContinuation = {
      id: tokenId,
      kind: "missile-return",
      sourceSessionGeneration: context.sessionGeneration,
      reactionAlreadyUsed: true,
    };
    return draft;
  }, { operationId: "atomic-return-setup", metadata: { kind: "test-setup" } });
  assert.equal(setup.status, "applied");
  context = getSessionContext();
  const makeInput = (firstD20) => ({
    kind: "returned-projectile",
    sequenceId: "atomic-return-sequence",
    parentId: tokenId,
    proficiencyConfirmed: true,
    profileId: "returnedProjectile",
    rollMode: "normal",
    firstD20,
    targetArmorClass: "10",
  });
  const invalidDie = combatActions.recordAttackOutcome(context, "atomic-return-sequence",
    "atomic-return-attack", makeInput(""), "atomic-return-invalid");
  assert.equal(invalidDie.status, "rejected");
  assert.equal(getState().monk.combatAssistant.activeSequences.length, 0);
  assert.equal(getState().monk.techniqueRuntime.deflectContinuation.consumed, undefined);
  const noKi = combatActions.recordAttackOutcome(getSessionContext(),
    "atomic-return-sequence", "atomic-return-attack", makeInput("18"), "atomic-return-no-ki");
  assert.equal(noKi.status, "rejected");
  assert.equal(getState().monk.combatAssistant.activeSequences.length, 0);
  assert.equal(getState().monk.techniqueRuntime.deflectContinuation.consumed, undefined);

  const restored = updateSessionState(getSessionContext(), (draft) => {
    draft.combat.ki.current = 2;
    return draft;
  }, { operationId: "atomic-return-restore-ki", metadata: { kind: "test-setup" } });
  assert.equal(restored.status, "applied");
  const beforeKi = getState().combat.ki.current;
  storageFails = true;
  const applied = combatActions.recordAttackOutcome(getSessionContext(),
    "atomic-return-sequence", "atomic-return-attack", makeInput("18"), "atomic-return-paid");
  assert.equal(applied.status, "applied");
  assert.equal(applied.persistence.ok, false);
  assert.equal(getState().combat.ki.current, beforeKi - 1);
  assert.equal(getState().monk.techniqueRuntime.deflectContinuation.consumed, true);
  const replayAfterFailure = combatActions.recordAttackOutcome(getSessionContext(),
    "atomic-return-sequence", "atomic-return-attack", makeInput("18"),
    "atomic-return-paid");
  assert.equal(replayAfterFailure.status, "rejected");
  assert.equal(getState().combat.ki.current, beforeKi - 1);
  assert.equal(getState().monk.combatAssistant.activeSequences.length, 1);
  storageFails = false;
  assert.equal(retryPersistedState().ok, true);
  assert.equal(openCharacterSession("sara-velaris").status, "loaded");
  const loadedSequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === "atomic-return-sequence");
  assert.equal(loadedSequence.resolvedAttacks.length, 1);
  assert.equal(getState().combat.ki.current, beforeKi - 1);
  const damage = combatActions.recordAttackDamage(getSessionContext(),
    "atomic-return-sequence", "atomic-return-attack", [1], "atomic-return-damage");
  assert.equal(damage.status, "applied", damage.reason);
  assert.equal(getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === "atomic-return-sequence")
    .resolvedAttacks[0].damageStatus, "recorded");
});

test("Seeking Strike is paid from a recorded miss and replaces the same attack with mandatory physical dice", () => {
  let context = openFreshSession();
  const setup = updateSessionState(context, (draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    draft.inventory.items.find((item) => item.id === "club").equipped = true;
    return draft;
  }, { operationId: "select-seeking-strike", metadata: { kind: "test-setup" } });
  assert.equal(setup.status, "applied");
  context = getSessionContext();
  assert.equal(combatActions.startAttackSequence(context, {
    sequenceId: "seeking-sequence", kind: "attack-action",
  }, "seeking-sequence-op").status, "applied");
  context = getSessionContext();
  const miss = combatActions.recordAttackOutcome(context, "seeking-sequence", "recorded-miss", {
    kind: "attack-action", profileId: "club", rollMode: "normal",
    firstD20: "2", targetArmorClass: "30",
  }, "seeking-miss-op");
  assert.equal(miss.status, "applied", miss.reason);
  context = getSessionContext();
  const beforeKi = getState().combat.ki.current;
  assert.equal(beginSeekingStrike(context, "seeking-sequence", "recorded-miss",
    "seeking-paid-op").status, "applied");
  assert.equal(getState().combat.ki.current, beforeKi - 1);
  const duplicatePaid = beginSeekingStrike(getSessionContext(), "seeking-sequence",
    "recorded-miss", "seeking-paid-op");
  assert.equal(duplicatePaid.status, "applied");
  assert.equal(duplicatePaid.replayed, true);
  assert.equal(getState().combat.ki.current, beforeKi - 1);
  const savedAttack = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === "seeking-sequence").resolvedAttacks[0];
  const savedBonus = savedAttack.attackBonusSnapshot;
  assert.equal(openCharacterSession("sara-velaris").status, "loaded");
  updateSessionState(getSessionContext(), (draft) => {
    draft.abilities.dexterity = 8;
    draft.inventory.items.find((item) => item.id === "club").equipped = false;
    draft.ui.turn.turnNumber += 1;
    return draft;
  }, { operationId: "seeking-expire-and-change-stats", metadata: { kind: "test-setup" } });
  context = getSessionContext();
  const missingPhysical = resolveSeekingStrike(context, "seeking-sequence",
    "recorded-miss", { firstD20: "", targetArmorClass: "30" }, "seeking-result-empty");
  assert.equal(missingPhysical.status, "rejected");
  assert.equal(getState().combat.ki.current, beforeKi - 1);
  context = getSessionContext();
  const replacement = resolveSeekingStrike(context, "seeking-sequence",
    "recorded-miss", { firstD20: "19", targetArmorClass: "10" }, "seeking-result-op");
  assert.equal(replacement.status, "applied", replacement.reason);
  const attack = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === "seeking-sequence").resolvedAttacks[0];
  assert.equal(attack.id, "recorded-miss");
  assert.equal(attack.hitResult, "hit");
  assert.equal(attack.attackTotal, 19 + savedBonus);
  assert.equal(attack.damageStatus, "awaiting-damage");
  assert.deepEqual(attack.seekingAmendment.original.rawD20Rolls, [2]);
  assert.equal(attack.seekingAmendment.status, "resolved");
  assert.equal(attack.historicalResolution, true);
  assert.equal(getCurrentWorkspaceStrikeParent(
    getState(), "seeking-sequence", "recorded-miss",
  ), null);
  assert.equal(getState().combat.ki.current, beforeKi - 1);
});

test("Seeking Strike enforces parent battle/turn windows but allows a matching reaction parent", () => {
  let context = openFreshSession();
  updateSessionState(context, (draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    draft.battleConsole.current = {
      id: "seeking-battle-a", phase: "own-turn", ownTurnId: "seeking-turn-a",
    };
    return draft;
  }, { operationId: "seeking-context-setup", metadata: { kind: "test-setup" } });
  context = getSessionContext();
  assert.equal(combatActions.startAttackSequence(context, {
    sequenceId: "seeking-context-sequence", kind: "attack-action",
  }, "seeking-context-start").status, "applied");
  context = getSessionContext();
  assert.equal(recordAttack("seeking-context-sequence", "seeking-context-miss", {
    firstD20: "2", targetArmorClass: "30",
  }, "seeking-context-miss-op").status, "applied");
  const kiBefore = getState().combat.ki.current;

  updateSessionState(getSessionContext(), (draft) => {
    draft.battleConsole.current.id = "seeking-battle-b";
    return draft;
  }, { operationId: "seeking-wrong-battle", metadata: { kind: "test-setup" } });
  assert.equal(beginSeekingStrike(getSessionContext(), "seeking-context-sequence",
    "seeking-context-miss", "seeking-wrong-battle-op").status, "rejected");
  assert.equal(getState().combat.ki.current, kiBefore);

  updateSessionState(getSessionContext(), (draft) => {
    draft.battleConsole.current.id = "seeking-battle-a";
    draft.ui.turn.turnNumber += 1;
    return draft;
  }, { operationId: "seeking-wrong-turn", metadata: { kind: "test-setup" } });
  assert.equal(beginSeekingStrike(getSessionContext(), "seeking-context-sequence",
    "seeking-context-miss", "seeking-wrong-turn-op").status, "rejected");
  updateSessionState(getSessionContext(), (draft) => {
    draft.ui.turn.turnNumber -= 1;
    draft.battleConsole.current.phase = "waiting";
    return draft;
  }, { operationId: "seeking-ended-turn", metadata: { kind: "test-setup" } });
  assert.equal(beginSeekingStrike(getSessionContext(), "seeking-context-sequence",
    "seeking-context-miss", "seeking-ended-turn-op").status, "rejected");
  assert.equal(getState().combat.ki.current, kiBefore);

  context = openFreshSession();
  updateSessionState(context, (draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    draft.battleConsole.current = {
      id: "seeking-reaction-battle", phase: "waiting", ownTurnId: null,
    };
    return draft;
  }, { operationId: "seeking-reaction-setup", metadata: { kind: "test-setup" } });
  assert.equal(combatActions.startAttackSequence(getSessionContext(), {
    sequenceId: "seeking-reaction-sequence", kind: "reaction-unarmed",
    triggerConfirmed: true,
  }, "seeking-reaction-start").status, "applied");
  assert.equal(recordAttack("seeking-reaction-sequence", "seeking-reaction-miss", {
    kind: "reaction-unarmed", firstD20: "2", targetArmorClass: "30",
  }, "seeking-reaction-miss-op").status, "applied");
  const reactionKi = getState().combat.ki.current;
  const reactionStart = beginSeekingStrike(getSessionContext(),
    "seeking-reaction-sequence", "seeking-reaction-miss", "seeking-reaction-seeking");
  assert.equal(reactionStart.status, "applied", reactionStart.reason);
  assert.equal(getState().combat.ki.current, reactionKi - 1);
});

test("unknown AC remains null when an explicit master miss is supplied", () => {
  openFreshSession();
  const result = combatActions.recordAttackOutcome(getSessionContext(),
    "unknown-ac-sequence", "unknown-ac-attack", {
      kind: "attack-action", profileId: "unarmed", rollMode: "normal",
      firstD20: "12", targetArmorClass: "", dmHitResult: "miss",
    }, "unknown-ac-operation");
  assert.equal(result.status, "applied", result.reason);
  assert.equal(getState().monk.combatAssistant.activeSequences[0]
    .resolvedAttacks[0].targetArmorClass, null);
});

test("a resolved Seeking miss may start a new paid invocation without replaying the old payment", () => {
  let context = openFreshSession();
  updateSessionState(context, (draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:seeking-strike";
    return draft;
  }, { operationId: "seeking-repeat-setup", metadata: { kind: "test-setup" } });
  assert.equal(combatActions.startAttackSequence(getSessionContext(), {
    sequenceId: "seeking-repeat-sequence", kind: "attack-action",
  }, "seeking-repeat-start").status, "applied");
  assert.equal(recordAttack("seeking-repeat-sequence", "seeking-repeat-attack", {
    firstD20: "2", targetArmorClass: "30",
  }, "seeking-repeat-miss").status, "applied");
  const startingKi = getState().combat.ki.current;
  assert.equal(beginSeekingStrike(getSessionContext(), "seeking-repeat-sequence",
    "seeking-repeat-attack", "seeking-invocation-one").status, "applied");
  const paidKi = getState().combat.ki.current;
  assert.equal(paidKi, startingKi - 1);
  const resolved = resolveSeekingStrike(getSessionContext(), "seeking-repeat-sequence",
    "seeking-repeat-attack", {
      firstD20: "3", targetArmorClass: "30",
    }, "seeking-invocation-one-result");
  assert.equal(resolved.status, "applied", resolved.reason);
  assert.equal(getState().combat.ki.current, paidKi);
  const duplicate = beginSeekingStrike(getSessionContext(), "seeking-repeat-sequence",
    "seeking-repeat-attack", "seeking-invocation-one");
  assert.equal(duplicate.replayed, true);
  assert.equal(getState().combat.ki.current, paidKi);
  const next = beginSeekingStrike(getSessionContext(), "seeking-repeat-sequence",
    "seeking-repeat-attack", "seeking-invocation-two");
  assert.equal(next.status, "applied", next.reason);
  assert.equal(getState().combat.ki.current, paidKi - 1);
  const attack = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === "seeking-repeat-sequence").resolvedAttacks[0];
  assert.equal(attack.seekingAmendments.length, 2);
  assert.equal(attack.seekingAmendments[0].status, "resolved");
  assert.equal(attack.seekingAmendments[1].status, "awaiting-replacement");
});

test("Gentling Touch atomically replaces one live Attack slot by physical dice sum", () => {
  let context = openFreshSession();
  const setup = updateSessionState(context, (draft) => {
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:gentling-touch";
    return draft;
  }, { operationId: "select-gentling-touch", metadata: { kind: "test-setup" } });
  assert.equal(setup.status, "applied");
  context = getSessionContext();
  assert.equal(combatActions.startAttackSequence(context, {
    sequenceId: "gentling-sequence", kind: "attack-action",
  }, "gentling-sequence-op").status, "applied");
  context = getSessionContext();
  const firstSlot = combatActions.recordAttackOutcome(context, "gentling-sequence",
    "gentling-first-attack", {
      kind: "attack-action", profileId: "unarmed", rollMode: "normal",
      firstD20: "2", targetArmorClass: "30",
    }, "gentling-first-attack-op");
  assert.equal(firstSlot.status, "applied", firstSlot.reason);
  context = getSessionContext();
  const beforeKi = getState().combat.ki.current;
  const dieCount = 6;
  const sides = getDerivedStats(getState()).monk.martialDieSides;
  const applied = applyGentlingTouchToAttackSlot(context, "gentling-sequence", {
    extraKi: "1",
    targetHp: "7",
    sum: String(dieCount * sides),
  }, "gentling-slot-op");
  assert.equal(applied.status, "applied", applied.reason);
  const sequence = getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === "gentling-sequence");
  assert.equal(sequence.resolvedAttacks.length, 1);
  assert.equal(sequence.replacementResults.length, 1);
  assert.equal(sequence.replacementResults[0].sum, dieCount * sides);
  assert.equal(sequence.replacementResults[0].thresholdMet, true);
  assert.equal(sequence.replacementResults[0].dice, dieCount);
  assert.equal(sequence.replacementResults[0].slotNumber, 2);
  assert.equal(getState().ui.turn.actionUsed, true);
  assert.equal(getState().combat.ki.current, beforeKi - 2);
  assert.equal(openCharacterSession("sara-velaris").status, "loaded");
  const replay = applyGentlingTouchToAttackSlot(getSessionContext(), "gentling-sequence", {
    extraKi: "1", targetHp: "7", sum: String(dieCount * sides),
  }, "gentling-slot-op");
  assert.equal(replay.status, "applied");
  assert.equal(replay.replayed, true);
  const mismatchedReplay = applyGentlingTouchToAttackSlot(getSessionContext(),
    "gentling-sequence", {
      extraKi: "0", targetHp: "7", sum: String(dieCount * sides),
    }, "gentling-slot-op");
  assert.equal(mismatchedReplay.status, "rejected");
  assert.equal(getState().combat.ki.current, beforeKi - 2);
});

test("two Gentling replacements consume both Attack slots and reject a third ordinary attack", () => {
  let context = openFreshSession();
  const setup = updateSessionState(context, (draft) => {
    draft.profile.level = 5;
    draft.monk.ordinaryTechniqueIds[0] = "ll-monk:gentling-touch";
    return draft;
  }, { operationId: "two-gentling-setup", metadata: { kind: "test-setup" } });
  assert.equal(setup.status, "applied");
  context = getSessionContext();
  assert.equal(combatActions.startAttackSequence(context, {
    sequenceId: "two-gentling-sequence", kind: "attack-action",
  }, "two-gentling-start").status, "applied");
  let state = getState();
  const sides = getDerivedStats(state).monk.martialDieSides;
  for (let slot = 1; slot <= 2; slot += 1) {
    const result = applyGentlingTouchToAttackSlot(getSessionContext(),
      "two-gentling-sequence", {
        extraKi: "0", targetHp: "7", sum: "5",
      }, `two-gentling-slot-${slot}`);
    assert.equal(result.status, "applied", result.reason);
    state = getState();
  }
  const sequence = state.monk.combatAssistant.activeSequences
    .find((entry) => entry.id === "two-gentling-sequence");
  assert.equal(sequence.replacementResults.length, 2);
  assert.deepEqual(sequence.replacementResults.map((entry) => entry.slotNumber), [1, 2]);
  assert.equal(sequence.status, "complete");
  assert.equal(getUsedAttackSlots(sequence), sequence.maximumAttacks);
  const third = combatActions.recordAttackOutcome(getSessionContext(),
    "two-gentling-sequence", "forbidden-third", {
      kind: "attack-action", profileId: "unarmed", rollMode: "normal",
      firstD20: "12", dmHitResult: "miss",
    }, "forbidden-third-op");
  assert.equal(third.status, "rejected");
  assert.equal(getState().monk.combatAssistant.activeSequences
    .find((entry) => entry.id === sequence.id).resolvedAttacks.length, 0);
  assert.ok(sides > 0);
});

test("melee Martial Arts weapon hit can use an eligible Strike while ranged attacks cannot", () => {
  let context = openFreshSession();
  const changed = updateSessionState(context, (draft) => {
    draft.inventory.items.find((item) => item.id === "club").equipped = true;
    draft.monk.ordinaryTechniqueIds.push("ll-monk:empowered-strike");
    return draft;
  }, { operationId: "equip-club-for-strike", metadata: { kind: "test-setup" } });
  assert.equal(changed.status, "applied");
  context = getSessionContext();
  const profiles = getDerivedStats(getState()).saraAttackProfiles;
  assert.equal(profiles.club.melee, true);
  assert.equal(profiles.club.martialArtsEligible, true);
  assert.equal(combatActions.startAttackSequence(context, {
    sequenceId: "club-sequence", kind: "attack-action",
  }, "club-sequence-op").status, "applied");
  context = getSessionContext();
  const clubHit = combatActions.recordAttackOutcome(context, "club-sequence", "club-hit", {
    kind: "attack-action",
    profileId: "club",
    rollMode: "normal",
    firstD20: "18",
    targetArmorClass: "10",
  }, "club-hit-op");
  assert.equal(clubHit.status, "applied", clubHit.reason);
  context = getSessionContext();
  assert.equal(combatActions.recordAttackDamage(context, "club-sequence", "club-hit",
    ["4"], "club-damage-op").status, "applied");
  context = getSessionContext();
  assert.equal(combatActions.applyTechniqueToHit(context, "club-sequence", "club-hit",
    "ll-monk:empowered-strike", { confirmed: true, paymentMode: "ki" },
    "club-strike-op").status, "applied");

  context = openFreshSession();
  const dart = updateSessionState(context, (draft) => {
    draft.inventory.items.find((item) => item.id === "darts").equipped = true;
    draft.monk.ordinaryTechniqueIds.push("ll-monk:empowered-strike");
    return draft;
  }, { operationId: "equip-dart-for-strike", metadata: { kind: "test-setup" } });
  assert.equal(dart.status, "applied");
  context = getSessionContext();
  assert.equal(combatActions.startAttackSequence(context, {
    sequenceId: "dart-sequence", kind: "attack-action",
  }, "dart-sequence-op").status, "applied");
  context = getSessionContext();
  assert.equal(combatActions.recordAttackOutcome(context, "dart-sequence", "dart-hit", {
    kind: "attack-action",
    profileId: "darts",
    rollMode: "normal",
    firstD20: "18",
    targetArmorClass: "10",
  }, "dart-hit-op").status, "applied");
  context = getSessionContext();
  assert.equal(combatActions.recordAttackDamage(context, "dart-sequence", "dart-hit",
    ["4"], "dart-damage-op").status, "applied");
  context = getSessionContext();
  assert.equal(combatActions.applyTechniqueToHit(context, "dart-sequence", "dart-hit",
    "ll-monk:empowered-strike", { confirmed: true, paymentMode: "ki" },
    "dart-strike-op").status, "rejected");
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
