export function isAttackProfileEligible(sequenceKind, profileId, profiles, state = null) {
  if (!profiles || !Object.hasOwn(profiles, profileId)) return false;
  if (sequenceKind === "returned-projectile") {
    const continuation = state?.monk?.techniqueRuntime?.deflectContinuation;
    return profileId === "returnedProjectile" &&
      continuation?.kind === "missile-return" &&
      typeof continuation.id === "string";
  }
  if (profileId === "returnedProjectile") return false;
  if (["flurry", "bonus-unarmed", "reaction-unarmed"].includes(sequenceKind)) {
    return profileId === "unarmed";
  }
  return sequenceKind === "attack-action";
}

export function getEligibleAttackProfiles(sequenceKind, profiles, state = null) {
  return Object.entries(profiles ?? {})
    .filter(([id]) => isAttackProfileEligible(sequenceKind, id, profiles, state));
}
