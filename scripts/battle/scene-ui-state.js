const states = new WeakMap();
const panels = new Set([
  "home", "abilities", "action", "bonus", "tools", "incoming",
  "other-events", "initiative-start", "initiative-correct",
]);

function ownerKey(owner) {
  return JSON.stringify([owner?.characterId ?? null, owner?.sessionGeneration ?? null]);
}

function createState(owner, sceneKey) {
  return {
    ownerKey: ownerKey(owner),
    sceneKey,
    revision: 0,
    panel: "home",
    initiativeDraft: { rawD20: "", battleId: null },
    error: "",
  };
}

export function getSceneUiState(root, owner, sceneKey) {
  if (!root || (typeof root !== "object" && typeof root !== "function")) {
    throw new TypeError("A root element is required.");
  }
  const identity = ownerKey(owner);
  let state = states.get(root);
  if (!state || state.ownerKey !== identity || state.sceneKey !== sceneKey) {
    state = createState(owner, sceneKey);
    states.set(root, state);
  }
  return { ...state, initiativeDraft: { ...state.initiativeDraft } };
}

export function dispatchSceneUi(root, owner, sceneKey, action) {
  const current = getSceneUiState(root, owner, sceneKey);
  if (!action || typeof action !== "object" ||
      !["set-panel", "set-draft", "set-error", "clear-error", "open-initiative"].includes(action.type)) {
    return current;
  }
  const next = { ...current, initiativeDraft: { ...current.initiativeDraft } };
  if (action.type === "set-panel") {
    if (!panels.has(action.panel)) return current;
    next.panel = action.panel;
    if (action.panel === "home") {
      next.initiativeDraft = { rawD20: "", battleId: null };
      next.error = "";
    }
    next.revision += 1;
  } else if (action.type === "set-draft") {
    if (typeof action.rawD20 !== "string") return current;
    next.initiativeDraft.rawD20 = action.rawD20;
  } else if (action.type === "open-initiative") {
    if (!["start", "correct"].includes(action.mode) ||
        typeof action.rawD20 !== "string" ||
        (action.mode === "start" && action.battleId !== null) ||
        (action.mode === "correct" &&
          (typeof action.battleId !== "string" || !action.battleId.trim()))) return current;
    next.panel = action.mode === "start" ? "initiative-start" : "initiative-correct";
    next.initiativeDraft = {
      rawD20: action.rawD20,
      battleId: action.battleId,
    };
    next.error = "";
    next.revision += 1;
  } else if (action.type === "set-error") {
    if (typeof action.error !== "string") return current;
    next.error = action.error;
    next.revision += 1;
  } else {
    next.error = "";
    next.revision += 1;
  }
  states.set(root, next);
  return { ...next, initiativeDraft: { ...next.initiativeDraft } };
}

export function resetSceneUi(root) {
  if (root && (typeof root === "object" || typeof root === "function")) states.delete(root);
}
