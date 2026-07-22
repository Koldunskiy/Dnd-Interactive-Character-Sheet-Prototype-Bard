import { initTabs } from "./tabs.js";
import { getState, subscribe, setValue, updateState, resetState } from "./state.js";
import { getDerivedStats } from "./calculations.js";
import { renderPortraitMedia, initPortraitControls } from "./media.js";

import { renderHeader } from "./render/render-header.js";
import { renderQuickStats, renderSidebarSummary } from "./render/render-sidebar.js";
import { renderProfile } from "./render/render-profile.js";
import { renderMeleePanel } from "./render/render-melee.js";
import { renderSpells } from "./render/render-spells.js";
import { renderLorePanel } from "./render/render-lore.js";
import { renderInventoryPanel } from "./render/render-inventory.js";

function parseInputValue(input) {
  if (input.type === "number") {
    if (input.value === "") {
      return 0;
    }
    return Number(input.value);
  }

  if (input.type === "checkbox") {
    return input.checked;
  }

  return input.value;
}

function ensureCombatState(draft) {
  if (!draft.combat || typeof draft.combat !== "object") {
    draft.combat = {};
  }

  if (!draft.combat.hp || typeof draft.combat.hp !== "object") {
    draft.combat.hp = {
      current: 0,
      temp: 0,
      maxOverride: null
    };
  }

  if (!draft.combat.bardicInspiration || typeof draft.combat.bardicInspiration !== "object") {
    draft.combat.bardicInspiration = {
      current: 0,
      refresh: "Долгий отдых",
      rangeFeet: 60,
      rangeMeters: 18,
      duration: "10 минут",
      notes: ""
    };
  }

  return draft.combat;
}

function ensureInventoryState(draft) {
  if (!draft.inventory || typeof draft.inventory !== "object") {
    draft.inventory = {};
  }

  if (!Array.isArray(draft.inventory.items)) {
    draft.inventory.items = [];
  }

  return draft.inventory;
}

function bindEditableFields(root = document) {
  root.querySelectorAll("[data-bind]").forEach((element) => {
    if (element.dataset.bound === "true") {
      return;
    }

    const isImmediate =
      element.type === "checkbox" ||
      element.dataset.bindImmediate === "true";

    const eventName = isImmediate ? "input" : "change";

    element.addEventListener(eventName, (event) => {
      const target = event.currentTarget;
      const path = target.dataset.bind;
      const value = parseInputValue(target);

      setValue(path, value);
    });

    element.dataset.bound = "true";
  });
}

function ensureTurnState(draft) {
  if (!draft.ui || typeof draft.ui !== "object") {
    draft.ui = {};
  }

  if (!draft.ui.turn || typeof draft.ui.turn !== "object") {
    draft.ui.turn = {
      actionUsed: false,
      bonusActionUsed: false,
      reactionUsed: false,
      turnNumber: 1
    };
  }

  return draft.ui.turn;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function ensureSpellcastingState(draft) {
  if (!draft.spellcasting || typeof draft.spellcasting !== "object") {
    draft.spellcasting = {};
  }

  if (!draft.spellcasting.slotsUsed || typeof draft.spellcasting.slotsUsed !== "object") {
    draft.spellcasting.slotsUsed = {};
  }

  return draft.spellcasting;
}

function bindActionButtons(root = document) {
  root.querySelectorAll("[data-action]").forEach((element) => {
    if (element.dataset.bound === "true") {
      return;
    }

    element.addEventListener("click", (event) => {
      const target = event.currentTarget;
      const action = target.dataset.action;

      if (action === "hp-change") {
        const delta = Number(target.dataset.delta || 0);

        updateState((draft) => {
          const combat = ensureCombatState(draft);
          const derived = getDerivedStats(draft);
          const nextValue = Number(combat.hp.current || 0) + delta;

          combat.hp.current = clamp(nextValue, 0, derived.maxHitPoints ?? derived.maxHp ?? 0);
          return draft;
        });

        return;
      }

      if (action === "hp-reset") {
        updateState((draft) => {
          const combat = ensureCombatState(draft);
          const derived = getDerivedStats(draft);

          combat.hp.current = derived.maxHitPoints ?? derived.maxHp ?? 0;
          combat.hp.temp = 0;

          return draft;
        });

        return;
      }

      if (action === "toggle-abilities-edit") {
        updateState((draft) => {
          if (!draft.ui || typeof draft.ui !== "object") {
            draft.ui = {};
          }

          draft.ui.abilitiesEditable = !Boolean(draft.ui.abilitiesEditable);
          return draft;
        });

        return;
      }

      if (action === "inventory-add-item") {
        updateState((draft) => {
          const inventory = ensureInventoryState(draft);

          inventory.items.push({
            id: `item-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            name: "",
            quantity: 1,
            equipped: false,
            notes: ""
          });

          return draft;
        });

        return;
      }

      if (action === "inventory-remove-item") {
        const itemId = target.dataset.itemId;

        updateState((draft) => {
          const inventory = ensureInventoryState(draft);
          inventory.items = inventory.items.filter((item) => item.id !== itemId);
          return draft;
        });

        return;
      }

      if (action === "long-rest") {
        updateState((draft) => {
          const combat = ensureCombatState(draft);
          const turn = ensureTurnState(draft);
          const spellcasting = ensureSpellcastingState(draft);
          const derived = getDerivedStats(draft);

          turn.actionUsed = false;
          turn.bonusActionUsed = false;
          turn.reactionUsed = false;
          turn.turnNumber = 1;

          if (Array.isArray(draft.spellcasting?.spells)) {
            draft.spellcasting.spells.forEach((spell) => {
              if (spell?.uses?.max != null) {
                spell.uses.current = Number(spell.uses.max || 0);
              }
            });
          }

          combat.hp.current = derived.maxHitPoints ?? derived.maxHp ?? 0;
          combat.hp.temp = 0;
          combat.bardicInspiration.current = Number(derived.bardicInspiration?.max || 0);
          combat.concentration = "";

          const nextSlotsUsed = {};
          for (const slot of derived.spellSlots || []) {
            nextSlotsUsed[slot.level] = 0;
          }
          spellcasting.slotsUsed = nextSlotsUsed;

          if (Array.isArray(draft.ui?.activeEffects)) {
            draft.ui.activeEffects = [];
          }

          return draft;
        });

        return;
      }

      if (action === "reset-runtime") {
        resetState();
        return;
      }

      if (action === "short-rest") {
        updateState((draft) => {
          const combat = ensureCombatState(draft);
          const turn = ensureTurnState(draft);

          turn.actionUsed = false;
          turn.bonusActionUsed = false;
          turn.reactionUsed = false;

          combat.hp.temp = 0;
          combat.concentration = "";

          if (Array.isArray(draft.ui?.activeEffects)) {
            draft.ui.activeEffects = draft.ui.activeEffects.filter(
              (effect) => effect.durationType !== "until-short-rest"
            );
          }

          return draft;
        });

        return;
      }

      if (action === "concentration-clear") {
        updateState((draft) => {
          const combat = ensureCombatState(draft);
          combat.concentration = "";
          return draft;
        });

        return;
      }

      if (action === "effect-add") {
        updateState((draft) => {
          if (!Array.isArray(draft.ui.activeEffects)) {
            draft.ui.activeEffects = [];
          }

          const combat = ensureCombatState(draft);

          draft.ui.activeEffects.push({
            id: `effect-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            name: "Новый эффект",
            source: combat.concentration || "Ручной эффект",
            duration: "До конца сцены",
            durationType: "custom",
            notes: ""
          });

          return draft;
        });

        return;
      }

      if (action === "effect-remove") {
        const effectId = target.dataset.effectId;

        updateState((draft) => {
          draft.ui.activeEffects = (draft.ui.activeEffects || []).filter(
            (effect) => effect.id !== effectId
          );

          return draft;
        });

        return;
      }

      if (action === "print-sheet") {
        window.print();
        return;
      }

      if (action === "ability-adjust") {
        const abilityId = target.dataset.abilityId;
        const delta = Number(target.dataset.delta || 0);

        updateState((draft) => {
          if (!abilityId || typeof draft.abilities?.[abilityId] !== "number") {
            return draft;
          }

          const nextValue = clamp((draft.abilities[abilityId] || 0) + delta, 8, 30);
          draft.abilities[abilityId] = nextValue;
          return draft;
        });

        return;
      }

      if (action === "skill-toggle") {
        const skillId = target.dataset.skillId;
        const toggle = target.dataset.toggle;

        updateState((draft) => {
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

            return draft;
          }

          if (toggle === "expertise") {
            const nextExpertise = !Boolean(skill.expertise);
            skill.expertise = nextExpertise;

            if (nextExpertise) {
              skill.proficient = true;
            }

            return draft;
          }

          return draft;
        });

        return;
      }

      if (action === "saving-throw-toggle") {
        const abilityId = target.dataset.abilityId;

        updateState((draft) => {
          if (!draft.savingThrows || typeof draft.savingThrows !== "object") {
            draft.savingThrows = {};
          }

          if (!draft.savingThrows[abilityId] || typeof draft.savingThrows[abilityId] !== "object") {
            draft.savingThrows[abilityId] = { proficient: false };
          }

          draft.savingThrows[abilityId].proficient = !Boolean(
            draft.savingThrows[abilityId].proficient
          );

          return draft;
        });

        return;
      }

      if (action === "hp-apply-damage") {
        updateState((draft) => {
          const combat = ensureCombatState(draft);
          const derived = getDerivedStats(draft);
          const maxHp = derived.maxHitPoints ?? derived.maxHp ?? 0;
          const amount = Math.max(0, Number(draft.ui?.hpAdjustAmount || 0));

          const currentTemp = Number(combat.hp.temp || 0);
          const currentHp = Number(combat.hp.current || 0);

          const tempAbsorbed = Math.min(currentTemp, amount);
          const remainingDamage = amount - tempAbsorbed;

          combat.hp.temp = currentTemp - tempAbsorbed;
          combat.hp.current = clamp(currentHp - remainingDamage, 0, maxHp);

          return draft;
        });

        return;
      }

      if (action === "hp-apply-heal") {
        updateState((draft) => {
          const combat = ensureCombatState(draft);
          const derived = getDerivedStats(draft);
          const maxHp = derived.maxHitPoints ?? derived.maxHp ?? 0;
          const amount = Math.max(0, Number(draft.ui?.hpAdjustAmount || 0));

          const currentHp = Number(combat.hp.current || 0);
          combat.hp.current = clamp(currentHp + amount, 0, maxHp);

          return draft;
        });

        return;
      }

      if (action === "slot-set-used") {
        const slotLevel = Number(target.dataset.slotLevel);
        const slotIndex = Number(target.dataset.slotIndex);

        updateState((draft) => {
          if (Number.isNaN(slotLevel) || Number.isNaN(slotIndex)) {
            return draft;
          }

          const spellcasting = ensureSpellcastingState(draft);
          const derived = getDerivedStats(draft);
          const slotState = (derived.spellSlots || []).find((slot) => Number(slot.level) === slotLevel);

          if (!slotState) {
            return draft;
          }

          const max = Number(slotState.max || 0);
          const currentAvailable = Number(slotState.available || 0);

          const nextAvailable =
            currentAvailable === slotIndex
              ? slotIndex - 1
              : slotIndex;

          spellcasting.slotsUsed[slotLevel] = clamp(max - nextAvailable, 0, max);
          return draft;
        });

        return;
      }

      if (action === "bardic-set-current") {
        const chargeIndex = Number(target.dataset.chargeIndex);

        updateState((draft) => {
          const combat = ensureCombatState(draft);
          const bardic = combat.bardicInspiration;
          if (!bardic || Number.isNaN(chargeIndex)) {
            return draft;
          }

          const derived = getDerivedStats(draft);
          const max = Number(derived.bardicInspiration?.max || 0);
          const current = Number(bardic.current || 0);

          const nextCurrent =
            current === chargeIndex
              ? chargeIndex - 1
              : chargeIndex;

          bardic.current = clamp(nextCurrent, 0, max);
          return draft;
        });

        return;
      }

      if (action === "turn-toggle-action") {
        updateState((draft) => {
          const turn = ensureTurnState(draft);
          turn.actionUsed = !Boolean(turn.actionUsed);
          return draft;
        });

        return;
      }

      if (action === "turn-toggle-bonus-action") {
        updateState((draft) => {
          const turn = ensureTurnState(draft);
          turn.bonusActionUsed = !Boolean(turn.bonusActionUsed);
          return draft;
        });

        return;
      }

      if (action === "turn-toggle-reaction") {
        updateState((draft) => {
          const turn = ensureTurnState(draft);
          turn.reactionUsed = !Boolean(turn.reactionUsed);
          return draft;
        });

        return;
      }

      if (action === "turn-end") {
        updateState((draft) => {
          const turn = ensureTurnState(draft);
          turn.actionUsed = false;
          turn.bonusActionUsed = false;
          turn.reactionUsed = false;
          turn.turnNumber = Number(turn.turnNumber || 1) + 1;

          return draft;
        });

        return;
      }

      if (action === "bardic-use") {
        const markBonusAction = target.dataset.markBonusAction !== "false";

        updateState((draft) => {
          const combat = ensureCombatState(draft);
          const bardic = combat.bardicInspiration;
          if (!bardic) {
            return draft;
          }

          const derived = getDerivedStats(draft);
          const max = Number(derived.bardicInspiration?.max || 0);
          const current = clamp(Number(bardic.current || 0), 0, max);

          if (current <= 0) {
            return draft;
          }

          bardic.current = current - 1;

          if (markBonusAction) {
            const turn = ensureTurnState(draft);
            turn.bonusActionUsed = true;
          }

          return draft;
        });

        return;
      }

      if (action === "weapon-attack") {
        updateState((draft) => {
          const turn = ensureTurnState(draft);
          turn.actionUsed = true;
          return draft;
        });
        return;
      }

      if (action === "spell-cast") {
        const spellId = target.dataset.spellId;
        const spellLevel = Number(target.dataset.spellLevel || 0);
        const castTime = String(target.dataset.castTime || "").toLowerCase();
        const setsConcentration = target.dataset.setsConcentration === "true";

        updateState((draft) => {
          const spells = Array.isArray(draft.spellcasting?.spells)
            ? draft.spellcasting.spells
            : [];

          const spell = spells.find((entry) => {
            const id = `spell-${String(entry.originalName || entry.name || "spell")
              .toLowerCase()
              .replaceAll(" ", "-")}`;
            return id === spellId;
          });

          if (!spell) {
            return draft;
          }

          const spellcasting = ensureSpellcastingState(draft);

          if (spell.source === "racial" && spell.uses) {
            const currentUses = Number(spell.uses.current || 0);

            if (currentUses > 0) {
              spell.uses.current = currentUses - 1;
            } else if (spellLevel > 0) {
              const derived = getDerivedStats(draft);
              const slotState = (derived.spellSlots || []).find(
                (slot) => Number(slot.level) === spellLevel
              );

              if (!slotState || slotState.available <= 0) {
                return draft;
              }

              const used = Number(spellcasting.slotsUsed[spellLevel] || 0);
              spellcasting.slotsUsed[spellLevel] = used + 1;
            }
          } else if (spellLevel > 0) {
            const derived = getDerivedStats(draft);
            const slotState = (derived.spellSlots || []).find(
              (slot) => Number(slot.level) === spellLevel
            );

            if (!slotState || slotState.available <= 0) {
              return draft;
            }

            const used = Number(spellcasting.slotsUsed[spellLevel] || 0);
            spellcasting.slotsUsed[spellLevel] = used + 1;
          }

          const turn = ensureTurnState(draft);
          if (castTime.includes("бонусное действие")) {
            turn.bonusActionUsed = true;
          } else {
            turn.actionUsed = true;
          }

          const combat = ensureCombatState(draft);
          if (setsConcentration) {
            combat.concentration = spell.name || "";
          }

          return draft;
        });

        return;
      }

      if (action === "toggle-jack-of-all-trades") {
        updateState((draft) => {
          if (!draft.ui || typeof draft.ui !== "object") {
            draft.ui = {};
          }

          if (!draft.ui.rulesOverrides || typeof draft.ui.rulesOverrides !== "object") {
            draft.ui.rulesOverrides = {};
          }

          draft.ui.rulesOverrides.disableJackOfAllTrades = !Boolean(
            draft.ui.rulesOverrides.disableJackOfAllTrades
          );

          return draft;
        });

        return;
      }
    });

    element.dataset.bound = "true";
  });
}

function bindEffectFields(root = document) {
  root.querySelectorAll("[data-bind-effect-field]").forEach((element) => {
    if (element.dataset.bound === "true") {
      return;
    }

    const isImmediate =
      element.type === "checkbox" ||
      element.dataset.bindImmediate === "true";

    const eventName = isImmediate ? "input" : "change";

    element.addEventListener(eventName, (event) => {
      const target = event.currentTarget;
      const effectId = target.dataset.effectId;
      const field = target.dataset.bindEffectField;
      const value = target.value;

      updateState((draft) => {
        const effect = (draft.ui.activeEffects || []).find((entry) => entry.id === effectId);
        if (!effect) {
          return draft;
        }

        effect[field] = value;
        return draft;
      });
    });

    element.dataset.bound = "true";
  });
}

function bindInventoryFields(root = document) {
  root.querySelectorAll("[data-bind-item-field]").forEach((element) => {
    if (element.dataset.bound === "true") {
      return;
    }

    const isImmediate =
      element.type === "checkbox" ||
      element.dataset.bindImmediate === "true";

    const eventName = isImmediate ? "input" : "change";

    element.addEventListener(eventName, (event) => {
      const target = event.currentTarget;
      const itemId = target.dataset.itemId;
      const field = target.dataset.bindItemField;

      let value;
      if (target.type === "checkbox") {
        value = target.checked;
      } else if (target.type === "number") {
        value = target.value === "" ? 0 : Number(target.value);
      } else {
        value = target.value;
      }

      updateState((draft) => {
        const inventory = ensureInventoryState(draft);
        const item = inventory.items.find((entry) => entry.id === itemId);
        if (!item) {
          return draft;
        }

        item[field] = value;
        return draft;
      });
    });

    element.dataset.bound = "true";
  });
}

function bindUi(root = document) {
  bindEditableFields(root);
  bindActionButtons(root);
  bindInventoryFields(root);
  bindEffectFields(root);
}

function renderApp() {
  const state = getState();
  const derived = getDerivedStats(state);

  const profilePanel = document.getElementById("profilePanel");
  const spellsPanel = document.getElementById("spellsPanel");

  console.log("state.spells", state.spellcasting?.spells);
  console.log("derived.combatCards", derived.combatCards);
  console.log("derived.combatCards.spells", derived.combatCards?.spells);

  renderHeader(state);
  renderPortraitMedia(state);
  renderQuickStats(state, derived);
  renderSidebarSummary(state);

  renderProfile(profilePanel, state, derived);
  renderMeleePanel(state, derived);
  renderSpells(spellsPanel, state, derived);
  renderInventoryPanel(state);
  renderLorePanel(state);

  bindUi(document);
  initPortraitControls();
}

function initApp() {
  initTabs();
  renderApp();
}

function debugDerived(character) {
  const derived = getDerivedStats(character);

  console.group("Derived debug");
  console.log("hasJackOfAllTrades", derived.hasJackOfAllTrades);
  console.log("abilityModifiers", derived.abilityModifiers);
  console.log("abilityChecks", derived.abilityChecks);
  console.log("savingThrows", derived.savingThrows);
  console.log("skills", derived.skills);
  console.log("spellSaveDc", derived.spellStats?.spellSaveDc);
  console.log("spellAttackBonus", derived.spellStats?.spellAttackBonus);
  console.log("initiative", derived.initiative);
  console.log("passivePerception", derived.passivePerception);
  console.groupEnd();

  console.assert(derived.abilityModifiers.strength === -1, "STR mod должен быть -1");
  console.assert(derived.abilityModifiers.dexterity === 3, "DEX mod должен быть +3");
  console.assert(derived.abilityModifiers.charisma === 3, "CHA mod должен быть +3");

  console.assert(derived.savingThrows.dexterity === 5, "DEX save должен быть +5");
  console.assert(derived.savingThrows.charisma === 5, "CHA save должен быть +5");
  console.assert(derived.savingThrows.wisdom === 0, "WIS save не должен получать JoAT");

  console.assert(derived.spellStats?.spellSaveDc === 13, "Spell Save DC должен быть 13");
  console.assert(derived.spellStats?.spellAttackBonus === 5, "Spell Attack Bonus должен быть +5");
  console.assert(derived.initiative === 3, "Initiative должна быть +3");

  if (derived.hasJackOfAllTrades) {
    console.assert(derived.abilityChecks.strength === 0, "STR check с JoAT должен быть 0");
    console.assert(derived.abilityChecks.dexterity === 4, "DEX check с JoAT должен быть +4");
    console.assert(derived.skills.athletics === 0, "Athletics с JoAT должен быть 0");
    console.assert(derived.skills.stealth === 4, "Stealth с JoAT должен быть +4");
    console.assert(derived.skills.perception === 1, "Perception с JoAT должен быть +1");
    console.assert(derived.skills.intimidation === 4, "Intimidation с JoAT должен быть +4");
    console.assert(derived.passivePerception === 11, "Passive Perception с JoAT должна быть 11");
  }

  console.log("combatCards", derived.combatCards);
  console.log("combatSpells", derived.combatCards?.spells);
  console.log(
    "rawSpells",
    (character.spellcasting?.spells || []).map((spell) => ({
      name: spell.name,
      combatRole: spell.combatRole,
      availableFromLevel: spell.availableFromLevel,
      locked: spell.locked
    }))
  );
}

window.__debug = {
  getState,
  getDerivedStats,
  debugDerived,
};

subscribe(() => {
  renderApp();
});

initApp();