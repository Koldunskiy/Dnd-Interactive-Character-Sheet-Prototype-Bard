function createOperationId(prefix) {
  return globalThis.crypto?.randomUUID?.() ??
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createIncomingEventDraft(state, owner, options = {}) {
  const battle = state.battleConsole?.current ?? null;
  const source = ["melee", "projectile", "spell"].includes(options.source)
    ? options.source : null;
  const directDamage = options.mode === "direct-damage";
  const eventId = createOperationId("incoming-event");
  return {
    eventId,
    owner: {
      characterId: owner.characterId,
      sessionGeneration: owner.sessionGeneration,
    },
    battleId: battle?.id ?? null,
    phaseAtOpen: battle?.phase ?? "outside",
    ownTurnIdAtOpen: battle?.ownTurnId ?? null,
    stage: directDamage ? "damage" : "outcome",
    outcome: null,
    source: directDamage ? "direct" : source,
    mode: directDamage ? "direct-damage" : null,
    rawDamage: "",
    rawDeflectRoll: "",
    catchChoice: null,
    rollDraft: {
      amendment: null,
      baseOutcome: null,
      amendedOutcome: null,
    },
    replyDraft: {},
    operationIds: {
      apply: createOperationId("incoming-apply"),
      save: createOperationId("incoming-save"),
      reply: createOperationId("incoming-reply"),
      decline: createOperationId("incoming-decline"),
    },
    appliedReceipt: null,
    error: "",
  };
}

export function incomingContextIsCurrent(draft, state, owner) {
  if (!draft || owner?.characterId !== draft.owner.characterId ||
      owner?.sessionGeneration !== draft.owner.sessionGeneration ||
      state?.profile?.id !== "sara-velaris") return false;
  const battle = state.battleConsole?.current ?? null;
  if (draft.battleId == null) return battle == null;
  return battle?.id === draft.battleId &&
    ["waiting", "own-turn"].includes(battle.phase) &&
    battle.phase === draft.phaseAtOpen &&
    battle.ownTurnId === draft.ownTurnIdAtOpen;
}
