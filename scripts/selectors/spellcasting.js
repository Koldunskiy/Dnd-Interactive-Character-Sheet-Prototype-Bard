import { getBardCantripLimit, getBardPreparedSpellLimit } from "../rules.js";
import {
  SPELL_LIBRARY,
  SPELL_LIBRARY_BY_ID as SPELL_LIBRARY_INDEX,
} from "../../data/spell-library.js";

export const BARD_SPELL_LIBRARY_BY_ID = SPELL_LIBRARY_INDEX;

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
  if (!spellId) {
    return null;
  }

  return (
    BARD_SPELL_LIBRARY_BY_ID[spellId] ??
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

function isSpellIdSelected(selectedIds, spellId) {
  const canonicalTarget = resolveSpellById(spellId)?.id ?? spellId;

  return uniqueIds(selectedIds).some((id) => {
    if (id === spellId || id === canonicalTarget) {
      return true;
    }

    return resolveSpellById(id)?.id === canonicalTarget;
  });
}

export function isCantripSelected(character, spellId) {
  return isSpellIdSelected(character?.spellcasting?.cantripIds, spellId);
}

export function isPreparedSpellSelected(character, spellId) {
  return isSpellIdSelected(character?.spellcasting?.preparedSpellIds, spellId);
}

export function isGrantedSpell(character, spellId) {
  return isSpellIdSelected(character?.spellcasting?.grantedSpellIds, spellId);
}

export function findMissingSpellIds(character) {
  const spellcasting = character?.spellcasting ?? {};
  const allIds = [
    ...uniqueIds(spellcasting.cantripIds),
    ...uniqueIds(spellcasting.preparedSpellIds),
    ...uniqueIds(spellcasting.grantedSpellIds),
  ];

  return allIds.filter((spellId) => !resolveSpellById(spellId));
}