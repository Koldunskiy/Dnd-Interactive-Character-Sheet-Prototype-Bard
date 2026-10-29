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
  ensureSpellsUiState,
  ensureMeleeUiState,
  ensureInventoryUiState,
} from "./state-helpers.js";
import {
  isGrantedSpell,
  resolveSpellById,
} from "./selectors/spellcasting.js";
import {
  SKILL_ID_META,
} from "./rules.js";
import { buildCharacterSpellCollections } from "./selectors/spellcasting.js";


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

function resolveLibrarySpellById(spellId) {
  return resolveSpellById(String(spellId ?? ""));
}

function resolveSelectedSpell(collections, spellId) {
  return collections.spells.find((entry) => entry.id === spellId);
}

function spendSpellSlotIfAvailable(draft, spellLevel) {
  if (spellLevel <= 0) {
    return true;
  }

  const derived = getDerivedStats(draft);
  const slotState = (derived.spellSlots || []).find(
    (slot) => Number(slot.level) === spellLevel,
  );

  const available = Number(slotState?.available);
  const rawUsed = draft.spellcasting?.slotsUsed?.[spellLevel] ?? 0;
  const used = Number(rawUsed);
  if (!slotState || !Number.isFinite(available) || !Number.isInteger(available) ||
      available <= 0 || !Number.isFinite(used) || !Number.isInteger(used) || used < 0) {
    return false;
  }

  const spellcasting = ensureSpellcastingState(draft);
  spellcasting.slotsUsed[spellLevel] = used + 1;
  return true;
}

function getTurnFlag(castTime) {
  const normalized = String(castTime ?? "").trim().toLowerCase();
  if (normalized === "1 бонусное действие") return "bonusActionUsed";
  if (normalized === "1 действие") return "actionUsed";
  if (normalized === "1 реакция") return "reactionUsed";
  return null;
}

function rejectSpellApplication(reason) {
  if (typeof globalThis.window?.alert === "function") {
    globalThis.window.alert(reason);
  }
}

function spellHasMembershipForMode(spell, mode) {
  const isClassLevelled = spell.memberships.includes("known") ||
    (spell.memberships.includes("granted") && spell.source === "magical-secret");
  if (mode === "cantrip") {
    return spell.level === 0 &&
      (spell.memberships.includes("cantrip") || spell.memberships.includes("granted"));
  }
  if (mode === "racial") return spell.source === "racial" && spell.memberships.includes("granted");
  if (mode === "slot") return spell.level > 0 && isClassLevelled;
  return false;
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
    type: "misc",
    name: "",
    quantity: 1,
    stackable: false,
    equipped: false,
    notes: "",
    tags: [],
    weapon: null,
    armor: null,
    focus: null,
    consumable: null,
    uses: null,
    charges: null,
  });
}

function requestConfirmation(message) {
  const browserWindow = globalThis.window;
  if (!browserWindow || typeof browserWindow.confirm !== "function") {
    throw new Error("Confirmation dialog is unavailable; the operation was cancelled.");
  }

  return Boolean(browserWindow.confirm(message));
}

function handleInventoryRemoveItem(draft, target) {
  const itemId = String(target.dataset.itemId ?? "");
  const items = draft.inventory?.items;

  if (!itemId || !Array.isArray(items)) {
    return;
  }

  const itemIndex = items.findIndex((item) => String(item.id ?? "") === itemId);
  if (itemIndex < 0) {
    return;
  }

  const item = items[itemIndex];
  const itemName = String(item.name ?? "").trim() || "без названия";
  if (!requestConfirmation(`Удалить «${itemName}» из инвентаря?`)) {
    return;
  }

  items.splice(itemIndex, 1);
}

function handleLongRest(draft) {
  if (draft.profile?.id === "sara-velaris") {
    if (!requestConfirmation("Долгий отдых восстановит HP, временные HP, practised uses, Suggestion, кости хитов и отметки хода. Ци восстанавливается только после подтверждения 30 минут медитации. Снять концентрацию Suggestion/другого эффекта? Продолжить?")) return false;
    const meditate = requestConfirmation("Подтвердите, что Сара посвятила не менее 30 минут долгого отдыха медитации для восстановления ци.");
    const practice = Number(draft.profile.level) >= 10 &&
      requestConfirmation("Подтвердите 10 минут практики для одной замены обычной техники Open Hand.");
    const combat = ensureCombatState(draft);
    const turn = ensureTurnState(draft);
    const effects = ensureEffectsState(draft);
    draft.monk.techniqueRuntime ??= {};
    const thirdEye = draft.monk.techniqueRuntime["ll-monk:awaken-the-third-eye"];
    if (thirdEye) {
      thirdEye.awakenThirdEyeActive = false;
      thirdEye.awakenThirdEyePending = false;
    }
    const derived = getDerivedStats(draft);
    turn.actionUsed = false;
    turn.bonusActionUsed = false;
    turn.reactionUsed = false;
    combat.hp.current = derived.maxHitPoints;
    combat.hp.temp = 0;
    combat.hitDice ??= { total: Number(draft.profile.level), remaining: Number(draft.profile.level) };
    const diceTotal = Math.max(1, Number(draft.profile.level));
    combat.hitDice.total = diceTotal;
    combat.hitDice.remaining = clamp(
      Number(combat.hitDice.remaining ?? diceTotal) + Math.max(1, Math.floor(Number(draft.profile.level) / 2)),
      0,
      diceTotal
    );
    combat.practiced ??= { current: 0 };
    combat.practiced.current = derived.monk.practicedMaximum;
    if (meditate) combat.ki.current = derived.monk.kiMaximum;
    draft.spellcasting.racialSpells?.forEach((spell) => {
      if (spell.id === "suggestion-2014" && spell.uses) spell.uses.current = spell.uses.max;
    });
    combat.concentration = "";
    effects.splice(0, effects.length, ...effects.filter((effect) =>
      !["until-short-rest", "until-long-rest"].includes(effect?.durationType)));
    draft.monk.techniqueRuntime ??= {};
    for (const runtime of Object.values(draft.monk.techniqueRuntime)) {
      if (runtime && typeof runtime === "object") {
        if (runtime.cooldown === "long-rest") runtime.used = false;
        delete runtime.usedUntilRest;
      }
    }
    delete draft.monk.techniqueRuntime.practicedUsedThisTurn;
    draft.monk.ordinaryReplacementCredit = practice ? 1 : 0;
    draft.monk.replacementEntitlements = (draft.monk.replacementEntitlements ?? [])
      .filter((event) => event.type !== "rest");
    if (practice) {
      draft.monk.replacementEntitlements.push({
        id: `rest:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
        type: "rest",
        createdAtLevel: Number(draft.profile.level),
        consumed: false
      });
    }
    draft.monk.techniqueRuntime.deflectContinuation = null;
    return;
  }

  if (!requestConfirmation(
    "Долгий отдых восстановит хиты до максимума, сбросит временные хиты и концентрацию, отметки хода и номер хода (до 1), восстановит ячейки, вдохновение и собственные применения заклинаний, а также удалит эффекты до короткого или долгого отдыха. Продолжить?",
  )) {
    return false;
  }

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

  const retainedEffects = effects.filter(
    (effect) => !["until-short-rest", "until-long-rest"].includes(effect?.durationType),
  );
  effects.length = 0;
  effects.push(...retainedEffects);
}

function handleResetRuntime(resetState) {
  resetState();
}

function handleShortRest(draft) {
  if (draft.profile?.id === "sara-velaris") {
    const level = Number(draft.profile.level);
    const hasPuritySpirit = level >= 20;
    if (!requestConfirmation(hasPuritySpirit
      ? "Короткий отдых (обычно не менее 1 часа; Purity Spirit позволяет 1 минуту) сбросит отметки действий и эффекты до короткого отдыха. Подтвердить отдых?"
      : "Короткий отдых (обычно не менее 1 часа) сбросит отметки действий и эффекты до короткого отдыха; хиты и временные хиты не меняются. Подтвердить отдых?")) return false;
    const meditate = requestConfirmation(hasPuritySpirit
      ? "Подтвердите восстановление ци через 1-минутный отдых Purity Spirit; это отдельный режим, не 30-минутная медитация."
      : "Подтвердите 30 минут медитации внутри короткого отдыха для восстановления ци.");
    const combat = ensureCombatState(draft);
    const turn = ensureTurnState(draft);
    const effects = ensureEffectsState(draft);
    const thirdEye = draft.monk?.techniqueRuntime?.["ll-monk:awaken-the-third-eye"];
    if (thirdEye?.awakenThirdEyePending) thirdEye.awakenThirdEyePending = false;
    turn.actionUsed = false;
    turn.bonusActionUsed = false;
    turn.reactionUsed = false;
    if (meditate) {
      const derived = getDerivedStats(draft);
      combat.ki.current = derived.monk.kiMaximum;
    }
    effects.splice(0, effects.length, ...effects.filter((effect) => effect?.durationType !== "until-short-rest"));
    draft.monk.techniqueRuntime ??= {};
    for (const runtime of Object.values(draft.monk.techniqueRuntime)) {
      if (runtime && typeof runtime === "object") {
        if (runtime.cooldown === "short-rest") runtime.used = false;
        delete runtime.usedUntilRest;
      }
    }
    delete draft.monk.techniqueRuntime.practicedUsedThisTurn;
    draft.monk.techniqueRuntime.deflectContinuation = null;
    return;
  }

  if (!requestConfirmation(
    "Короткий отдых (не менее 1 часа) вернёт действие, бонусное действие и реакцию, очистит концентрацию и удалит эффекты до короткого отдыха. Потраченные кости хитов и Песнь отдыха учитываются вручную; хиты этой кнопкой не восстанавливаются. При доступной Черте вдохновения восстановится Бардское вдохновение. Продолжить?",
  )) {
    return false;
  }

  const combat = ensureCombatState(draft);
  const turn = ensureTurnState(draft);
  const effects = ensureEffectsState(draft);

  turn.actionUsed = false;
  turn.bonusActionUsed = false;
  turn.reactionUsed = false;

  combat.concentration = "";

  const retained = effects.filter((effect) => effect?.durationType !== "until-short-rest");
  effects.length = 0;
  effects.push(...retained);

  const level = Number(draft.profile?.level ?? 1);
  const hasFontOfInspiration = level >= 5 &&
    (Array.isArray(draft.classFeatures) ? draft.classFeatures : []).some((feature) =>
      Number(feature?.level ?? 0) <= level &&
      (feature?.id === "font-of-inspiration" ||
        ["Font of Inspiration", "Источник вдохновения"].includes(feature?.name)),
    );
  if (hasFontOfInspiration && combat.bardicInspiration) {
    const derived = getDerivedStats(draft);
    combat.bardicInspiration.current = Number(derived.bardicInspiration?.max ?? 0);
  }
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
  if (!draft.ui?.abilitiesEditable) return;
  const abilityId = target.dataset.abilityId;
  const delta = Number(target.dataset.delta || 0);

  if (draft.profile?.id === "sara-velaris" && abilityId !== "constitution") return;
  if (!abilityId || typeof draft.abilities?.[abilityId] !== "number") {
    return;
  }

  draft.abilities[abilityId] = clamp(
    (draft.abilities[abilityId] || 0) + delta,
    draft.profile?.id === "sara-velaris" ? 1 : 8,
    30
  );
}

function handleSkillToggle(draft, target) {
  if (!draft.ui?.abilitiesEditable) return;
  const skillId = String(target.dataset.skillId ?? "");
  const toggle = String(target.dataset.toggle ?? "");

  if (!skillId || !toggle) {
    return;
  }

  if (!Array.isArray(draft.skills)) {
    draft.skills = [];
  }

  let skill = draft.skills.find((entry) => entry.id === skillId);

  if (!skill) {
    const meta = SKILL_ID_META[skillId];
    if (!meta) {
      return;
    }

    skill = {
      id: skillId,
      name: meta.label,
      ability: meta.ability,
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
  if (!draft.ui?.abilitiesEditable) return;
  const abilityId = String(target.dataset.abilityId ?? "");

  if (!abilityId) {
    return;
  }

  if (!draft.savingThrows || typeof draft.savingThrows !== "object") {
    draft.savingThrows = {};
  }

  if (
    !draft.savingThrows[abilityId] ||
    typeof draft.savingThrows[abilityId] !== "object"
  ) {
    draft.savingThrows[abilityId] = {
      proficient: false,
    };
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
  if (draft.profile?.id === "sara-velaris") {
    for (const runtime of Object.values(draft.monk?.techniqueRuntime ?? {})) {
      if (runtime && typeof runtime === "object") delete runtime.usedThisTurn;
    }
    if (draft.monk?.techniqueRuntime) {
      delete draft.monk.techniqueRuntime.practicedUsedThisTurn;
    }
    if (draft.monk?.techniqueRuntime) draft.monk.techniqueRuntime.deflectContinuation = null;
  }
}

function handleMonkAttack(draft) {
  if (draft.profile?.id !== "sara-velaris") return;
  ensureTurnState(draft).actionUsed = true;
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
  if (target.isConnected === false || target.dataset.processing !== "true") return;
  const spellId = String(target.dataset.spellId ?? "");
  const mode = String(target.dataset.spellMode ?? "");
  const requestedSlotLevel = target.dataset.slotLevel;
  if (!spellId) {
    rejectSpellApplication("Некорректный выбор заклинания.");
    return;
  }

  const collections = buildCharacterSpellCollections(draft);
  const spell = resolveSelectedSpell(collections, spellId);
  if (!spell || !spellHasMembershipForMode(spell, mode)) {
    rejectSpellApplication("Заклинание недоступно для выбранного способа применения.");
    return;
  }
  if (Number(spell.availableFromLevel ?? 1) > Number(draft.profile?.level ?? 1)) {
    rejectSpellApplication("Заклинание пока недоступно по уровню.");
    return;
  }
  if (spell.locked) {
    rejectSpellApplication("Заклинание заблокировано.");
    return;
  }

  let slotLevel = null;
  if (mode === "slot") {
    slotLevel = Number(requestedSlotLevel);
    if (!Number.isFinite(slotLevel) || !Number.isInteger(slotLevel) || slotLevel < spell.level) {
      rejectSpellApplication("Некорректно выбран круг ячейки.");
      return;
    }
    const availableSlot = getDerivedStats(draft).spellSlots?.find(
      (slot) => Number(slot.level) === slotLevel,
    );
    const available = Number(availableSlot?.available);
    if (!availableSlot || !Number.isFinite(available) || !Number.isInteger(available) || available <= 0) {
      rejectSpellApplication("Нет доступных ячеек выбранного круга.");
      return;
    }
  }

  const isConcentration = Boolean(spell.concentration);
  const combatBefore = draft.combat ?? {};
  const currentConcentration = String(combatBefore.concentration ?? "");
  if (isConcentration && currentConcentration) {
    if (!requestConfirmation(`Заменить концентрацию «${currentConcentration}» заклинанием «${spell.name}»?`)) {
      return;
    }
  }

  const currentSpell = resolveSelectedSpell(
    buildCharacterSpellCollections(draft),
    spellId,
  );
  if (!currentSpell || !spellHasMembershipForMode(currentSpell, mode) ||
      currentSpell.locked ||
      Number(currentSpell.availableFromLevel ?? 1) > Number(draft.profile?.level ?? 1)) {
    rejectSpellApplication("Заклинание стало недоступно для выбранного способа применения.");
    return;
  }

  if (mode === "racial") {
    const currentUses = Number(currentSpell.uses?.current);
    if (!Number.isFinite(currentUses) || currentUses <= 0) {
      rejectSpellApplication("Расовое применение этого заклинания израсходовано.");
      return;
    }
    const spellcasting = ensureSpellcastingState(draft);
    const previousOverride = spellcasting.spellOverrides?.[currentSpell.id] ?? {};
    spellcasting.spellOverrides[currentSpell.id] = {
      ...previousOverride,
      uses: { ...(previousOverride.uses ?? currentSpell.uses), current: currentUses - 1 },
    };
  } else if (mode === "slot" && !spendSpellSlotIfAvailable(draft, slotLevel)) {
    rejectSpellApplication("Нет доступных ячеек выбранного круга.");
    return;
  }

  const castTime = String(currentSpell.castTime ?? currentSpell.castingTime ?? "");
  const turnFlag = getTurnFlag(castTime);
  if (turnFlag) {
    ensureTurnState(draft)[turnFlag] = true;
  }
  if (Boolean(currentSpell.concentration)) {
    ensureCombatState(draft).concentration = currentSpell.name ?? "";
  }
}

function handleToggleJackOfAllTrades(draft) {
  const rulesOverrides = ensureRulesOverridesState(draft);
  rulesOverrides.disableJackOfAllTrades = !Boolean(
    rulesOverrides.disableJackOfAllTrades
  );
}

function handleToggleDuelingStyle(draft) {
  const rulesOverrides = ensureRulesOverridesState(draft);
  rulesOverrides.disableDuelingStyle = !Boolean(rulesOverrides.disableDuelingStyle);
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

  if (draft.profile?.id === "sara-velaris" && (!Number.isInteger(delta) || Math.abs(delta) !== 1)) {
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

  if (draft.profile?.id === "sara-velaris" && nextLevel > currentLevel) {
    const pending = (draft.monk.replacementEntitlements ?? []).some((event) =>
      event.type === "level-up" && !event.consumed);
    if (pending) return;
  }

  draft.profile.level = nextLevel;
  normalizeLevelDependentState(draft);
  if (draft.profile?.id === "sara-velaris" &&
      nextLevel > Number(draft.monk.processedLevel ?? currentLevel) &&
      nextLevel === Number(draft.monk.processedLevel ?? currentLevel) + 1) {
    draft.monk.replacementEntitlements ??= [];
    draft.monk.replacementEntitlements.push({
      id: `level:${nextLevel}:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
      type: "level-up",
      level: nextLevel,
      consumed: false
    });
  }
}

function handleSpellLibrarySetLevel(draft, target) {
  const levelValue = target.dataset.spellLibraryLevel;
  const ui = ensureUiState(draft);

  ui.spellLibrary.selectedLevel = levelValue ?? "all";
}

function handleSpellLibraryToggleExpand(draft, target) {
  const spellId = target.dataset.spellLibraryToggle;

  if (!spellId) {
    return;
  }

  const ui = ensureUiState(draft);
  const expandedSpellIds = ui.spellLibrary.expandedSpellIds;
  const alreadyExpanded = expandedSpellIds.includes(spellId);

  ui.spellLibrary.expandedSpellIds = alreadyExpanded
    ? expandedSpellIds.filter((id) => id !== spellId)
    : [...expandedSpellIds, spellId];
}

function handleSpellLibraryToggleSelect(draft, target) {
  const rawSpellId = target.dataset.spellLibrarySelect;
  const mode = target.dataset.spellLibraryMode;
  if (!rawSpellId || (mode !== "cantrip" && mode !== "prepared")) {
    return;
  }

  const resolvedSpell = resolveLibrarySpellById(rawSpellId);
  if (!resolvedSpell) {
    console.warn("[actions] Unknown library spell id:", rawSpellId);
    return;
  }

  const spellId = resolvedSpell.id;
  if (isGrantedSpell(draft, spellId)) {
    return;
  }

  const spellLevel = Number(resolvedSpell.level);
  if (
    (mode === "cantrip" && spellLevel !== 0) ||
    (mode === "prepared" && (!Number.isInteger(spellLevel) || spellLevel <= 0))
  ) return;

  const selectedIds = mode === "cantrip"
    ? draft.spellcasting?.cantripIds
    : draft.spellcasting?.preparedSpellIds;
  if (!Array.isArray(selectedIds)) return;

  const removeCanonical = (ids, canonicalId) =>
    ids.filter((id) => resolveSpellById(id)?.id !== canonicalId);
  const hasCanonical = (ids) =>
    ids.some((id) => resolveSpellById(id)?.id === spellId);

  if (hasCanonical(selectedIds)) {
    draft.spellcasting[mode === "cantrip" ? "cantripIds" : "preparedSpellIds"] =
      removeCanonical(selectedIds, spellId);
    return;
  }

  const level = Number(draft.profile?.level ?? 1);
  const availableFromLevel = Number(resolvedSpell.availableFromLevel ?? 1);
  if (!Number.isFinite(level) || !Number.isFinite(availableFromLevel) || availableFromLevel > level) {
    return;
  }

  const collection = buildCharacterSpellCollections(draft);
  if (mode === "cantrip") {
    if (collection.counts.classCantrips >= collection.limits.classCantrips) return;
    selectedIds.push(spellId);
    return;
  }

  if (collection.counts.knownSpells >= collection.limits.knownSpells) return;
  selectedIds.push(spellId);
}

function handleSpellLibrarySetSelectionFilter(draft, target) {
  const selectionValue = String(
    target.dataset.spellLibrarySelection ?? "all",
  );

  const ui = ensureUiState(draft);
  const currentValue = ui.spellLibrary.selectionFilter;

  ui.spellLibrary.selectionFilter = (
    currentValue === selectionValue
      ? "all"
      : selectionValue
  );
}

function handleSpellLibrarySearch(draft, target) {
  const ui = ensureUiState(draft);

  ui.spellLibrary.searchQuery = String(target.value ?? "");
}

function handleSpellLibrarySetSchool(draft, target) {
  const ui = ensureUiState(draft);

  ui.spellLibrary.schoolFilter = String(
    target.dataset.spellLibrarySchool ?? "all",
  );
}

function handleSpellLibraryToggleFlag(draft, target) {
  const flag = String(target.dataset.spellLibraryFlag ?? "");

  const allowedFlags = new Set([
    "concentrationOnly",
    "ritualOnly",
    "availableOnly",
  ]);

  if (!allowedFlags.has(flag)) {
    return;
  }

  const ui = ensureUiState(draft);

  ui.spellLibrary[flag] = !ui.spellLibrary[flag];
}

function handleSpellsToggleExpand(draft, target) {
  const spellId = target.dataset.spellsToggle;
  if (!spellId) return;

  const spellsUi = ensureSpellsUiState(draft);
  const expandedSpellIds = Array.isArray(spellsUi.expandedSpellIds)
    ? spellsUi.expandedSpellIds
    : [];

  const alreadyExpanded = expandedSpellIds.includes(spellId);

  spellsUi.expandedSpellIds = alreadyExpanded
    ? expandedSpellIds.filter((id) => id !== spellId)
    : [...expandedSpellIds, spellId];
}

function handleMeleeToggleExpand(draft, target) {
  const cardId = target.dataset.meleeToggle;
  if (!cardId) return;

  const meleeUi = ensureMeleeUiState(draft);
  const expandedCardIds = Array.isArray(meleeUi.expandedCardIds)
    ? meleeUi.expandedCardIds
    : [];

  const alreadyExpanded = expandedCardIds.includes(cardId);

  meleeUi.expandedCardIds = alreadyExpanded
    ? expandedCardIds.filter((id) => id !== cardId)
    : [...expandedCardIds, cardId];
}

function handleInventoryToggleEquipped(draft, target) {
  const itemId = String(target.dataset.itemId ?? "");
  if (!itemId) {
    return;
  }

  const inventory = ensureInventoryState(draft);
  const item = inventory.items.find((entry) => entry.id === itemId);

  if (!item) {
    return;
  }

  const nextEquipped = !Boolean(item.equipped);

  if (item.type === "armor" && nextEquipped) {
    for (const entry of inventory.items) {
      if (entry.type === "armor") {
        entry.equipped = false;
      }
    }
  }

  item.equipped = nextEquipped;
}

function handleInventoryToggleExpand(draft, target) {
  const itemId = target.dataset.itemId;
  if (!itemId) {
    return;
  }

  const inventoryUi = ensureInventoryUiState(draft);
  const expandedItemIds = Array.isArray(inventoryUi.expandedItemIds)
    ? inventoryUi.expandedItemIds
    : [];

  const isExpanded = expandedItemIds.includes(itemId);

  inventoryUi.expandedItemIds = isExpanded
    ? expandedItemIds.filter((id) => id !== itemId)
    : [...expandedItemIds, itemId];
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
    "monk-attack": handleMonkAttack,
    "bardic-use": handleBardicUse,
    "weapon-attack": handleWeaponAttack,
    "spell-cast": handleSpellCast,
    "toggle-jack-of-all-trades": handleToggleJackOfAllTrades,
    "toggle-dueling-style": handleToggleDuelingStyle,
    "level-adjust": handleLevelAdjust,
    "spell-library-set-level": handleSpellLibrarySetLevel,
    "spell-library-set-selection-filter": handleSpellLibrarySetSelectionFilter,
    "spell-library-toggle-expand": handleSpellLibraryToggleExpand,
    "spell-library-toggle-select": handleSpellLibraryToggleSelect,
    "spells-toggle-expand": handleSpellsToggleExpand,
    "melee-toggle-expand": handleMeleeToggleExpand,
    "inventory-toggle-equipped": handleInventoryToggleEquipped,
    "inventory-toggle-expand": handleInventoryToggleExpand,
    "spell-library-search": handleSpellLibrarySearch,
    "spell-library-set-school": handleSpellLibrarySetSchool,
    "spell-library-toggle-flag": handleSpellLibraryToggleFlag,
  };
}