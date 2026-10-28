import { getBardCantripLimit, getBardPreparedSpellLimit } from "../rules.js";
import {
  SPELL_LIBRARY,
  SPELL_LIBRARY_BY_ID as SPELL_LIBRARY_INDEX,
} from "../../data/spell-library.js";

export const BARD_SPELL_LIBRARY_BY_ID = SPELL_LIBRARY_INDEX;

function uniqueIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string" && id))];
}

export function resolveSpellById(spellId) {
  if (!spellId) return null;
  return BARD_SPELL_LIBRARY_BY_ID[spellId]
    ?? BARD_SPELL_LIBRARY_BY_ID[`${spellId}-2014`]
    ?? null;
}

export function resolveOverrideById(overrides, spellId, resolvedSpell) {
  return overrides?.[resolvedSpell?.id] ?? overrides?.[spellId] ?? {};
}

function mergeSpellWithOverrides(baseSpell, override = {}) {
  return { ...baseSpell, ...override };
}

export function resolveSpellsByIds(spellIds, overrides = {}) {
  return uniqueIds(spellIds)
    .map((spellId) => {
      const baseSpell = resolveSpellById(spellId);
      if (!baseSpell) return null;
      return mergeSpellWithOverrides(
        baseSpell,
        resolveOverrideById(overrides, spellId, baseSpell),
      );
    })
    .filter(Boolean);
}

function isRacialSpell(spell) {
  return spell?.source === "racial";
}

function sortSpells(spells) {
  return [...spells].sort((left, right) =>
    left.level - right.level || String(left.name).localeCompare(String(right.name), "ru"),
  );
}

export function buildCharacterSpellCollections(character) {
  const spellcasting = character?.spellcasting ?? {};
  const level = character?.profile?.level ?? 1;
  const overrides = spellcasting.spellOverrides ?? {};
  const selections = [
    ["cantrip", uniqueIds(spellcasting.cantripIds)],
    ["known", uniqueIds(spellcasting.preparedSpellIds)],
    ["granted", uniqueIds(spellcasting.grantedSpellIds)],
  ];
  const byCanonicalId = new Map();
  const missingIds = [];

  for (const [membership, ids] of selections) {
    for (const rawId of ids) {
      const baseSpell = resolveSpellById(rawId);
      if (!baseSpell) {
        missingIds.push(rawId);
        continue;
      }
      const canonicalId = baseSpell.id;
      const spell = mergeSpellWithOverrides(
        baseSpell,
        resolveOverrideById(overrides, rawId, baseSpell),
      );
      const entry = byCanonicalId.get(canonicalId) ?? {
        ...spell,
        id: canonicalId,
        memberships: [],
        sourceIds: [],
      };
      Object.assign(entry, spell, { id: canonicalId });
      if (!entry.memberships.includes(membership)) entry.memberships.push(membership);
      if (!entry.sourceIds.includes(rawId)) entry.sourceIds.push(rawId);
      byCanonicalId.set(canonicalId, entry);
    }
  }

  const spells = sortSpells([...byCanonicalId.values()]);
  const cantrips = spells.filter((spell) => spell.level === 0);
  const knownSelections = spells.filter((spell) =>
    spell.memberships.includes("known") ||
    (spell.memberships.includes("granted") && spell.source === "magical-secret"),
  );
  const knownSpells = knownSelections.filter((spell) =>
    spell.level > 0 && !(isRacialSpell(spell) && spell.memberships.includes("granted")),
  );
  const racialSpells = spells.filter((spell) =>
    isRacialSpell(spell) && spell.level > 0 && spell.memberships.includes("granted"),
  );
  const classCantrips = cantrips.filter((spell) =>
    spell.memberships.includes("cantrip") &&
    !spell.memberships.includes("granted") &&
    !isRacialSpell(spell),
  );
  const preparedSpells = knownSpells;
  const grantedSpells = spells.filter((spell) => spell.memberships.includes("granted"));

  return {
    spells,
    cantrips,
    classCantrips,
    knownSpells,
    preparedSpells,
    racialSpells,
    grantedSpells,
    counts: {
      cantrips: cantrips.length,
      classCantrips: classCantrips.length,
      knownSpells: knownSelections.length,
      preparedSpells: knownSelections.length,
      racialSpells: racialSpells.length,
      grantedSpells: grantedSpells.length,
      nonracialLevelledSpells: knownSpells.length,
    },
    limits: {
      cantrips: getBardCantripLimit(level),
      classCantrips: getBardCantripLimit(level),
      knownSpells: getBardPreparedSpellLimit(level),
      preparedSpells: getBardPreparedSpellLimit(level),
    },
    missingIds: [...new Set(missingIds)],
  };
}

function isSpellIdSelected(selectedIds, spellId) {
  const canonicalTarget = resolveSpellById(spellId)?.id ?? spellId;
  return uniqueIds(selectedIds).some((id) => resolveSpellById(id)?.id === canonicalTarget || id === canonicalTarget);
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
  return buildCharacterSpellCollections(character).missingIds;
}

export { SPELL_LIBRARY };
