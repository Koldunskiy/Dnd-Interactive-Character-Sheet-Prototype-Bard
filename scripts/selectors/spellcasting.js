import { getBardCantripLimit, getBardPreparedSpellLimit } from "../rules.js";
import { BARD_SPELL_LIBRARY } from "../../data/bard-spells.js";

export const BARD_SPELL_LIBRARY_BY_ID = Object.fromEntries(
  BARD_SPELL_LIBRARY.map((spell) => [spell.id, spell]),
);

function uniqueIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
}

function mergeSpellWithOverrides(baseSpell, override = {}) {
  return {
    ...baseSpell,
    ...override,
  };
}

function resolveSpellById(spellId) {
  return (
    BARD_SPELL_LIBRARY_BY_ID[spellId] ??
    BARD_SPELL_LIBRARY_BY_ID[`${spellId}-2024`] ??
    BARD_SPELL_LIBRARY_BY_ID[`${spellId}-2014`] ??
    null
  );
}

function resolveOverrideById(overrides, spellId, resolvedSpell) {
  if (overrides[spellId]) {
    return overrides[spellId];
  }

  if (resolvedSpell?.id && overrides[resolvedSpell.id]) {
    return overrides[resolvedSpell.id];
  }

  return {};
}

function resolveSpellsByIds(spellIds, overrides) {
  return uniqueIds(spellIds)
    .map((spellId) => {
      const baseSpell = resolveSpellById(spellId);

      if (!baseSpell) {
        console.warn("[spellcasting] Unknown spell id:", spellId);
        return null;
      }

      return mergeSpellWithOverrides(
        baseSpell,
        resolveOverrideById(overrides, spellId, baseSpell),
      );
    })
    .filter(Boolean);
}

function sortSpells(spells) {
  return [...spells].sort((left, right) => {
    if (left.level !== right.level) {
      return left.level - right.level;
    }

    return String(left.name).localeCompare(String(right.name), "ru");
  });
}

export function buildCharacterSpellCollections(character) {
  const spellcasting = character?.spellcasting ?? {};
  const level = character?.profile?.level ?? 1;
  const overrides = spellcasting.spellOverrides ?? {};

  const cantripIds = uniqueIds(spellcasting.cantripIds);
  const preparedSpellIds = uniqueIds(spellcasting.preparedSpellIds);
  const grantedSpellIds = uniqueIds(spellcasting.grantedSpellIds);

  const grantedSpellIdSet = new Set(grantedSpellIds);

  const cantrips = sortSpells(
    resolveSpellsByIds(
      cantripIds.filter((id) => !grantedSpellIdSet.has(id)),
      overrides,
    ),
  );

  const preparedSpells = sortSpells(
    resolveSpellsByIds(
      preparedSpellIds.filter((id) => !grantedSpellIdSet.has(id)),
      overrides,
    ),
  );

  const grantedSpells = sortSpells(resolveSpellsByIds(grantedSpellIds, overrides));

  return {
    cantrips,
    preparedSpells,
    grantedSpells,
    counts: {
      cantrips: cantrips.length,
      preparedSpells: preparedSpells.length,
      grantedSpells: grantedSpells.length,
    },
    limits: {
      cantrips: getBardCantripLimit(level),
      preparedSpells: getBardPreparedSpellLimit(level),
    },
  };
}

export function isCantripSelected(character, spellId) {
  const cantripIds = uniqueIds(character?.spellcasting?.cantripIds);
  return cantripIds.includes(spellId);
}

export function isPreparedSpellSelected(character, spellId) {
  const preparedSpellIds = uniqueIds(character?.spellcasting?.preparedSpellIds);
  return preparedSpellIds.includes(spellId);
}

export function isGrantedSpell(character, spellId) {
  const grantedSpellIds = uniqueIds(character?.spellcasting?.grantedSpellIds);
  return grantedSpellIds.includes(spellId);
}

export function findMissingSpellIds(character) {
  const spellcasting = character?.spellcasting ?? {};
  const allIds = [
    ...uniqueIds(spellcasting.cantripIds),
    ...uniqueIds(spellcasting.preparedSpellIds),
    ...uniqueIds(spellcasting.grantedSpellIds),
  ];

  return allIds.filter((spellId) => !BARD_SPELL_LIBRARY_BY_ID[spellId]);
}