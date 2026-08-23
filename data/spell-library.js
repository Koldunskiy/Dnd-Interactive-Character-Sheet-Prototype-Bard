import { BARD_SPELL_LIBRARY } from "./bard-spells.generated.js";
import { EXTRA_SPELLS } from "./extra-spells.js";

function assertNoDuplicateSpellIds(spells) {
  const ids = new Set();

  for (const spell of spells) {
    if (ids.has(spell.id)) {
      throw new Error(`Duplicate spell ID: ${spell.id}`);
    }

    ids.add(spell.id);
  }
}

export const SPELL_LIBRARY = [
  ...BARD_SPELL_LIBRARY,
  ...EXTRA_SPELLS,
];

assertNoDuplicateSpellIds(SPELL_LIBRARY);

const canonicalSpellLibraryById = Object.fromEntries(
  SPELL_LIBRARY.map((spell) => [spell.id, spell]),
);

export const SPELL_LIBRARY_BY_ID = {
  ...canonicalSpellLibraryById,
};