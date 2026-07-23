export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function ensureUiState(draft) {
  if (!draft.ui || typeof draft.ui !== "object") {
    draft.ui = {};
  }

  if (!draft.ui.spellLibrary || typeof draft.ui.spellLibrary !== "object") {
    draft.ui.spellLibrary = {
      selectedLevel: "all",
      expandedSpellIds: [],
    };
  }

  if (typeof draft.ui.hpAdjustAmount !== "number") {
    draft.ui.hpAdjustAmount = 0;
  }

  return draft.ui;
}

export function ensureCombatState(draft) {
  if (!draft.combat || typeof draft.combat !== "object") {
    draft.combat = {};
  }

  if (!draft.combat.hp || typeof draft.combat.hp !== "object") {
    draft.combat.hp = {
      current: 0,
      temp: 0,
      maxOverride: null,
    };
  }

  if (!draft.combat.bardicInspiration || typeof draft.combat.bardicInspiration !== "object") {
    draft.combat.bardicInspiration = {
      current: 0,
      refresh: "Долгий отдых",
      rangeFeet: 60,
      rangeMeters: 18,
      duration: "10 минут",
      notes: "",
    };
  }

  return draft.combat;
}

export function ensureInventoryState(draft) {
  if (!draft.inventory || typeof draft.inventory !== "object") {
    draft.inventory = {};
  }

  if (!Array.isArray(draft.inventory.items)) {
    draft.inventory.items = [];
  }

  return draft.inventory;
}

export function ensureTurnState(draft) {
  const ui = ensureUiState(draft);

  if (!ui.turn || typeof ui.turn !== "object") {
    ui.turn = {
      actionUsed: false,
      bonusActionUsed: false,
      reactionUsed: false,
      turnNumber: 1,
    };
  }

  return ui.turn;
}

export function ensureSpellcastingState(draft) {
  if (!draft.spellcasting || typeof draft.spellcasting !== "object") {
    draft.spellcasting = {};
  }

  if (!draft.spellcasting.slotsUsed || typeof draft.spellcasting.slotsUsed !== "object") {
    draft.spellcasting.slotsUsed = {};
  }

  if (!Array.isArray(draft.spellcasting.cantripIds)) {
    draft.spellcasting.cantripIds = [];
  }

  if (!Array.isArray(draft.spellcasting.preparedSpellIds)) {
    draft.spellcasting.preparedSpellIds = [];
  }

  if (!Array.isArray(draft.spellcasting.grantedSpellIds)) {
    draft.spellcasting.grantedSpellIds = [];
  }

  if (!draft.spellcasting.spellOverrides || typeof draft.spellcasting.spellOverrides !== "object") {
    draft.spellcasting.spellOverrides = {};
  }

  return draft.spellcasting;
}

export function ensureEffectsState(draft) {
  const ui = ensureUiState(draft);

  if (!Array.isArray(ui.activeEffects)) {
    ui.activeEffects = [];
  }

  return ui.activeEffects;
}

export function ensureRulesOverridesState(draft) {
  const ui = ensureUiState(draft);

  if (!ui.rulesOverrides || typeof ui.rulesOverrides !== "object") {
    ui.rulesOverrides = {};
  }

  return ui.rulesOverrides;
}