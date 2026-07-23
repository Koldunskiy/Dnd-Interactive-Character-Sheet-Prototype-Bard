import { getDerivedStats } from "./calculations.js";
import {
  clamp,
  ensureCombatState,
  ensureEffectsState,
  ensureInventoryState,
  ensureRulesOverridesState,
  ensureSpellcastingState,
  ensureTurnState,
  ensureUiState,
} from "./state-helpers.js";
import {
  isCantripSelected,
  isPreparedSpellSelected,
  isGrantedSpell,
} from "./selectors/spellcasting.js";
import {
  getBardCantripLimit,
  getBardPreparedSpellLimit,
} from "./rules.js";
import { buildCharacterSpellCollections, BARD_SPELL_LIBRARY_BY_ID } from "./selectors/spellcasting.js";


export const STATELESS_ACTIONS = new Set(["print-sheet", "reset-runtime"]);

function buildRuntimeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toRuntimeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("’", "'")
    .replace(/[^a-zа-яё0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function getMaxHp(derived) {
  return Number(derived.maxHitPoints ?? derived.maxHp ?? 0);
}

function findSpellByActionId(spells, spellId) {
  return spells.find((entry) => String(entry.id) === String(spellId));
}

function spendSpellSlotIfAvailable(draft, spellLevel) {
  if (spellLevel <= 0) {
    return true;
  }

  const spellcasting = ensureSpellcastingState(draft);
  const derived = getDerivedStats(draft);
  const slotState = (derived.spellSlots || []).find(
    (slot) => Number(slot.level) === Number(spellLevel)
  );

  if (!slotState || Number(slotState.available) <= 0) {
    return false;
  }

  const used = Number(spellcasting.slotsUsed[spellLevel] || 0);
  spellcasting.slotsUsed[spellLevel] = used + 1;
  return true;
}

function markTurnConsumption(draft, castTime) {
  const turn = ensureTurnState(draft);

  if (String(castTime || "").toLowerCase().includes("бонусное действие")) {
    turn.bonusActionUsed = true;
    return;
  }

  turn.actionUsed = true;
}

function handleHpChange(draft, target) {
  const delta = Number(target.dataset.delta || 0);
  const combat = ensureCombatState(draft);
  const derived = getDerivedStats(draft);
  const nextValue = Number(combat.hp.current || 0) + delta;

  combat.hp.current = clamp(nextValue, 0, getMaxHp(derived));
}

function handleHpReset(draft) {
  const combat = ensureCombatState(draft);
  const derived = getDerivedStats(draft);

  combat.hp.current = getMaxHp(derived);
  combat.hp.temp = 0;
}

function handleToggleAbilitiesEdit(draft) {
  const ui = ensureUiState(draft);
  ui.abilitiesEditable = !Boolean(ui.abilitiesEditable);
}

function handleInventoryAddItem(draft) {
  const inventory = ensureInventoryState(draft);

  inventory.items.push({
    id: buildRuntimeId("item"),
    name: "",
    quantity: 1,
    equipped: false,
    notes: "",
  });
}

function handleInventoryRemoveItem(draft, target) {
  const itemId = target.dataset.itemId;
  const inventory = ensureInventoryState(draft);

  inventory.items = inventory.items.filter((item) => item.id !== itemId);
}

function handleLongRest(draft) {
  const combat = ensureCombatState(draft);
  const turn = ensureTurnState(draft);
  const spellcasting = ensureSpellcastingState(draft);
  const effects = ensureEffectsState(draft);
  const derived = getDerivedStats(draft);

  turn.actionUsed = false;
  turn.bonusActionUsed = false;
  turn.reactionUsed = false;
  turn.turnNumber = 1;

  if (draft.spellcasting?.spellOverrides && typeof draft.spellcasting.spellOverrides === "object") {
    Object.values(draft.spellcasting.spellOverrides).forEach((spell) => {
      if (spell?.uses?.max != null) {
        spell.uses.current = Number(spell.uses.max || 0);
      }
    });
  }

  combat.hp.current = getMaxHp(derived);
  combat.hp.temp = 0;
  const bardic = combat.bardicInspiration;
  if (bardic) {
    bardic.current = Number(derived.bardicInspiration?.max || 0);
    }
  combat.concentration = "";

  const nextSlotsUsed = {};
  for (const slot of derived.spellSlots || []) {
    nextSlotsUsed[slot.level] = 0;
  }
  spellcasting.slotsUsed = nextSlotsUsed;

  effects.length = 0;
}

function handleResetRuntime(resetState) {
  resetState();
}

function handleShortRest(draft) {
  const combat = ensureCombatState(draft);
  const turn = ensureTurnState(draft);
  const effects = ensureEffectsState(draft);

  turn.actionUsed = false;
  turn.bonusActionUsed = false;
  turn.reactionUsed = false;

  combat.hp.temp = 0;
  combat.concentration = "";

  const retained = effects.filter((effect) => effect.durationType !== "until-short-rest");
  effects.length = 0;
  effects.push(...retained);
}

function handleConcentrationClear(draft) {
  const combat = ensureCombatState(draft);
  combat.concentration = "";
}

function handleEffectAdd(draft) {
  const effects = ensureEffectsState(draft);
  const combat = ensureCombatState(draft);

  effects.push({
    id: buildRuntimeId("effect"),
    name: "Новый эффект",
    source: combat.concentration || "Ручной эффект",
    duration: "До конца сцены",
    durationType: "custom",
    notes: "",
  });
}

function handleEffectRemove(draft, target) {
  const effectId = target.dataset.effectId;
  const effects = ensureEffectsState(draft);
  const retained = effects.filter((effect) => effect.id !== effectId);

  effects.length = 0;
  effects.push(...retained);
}

function handleAbilityAdjust(draft, target) {
  const abilityId = target.dataset.abilityId;
  const delta = Number(target.dataset.delta || 0);

  if (!abilityId || typeof draft.abilities?.[abilityId] !== "number") {
    return;
  }

  draft.abilities[abilityId] = clamp((draft.abilities[abilityId] || 0) + delta, 8, 30);
}

function handleSkillToggle(draft, target) {
  const skillId = target.dataset.skillId;
  const toggle = target.dataset.toggle;

  if (!Array.isArray(draft.skills)) {
    draft.skills = [];
  }

  let skill = draft.skills.find((entry) => entry.id === skillId);

  if (!skill) {
    skill = {
      id: skillId,
      name: skillId,
      ability: "",
      proficient: false,
      expertise: false,
      source: null,
    };
    draft.skills.push(skill);
  }

  if (toggle === "proficient") {
    const nextProficient = !Boolean(skill.proficient);
    skill.proficient = nextProficient;

    if (!nextProficient) {
      skill.expertise = false;
    }
    return;
  }

  if (toggle === "expertise") {
    const nextExpertise = !Boolean(skill.expertise);
    skill.expertise = nextExpertise;

    if (nextExpertise) {
      skill.proficient = true;
    }
  }
}

function handleSavingThrowToggle(draft, target) {
  const abilityId = target.dataset.abilityId;

  if (!draft.savingThrows || typeof draft.savingThrows !== "object") {
    draft.savingThrows = {};
  }

  if (!draft.savingThrows[abilityId] || typeof draft.savingThrows[abilityId] !== "object") {
    draft.savingThrows[abilityId] = { proficient: false };
  }

  draft.savingThrows[abilityId].proficient = !Boolean(
    draft.savingThrows[abilityId].proficient
  );
}

function handleHpApplyDamage(draft) {
  const combat = ensureCombatState(draft);
  const derived = getDerivedStats(draft);
  const maxHp = getMaxHp(derived);
  const amount = Math.max(0, Number(draft.ui?.hpAdjustAmount || 0));

  const currentTemp = Number(combat.hp.temp || 0);
  const currentHp = Number(combat.hp.current || 0);

  const tempAbsorbed = Math.min(currentTemp, amount);
  const remainingDamage = amount - tempAbsorbed;

  combat.hp.temp = currentTemp - tempAbsorbed;
  combat.hp.current = clamp(currentHp - remainingDamage, 0, maxHp);
}

function handleHpApplyHeal(draft) {
  const combat = ensureCombatState(draft);
  const derived = getDerivedStats(draft);
  const maxHp = getMaxHp(derived);
  const amount = Math.max(0, Number(draft.ui?.hpAdjustAmount || 0));
  const currentHp = Number(combat.hp.current || 0);

  combat.hp.current = clamp(currentHp + amount, 0, maxHp);
}

function handleSlotSetUsed(draft, target) {
  const slotLevel = Number(target.dataset.slotLevel);
  const slotIndex = Number(target.dataset.slotIndex);

  if (Number.isNaN(slotLevel) || Number.isNaN(slotIndex)) {
    return;
  }

  const spellcasting = ensureSpellcastingState(draft);
  const derived = getDerivedStats(draft);
  const slotState = (derived.spellSlots || []).find(
    (slot) => Number(slot.level) === slotLevel
  );

  if (!slotState) {
    return;
  }

  const max = Number(slotState.max || 0);
  const currentAvailable = Number(slotState.available || 0);
  const nextAvailable = currentAvailable === slotIndex ? slotIndex - 1 : slotIndex;

  spellcasting.slotsUsed[slotLevel] = clamp(max - nextAvailable, 0, max);
}

function handleBardicSetCurrent(draft, target) {
  const chargeIndex = Number(target.dataset.chargeIndex);
  const combat = ensureCombatState(draft);
  const bardic = combat.bardicInspiration;

  if (!bardic || Number.isNaN(chargeIndex)) {
    return;
  }

  const derived = getDerivedStats(draft);
  const max = Number(derived.bardicInspiration?.max || 0);
  const current = Number(bardic.current || 0);
  const nextCurrent = current === chargeIndex ? chargeIndex - 1 : chargeIndex;

  bardic.current = clamp(nextCurrent, 0, max);
}

function handleTurnToggleAction(draft) {
  const turn = ensureTurnState(draft);
  turn.actionUsed = !Boolean(turn.actionUsed);
}

function handleTurnToggleBonusAction(draft) {
  const turn = ensureTurnState(draft);
  turn.bonusActionUsed = !Boolean(turn.bonusActionUsed);
}

function handleTurnToggleReaction(draft) {
  const turn = ensureTurnState(draft);
  turn.reactionUsed = !Boolean(turn.reactionUsed);
}

function handleTurnEnd(draft) {
  const turn = ensureTurnState(draft);
  turn.actionUsed = false;
  turn.bonusActionUsed = false;
  turn.reactionUsed = false;
  turn.turnNumber = Number(turn.turnNumber || 1) + 1;
}

function handleBardicUse(draft, target) {
  const markBonusAction = target.dataset.markBonusAction !== "false";
  const combat = ensureCombatState(draft);
  const bardic = combat.bardicInspiration;

  if (!bardic) {
    return;
  }

  const derived = getDerivedStats(draft);
  const max = Number(derived.bardicInspiration?.max || 0);
  const current = clamp(Number(bardic.current || 0), 0, max);

  if (current <= 0) {
    return;
  }

  bardic.current = current - 1;

  if (markBonusAction) {
    const turn = ensureTurnState(draft);
    turn.bonusActionUsed = true;
  }
}

function handleWeaponAttack(draft) {
  const turn = ensureTurnState(draft);
  turn.actionUsed = true;
}

function handleSpellCast(draft, target) {
  const spellId = target.dataset.spellId;
  const spellLevel = Number(target.dataset.spellLevel || 0);
  const castTime = String(target.dataset.castTime || "").toLowerCase();
  const setsConcentration = target.dataset.setsConcentration === "true";

  if (!spellId) {
    return;
  }

  const collections = buildCharacterSpellCollections(draft);
  const allAvailableSpells = [
    ...collections.cantrips,
    ...collections.preparedSpells,
    ...collections.grantedSpells,
  ];

  const spell = findSpellByActionId(allAvailableSpells, spellId);

  if (!spell) {
    return;
  }

  if (spell.uses?.max != null) {
    const currentUses = Number(spell.uses.current || 0);

    if (currentUses > 0) {
      const spellcasting = ensureSpellcastingState(draft);
      if (!spellcasting.spellOverrides || typeof spellcasting.spellOverrides !== "object") {
        spellcasting.spellOverrides = {};
      }

      const currentOverride = spellcasting.spellOverrides[spell.id] ?? {};
      spellcasting.spellOverrides[spell.id] = {
        ...currentOverride,
        uses: {
          ...(currentOverride.uses ?? spell.uses),
          current: currentUses - 1,
          max: Number(spell.uses.max || 0),
          refresh: spell.uses.refresh,
        },
      };
    } else if (!spendSpellSlotIfAvailable(draft, spellLevel)) {
      return;
    }
  } else if (!spendSpellSlotIfAvailable(draft, spellLevel)) {
    return;
  }

  markTurnConsumption(draft, castTime);

  const combat = ensureCombatState(draft);
  if (setsConcentration) {
    combat.concentration = spell.name || "";
  }
}

function handleToggleJackOfAllTrades(draft) {
  const rulesOverrides = ensureRulesOverridesState(draft);
  rulesOverrides.disableJackOfAllTrades = !Boolean(
    rulesOverrides.disableJackOfAllTrades
  );
}

function handlePrintSheet() {
  window.print();
}

function normalizeLevelDependentState(draft) {
  const derived = getDerivedStats(draft);
  const combat = ensureCombatState(draft);
  const spellcasting = ensureSpellcastingState(draft);

  combat.hp.current = clamp(Number(combat.hp.current || 0), 0, getMaxHp(derived));

  const normalizedSlotsUsed = {};
  for (const slot of derived.spellSlots || []) {
    const max = Number(slot.max || 0);
    const used = Number(spellcasting.slotsUsed?.[slot.level] || 0);
    normalizedSlotsUsed[slot.level] = clamp(used, 0, max);
  }
  spellcasting.slotsUsed = normalizedSlotsUsed;

  const bardic = combat.bardicInspiration;
  if (bardic) {
    const maxBardic = Number(derived.bardicInspiration?.max || 0);
    bardic.current = clamp(Number(bardic.current || 0), 0, maxBardic);
  }
}

function handleLevelAdjust(draft, target) {
  const delta = Number(target.dataset.delta || 0);

  if (!Number.isFinite(delta) || delta === 0) {
    return;
  }

  if (!draft.profile || typeof draft.profile !== "object") {
    draft.profile = {};
  }

  const currentLevel = Math.max(1, Number(draft.profile.level || 1));
  const nextLevel = clamp(currentLevel + delta, 1, 20);

  if (nextLevel === currentLevel) {
    return;
  }

  draft.profile.level = nextLevel;
  normalizeLevelDependentState(draft);
}

function handleSpellLibrarySetLevel(draft, target) {
  const levelValue = target.dataset.spellLibraryLevel;
  const ui = ensureUiState(draft);

  if (!ui.spellLibrary || typeof ui.spellLibrary !== "object") {
    ui.spellLibrary = {
      selectedLevel: "all",
      expandedSpellIds: [],
    };
  }

  if (!ui.spellLibrary.selectionFilter) {
    ui.spellLibrary.selectionFilter = "all";
  }

  ui.spellLibrary.selectedLevel = levelValue ?? "all";
}

function handleSpellLibraryToggleExpand(draft, target) {
  const spellId = target.dataset.spellLibraryToggle;
  const ui = ensureUiState(draft);

  if (!spellId) {
    return;
  }

  if (!ui.spellLibrary || typeof ui.spellLibrary !== "object") {
    ui.spellLibrary = {
      selectedLevel: "all",
      expandedSpellIds: [],
    };
  }

  const expandedSpellIds = Array.isArray(ui.spellLibrary.expandedSpellIds)
    ? ui.spellLibrary.expandedSpellIds
    : [];

  const alreadyExpanded = expandedSpellIds.includes(spellId);

  ui.spellLibrary.expandedSpellIds = alreadyExpanded
    ? expandedSpellIds.filter((id) => id !== spellId)
    : [...expandedSpellIds, spellId];
}

function handleSpellLibraryToggleSelect(draft, target) {
  const spellId = target.dataset.spellLibrarySelect;
  const mode = target.dataset.spellLibraryMode;
  const level = Number(draft.profile?.level ?? 1);
  const spellcasting = ensureSpellcastingState(draft);

  if (!spellId || !mode) {
    return;
  }

  const spell = BARD_SPELL_LIBRARY_BY_ID[spellId];
  if (!spell) {
    return;
  }

  if (spell.availableFromLevel && Number(spell.availableFromLevel) > level) {
    return;
  }

  if (isGrantedSpell(draft, spellId)) {
    return;
  }

  if (!Array.isArray(spellcasting.cantripIds)) {
    spellcasting.cantripIds = [];
  }

  if (!Array.isArray(spellcasting.preparedSpellIds)) {
    spellcasting.preparedSpellIds = [];
  }

  const cantripIds = [...new Set(spellcasting.cantripIds.filter(Boolean))];
  const preparedSpellIds = [...new Set(spellcasting.preparedSpellIds.filter(Boolean))];

  if (mode === "cantrip") {
    const grantedSpellIdSet = new Set(
      Array.isArray(spellcasting.grantedSpellIds)
        ? spellcasting.grantedSpellIds.filter(Boolean)
        : [],
    );

    const selected = isCantripSelected(draft, spellId);

    const cantripIds = [...new Set(spellcasting.cantripIds.filter(Boolean))];

    const classCantripIds = cantripIds.filter(
      (id) => !grantedSpellIdSet.has(id),
    );

    if (grantedSpellIdSet.has(spellId)) {
      return;
    }

    if (selected) {
      spellcasting.cantripIds = cantripIds.filter((id) => id !== spellId);
      return;
    }

    const limit = getBardCantripLimit(level);

    if (classCantripIds.length >= limit) {
      return;
    }

    spellcasting.cantripIds = [...cantripIds, spellId];
    return;
  }

  if (mode === "prepared") {
    const selected = isPreparedSpellSelected(draft, spellId);

    if (selected) {
      spellcasting.preparedSpellIds = preparedSpellIds.filter((id) => id !== spellId);
      return;
    }

    const limit = getBardPreparedSpellLimit(level);
    if (preparedSpellIds.length >= limit) {
      return;
    }

    spellcasting.preparedSpellIds = [...preparedSpellIds, spellId];
  }
}

function handleSpellLibrarySetSelectionFilter(draft, target) {
  const selectionValue = target.dataset.spellLibrarySelection;
  const ui = ensureUiState(draft);

  if (!ui.spellLibrary || typeof ui.spellLibrary !== "object") {
    ui.spellLibrary = {
      selectedLevel: "all",
      selectionFilter: "all",
      expandedSpellIds: [],
    };
  }

  const currentValue = ui.spellLibrary.selectionFilter ?? "all";
  const nextValue = selectionValue ?? "all";

  ui.spellLibrary.selectionFilter =
    currentValue === nextValue ? "all" : nextValue;
}

export function createActionHandlers({ resetState }) {
  return {
    "hp-change": handleHpChange,
    "hp-reset": handleHpReset,
    "toggle-abilities-edit": handleToggleAbilitiesEdit,
    "inventory-add-item": handleInventoryAddItem,
    "inventory-remove-item": handleInventoryRemoveItem,
    "long-rest": handleLongRest,
    "reset-runtime": () => handleResetRuntime(resetState),
    "short-rest": handleShortRest,
    "concentration-clear": handleConcentrationClear,
    "effect-add": handleEffectAdd,
    "effect-remove": handleEffectRemove,
    "print-sheet": handlePrintSheet,
    "ability-adjust": handleAbilityAdjust,
    "skill-toggle": handleSkillToggle,
    "saving-throw-toggle": handleSavingThrowToggle,
    "hp-apply-damage": handleHpApplyDamage,
    "hp-apply-heal": handleHpApplyHeal,
    "slot-set-used": handleSlotSetUsed,
    "bardic-set-current": handleBardicSetCurrent,
    "turn-toggle-action": handleTurnToggleAction,
    "turn-toggle-bonus-action": handleTurnToggleBonusAction,
    "turn-toggle-reaction": handleTurnToggleReaction,
    "turn-end": handleTurnEnd,
    "bardic-use": handleBardicUse,
    "weapon-attack": handleWeaponAttack,
    "spell-cast": handleSpellCast,
    "toggle-jack-of-all-trades": handleToggleJackOfAllTrades,
    "level-adjust": handleLevelAdjust,
    "spell-library-set-level": handleSpellLibrarySetLevel,
    "spell-library-set-selection-filter": handleSpellLibrarySetSelectionFilter,
    "spell-library-toggle-expand": handleSpellLibraryToggleExpand,
    "spell-library-toggle-select": handleSpellLibraryToggleSelect,
  };
}