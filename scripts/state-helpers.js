export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function ensureUiState(draft) {
  if (!draft.ui || typeof draft.ui !== "object") {
    draft.ui = {};
  }

  if (!draft.ui.spellLibrary || typeof draft.ui.spellLibrary !== "object") {
    draft.ui.spellLibrary = {};
  }

  const spellLibrary = draft.ui.spellLibrary;

  if (typeof spellLibrary.selectedLevel !== "string") {
    spellLibrary.selectedLevel = "all";
  }

  if (typeof spellLibrary.selectionFilter !== "string") {
    spellLibrary.selectionFilter = "all";
  }

  if (typeof spellLibrary.schoolFilter !== "string") {
    spellLibrary.schoolFilter = "all";
  }

  if (typeof spellLibrary.searchQuery !== "string") {
    spellLibrary.searchQuery = "";
  }

  if (typeof spellLibrary.concentrationOnly !== "boolean") {
    spellLibrary.concentrationOnly = false;
  }

  if (typeof spellLibrary.ritualOnly !== "boolean") {
    spellLibrary.ritualOnly = false;
  }

  if (typeof spellLibrary.availableOnly !== "boolean") {
    spellLibrary.availableOnly = false;
  }

  if (!Array.isArray(spellLibrary.expandedSpellIds)) {
    spellLibrary.expandedSpellIds = [];
  }

  if (!Array.isArray(spellLibrary.expandedSpellIds)) {
    spellLibrary.expandedSpellIds = [];
  }

  if (!Array.isArray(draft.ui.spellLibrary.expandedSpellIds)) {
    draft.ui.spellLibrary.expandedSpellIds = [];
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

  if (typeof draft.combat.concentration !== "string") {
    draft.combat.concentration = "";
  }

  if (typeof draft.combat.initiativeBonusExtra !== "number") {
    draft.combat.initiativeBonusExtra = 0;
  }

  if (typeof draft.combat.armorBonusExtra !== "number") {
    draft.combat.armorBonusExtra = 0;
  }

  if (typeof draft.combat.shieldBonus !== "number") {
    draft.combat.shieldBonus = 0;
  }

  if (!Number.isFinite(Number(draft.combat.hp.current))) {
    draft.combat.hp.current = 0;
  } else {
    draft.combat.hp.current = Number(draft.combat.hp.current);
  }

  if (!Number.isFinite(Number(draft.combat.hp.temp))) {
    draft.combat.hp.temp = 0;
  } else {
    draft.combat.hp.temp = Number(draft.combat.hp.temp);
  }

  if (
    draft.combat.hp.maxOverride != null &&
    draft.combat.hp.maxOverride !== "" &&
    !Number.isFinite(Number(draft.combat.hp.maxOverride))
  ) {
    draft.combat.hp.maxOverride = null;
  }

  if (!Number.isFinite(Number(draft.combat.bardicInspiration.current))) {
    draft.combat.bardicInspiration.current = 0;
  } else {
    draft.combat.bardicInspiration.current = Number(draft.combat.bardicInspiration.current);
  }

  if (!Number.isFinite(Number(draft.combat.bardicInspiration.rangeFeet))) {
    draft.combat.bardicInspiration.rangeFeet = 60;
  } else {
    draft.combat.bardicInspiration.rangeFeet = Number(draft.combat.bardicInspiration.rangeFeet);
  }

  if (!Number.isFinite(Number(draft.combat.bardicInspiration.rangeMeters))) {
    draft.combat.bardicInspiration.rangeMeters = 18;
  } else {
    draft.combat.bardicInspiration.rangeMeters = Number(draft.combat.bardicInspiration.rangeMeters);
  }

  if (typeof draft.combat.bardicInspiration.refresh !== "string") {
    draft.combat.bardicInspiration.refresh = "Долгий отдых";
  }

  if (typeof draft.combat.bardicInspiration.duration !== "string") {
    draft.combat.bardicInspiration.duration = "10 минут";
  }

  if (typeof draft.combat.bardicInspiration.notes !== "string") {
    draft.combat.bardicInspiration.notes = "";
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

  if (!draft.inventory.currency || typeof draft.inventory.currency !== "object") {
    draft.inventory.currency = {
      cp: 0,
      sp: 0,
      ep: 0,
      gp: 0,
      pp: 0,
    };
  }

  if (typeof draft.inventory.notes !== "string") {
    draft.inventory.notes = "";
  }

  draft.inventory.items = draft.inventory.items.map((item, index) => {
    const safeItem = item && typeof item === "object" ? item : {};

    const weapon =
      safeItem.weapon && typeof safeItem.weapon === "object"
        ? {
            category: safeItem.weapon.category ?? null,
            attackStat: safeItem.weapon.attackStat ?? "strength",
            damageDice: safeItem.weapon.damageDice ?? "—",
            damageType: safeItem.weapon.damageType ?? "—",
            properties: Array.isArray(safeItem.weapon.properties) ? safeItem.weapon.properties : [],
            range: safeItem.weapon.range ?? null,
            twoHanded: Boolean(safeItem.weapon.twoHanded),
            finesse: Boolean(safeItem.weapon.finesse),
            thrown: Boolean(safeItem.weapon.thrown),
            magicalBonusAttack: Number.isFinite(Number(safeItem.weapon.magicalBonusAttack))
              ? Number(safeItem.weapon.magicalBonusAttack)
              : 0,
            magicalBonusDamage: Number.isFinite(Number(safeItem.weapon.magicalBonusDamage))
              ? Number(safeItem.weapon.magicalBonusDamage)
              : 0,
          }
        : null;

    const armor =
      safeItem.armor && typeof safeItem.armor === "object"
        ? {
            category: safeItem.armor.category ?? "light",
            baseAc: Number.isFinite(Number(safeItem.armor.baseAc))
              ? Number(safeItem.armor.baseAc)
              : 10,
            dexCap:
              safeItem.armor.dexCap == null || safeItem.armor.dexCap === ""
                ? null
                : Number.isFinite(Number(safeItem.armor.dexCap))
                  ? Number(safeItem.armor.dexCap)
                  : null,
            magicalBonusAc: Number.isFinite(Number(safeItem.armor.magicalBonusAc))
              ? Number(safeItem.armor.magicalBonusAc)
              : 0,
          }
        : null;

    const focus =
      safeItem.focus && typeof safeItem.focus === "object"
        ? {
            classes: Array.isArray(safeItem.focus.classes) ? safeItem.focus.classes : [],
            notes: safeItem.focus.notes ?? "",
          }
        : null;

    const consumable =
      safeItem.consumable && typeof safeItem.consumable === "object"
        ? {
            effect: safeItem.consumable.effect ?? "",
            formula: safeItem.consumable.formula ?? "",
          }
        : null;

    const inferredType = weapon
      ? "weapon"
      : armor
        ? "armor"
        : consumable
          ? "consumable"
          : focus
            ? "focus"
            : "misc";

    const type =
      typeof safeItem.type === "string" && safeItem.type.trim()
        ? safeItem.type
        : inferredType;

    return {
      id: safeItem.id ?? `item-${index + 1}`,
      type,
      name: safeItem.name ?? "",
      quantity: Number.isFinite(Number(safeItem.quantity)) ? Number(safeItem.quantity) : 1,
      stackable: Boolean(safeItem.stackable),
      equipped: Boolean(safeItem.equipped),
      notes: safeItem.notes ?? "",
      tags: Array.isArray(safeItem.tags) ? safeItem.tags : [],
      weapon,
      armor,
      focus,
      consumable,
      uses: safeItem.uses ?? null,
      charges: safeItem.charges ?? null,
    };
  });

  return draft.inventory;
}

export function ensureTurnState(draft) {
  const ui = ensureUiState(draft);

  if (!ui.turn || typeof ui.turn !== "object") {
    ui.turn = {};
  }

  if (typeof ui.turn.actionUsed !== "boolean") {
    ui.turn.actionUsed = false;
  }

  if (typeof ui.turn.bonusActionUsed !== "boolean") {
    ui.turn.bonusActionUsed = false;
  }

  if (typeof ui.turn.reactionUsed !== "boolean") {
    ui.turn.reactionUsed = false;
  }

  if (!Number.isFinite(Number(ui.turn.turnNumber))) {
    ui.turn.turnNumber = 1;
  } else {
    ui.turn.turnNumber = Math.max(1, Number(ui.turn.turnNumber));
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

export function ensureSpellsUiState(draft) {
  const ui = ensureUiState(draft);

  if (!ui.spells || typeof ui.spells !== "object") {
    ui.spells = {
      expandedSpellIds: [],
    };
  }

  if (!Array.isArray(ui.spells.expandedSpellIds)) {
    ui.spells.expandedSpellIds = [];
  }

  return ui.spells;
}

export function ensureMeleeUiState(draft) {
  const ui = ensureUiState(draft);

  if (!ui.melee || typeof ui.melee !== "object") {
    ui.melee = {
      expandedCardIds: [],
    };
  }

  if (!Array.isArray(ui.melee.expandedCardIds)) {
    ui.melee.expandedCardIds = [];
  }

  return ui.melee;
}

export function ensureInventoryUiState(draft) {
  const ui = ensureUiState(draft);

  if (!ui.inventory || typeof ui.inventory !== "object") {
    ui.inventory = {
      expandedItemIds: [],
    };
  }

  if (!Array.isArray(ui.inventory.expandedItemIds)) {
    ui.inventory.expandedItemIds = [];
  }

  return ui.inventory;
}