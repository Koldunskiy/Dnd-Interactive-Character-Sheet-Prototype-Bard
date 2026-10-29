import { character as aurelia } from "../data/character.js";
import { sara } from "../data/sara.js";

export const CHARACTER_DESCRIPTORS = Object.freeze({
  aurelia: Object.freeze({
    id: "aurelia",
    defaults: aurelia,
    storageKey: "aurelia-character-sheet:v2",
    rulesetId: "bard-2014-swords",
    tabs: Object.freeze(["profile", "melee", "spells", "inventory", "lore", "spell-library"])
  }),
  "sara-velaris": Object.freeze({
    id: "sara-velaris",
    defaults: sara,
    storageKey: "character-sheet:sara-velaris:v1",
    rulesetId: "laserllama-alternate-monk-open-hand-snapshot-2026-10-29",
    tabs: Object.freeze(["profile", "melee", "techniques", "inventory", "lore"])
  })
});

export const APP_PREFERENCES_KEY = "character-sheet:app:v1";

export function getCharacterDescriptor(characterId) {
  return CHARACTER_DESCRIPTORS[characterId] ?? null;
}
