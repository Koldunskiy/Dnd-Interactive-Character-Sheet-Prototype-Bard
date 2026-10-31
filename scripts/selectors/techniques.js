import {
  CLERIC_CANTRIPS,
  MONK_TECHNIQUES,
  MONK_TECHNIQUE_BY_ID,
  WARRIOR_ADEPT_STYLES
} from "../../data/monk-techniques.js";

const SEARCH_FIELDS = ["nameEn", "nameRu", "description"];

function selectedIds(character) {
  const monk = character.monk ?? {};
  return new Set([
    ...(Array.isArray(monk.ordinaryTechniqueIds) ? monk.ordinaryTechniqueIds : []),
    ...Object.values(monk.signatureTechniqueSlots ?? {})
  ]);
}

export function getTechniqueAvailability(character, technique) {
  const level = Number(character.profile?.level ?? 1);
  if (level < technique.minimumMonkLevel) {
    return { available: false, reason: `Требуется уровень монаха ${technique.minimumMonkLevel}.` };
  }
  for (const requiredId of technique.prerequisites ?? []) {
    if (!selectedIds(character).has(requiredId)) {
      const required = MONK_TECHNIQUE_BY_ID.get(requiredId);
      return { available: false, reason: `Требуется выбранная техника «${required?.nameRu ?? requiredId}».` };
    }
  }
  if (technique.id === "ll-monk:warrior-adept") {
    const styleId = character.monk?.techniqueChoices?.[technique.id]?.styleId;
    const style = WARRIOR_ADEPT_STYLES.find((entry) => entry.id === styleId);
    if (!style || !meetsStylePrerequisites(character, style)) {
      return { available: false, reason: "Выберите доступный стиль Warrior Adept и выполните его предварительные требования." };
    }
  }
  if (technique.id === "ll-monk:divine-light") {
    const choices = character.monk?.techniqueChoices?.[technique.id]?.clericCantripIds;
    if (!Array.isArray(choices) || choices.length !== 2 ||
        new Set(choices).size !== 2 ||
        choices.some((id) => !CLERIC_CANTRIPS.some((spell) => spell.id === id))) {
      return { available: false, reason: "Для Divine Light нужны два разных выбранных заговора." };
    }
  }
  return { available: true, reason: null };
}

function meetsStylePrerequisites(character, style) {
  const abilities = character.abilities ?? {};
  const skills = new Set((character.skills ?? [])
    .filter((entry) => entry.proficient || entry.expertise)
    .map((entry) => entry.id));
  return style.prerequisites.every((requirement) => {
    if (requirement === "DEX 13") return Number(abilities.dexterity) >= 13;
    if (requirement === "STR 11") return Number(abilities.strength) >= 11;
    if (requirement === "STR 11 или DEX 11") {
      return Number(abilities.strength) >= 11 || Number(abilities.dexterity) >= 11;
    }
    if (requirement === "Владение Восприятием") return skills.has("perception");
    if (requirement === "Акробатика") return skills.has("acrobatics");
    return false;
  });
}

export function getEffectiveSelectedTechniqueIds(character) {
  const stored = selectedIds(character);
  const level = Number(character.profile?.level ?? 1);
  const effective = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of stored) {
      if (effective.has(id)) continue;
      const technique = MONK_TECHNIQUE_BY_ID.get(id);
      if (!technique || level < technique.minimumMonkLevel) continue;
      if ((technique.prerequisites ?? []).some((requiredId) => !effective.has(requiredId))) continue;
      const availability = getTechniqueAvailability(character, technique);
      if (!availability.available) continue;
      effective.add(id);
      changed = true;
    }
  }
  return effective;
}

export function isTechniqueEffectivelySelected(character, techniqueId) {
  return getEffectiveSelectedTechniqueIds(character).has(techniqueId);
}

export function getTechniqueCollections(character, {
  query = "",
  source = "all",
  type = "all",
  filter = "all"
} = {}) {
  const chosen = selectedIds(character);
  const effective = getEffectiveSelectedTechniqueIds(character);
  const normalizedQuery = String(query).trim().toLocaleLowerCase("ru");
  return MONK_TECHNIQUES.filter((entry) => {
    const availability = getTechniqueAvailability(character, entry);
    if (filter === "selected" && !chosen.has(entry.id)) return false;
    if (filter === "available" && (!availability.available || chosen.has(entry.id))) return false;
    if (source !== "all" && entry.sourceId !== source) return false;
    if (type !== "all" && entry.category !== type) return false;
    return !normalizedQuery || SEARCH_FIELDS.some((field) =>
      String(entry[field] ?? "").toLocaleLowerCase("ru").includes(normalizedQuery));
  }).map((entry) => ({
    ...entry,
    selected: chosen.has(entry.id),
    effective: effective.has(entry.id),
    availability: getTechniqueAvailability(character, entry)
  }));
}

export function getEffectiveTechniqueIds(character) {
  const ids = [...getEffectiveSelectedTechniqueIds(character)];
  const level = Number(character.profile?.level ?? 1);
  if (level >= 1) ids.push("base:martial-arts", "base:unarmored-defense");
  if (level >= 2) ids.push("base:ki", "base:flurry-of-blows", "base:unarmored-movement");
  if (level >= 5) ids.push("base:extra-attack");
  if (level >= 6) ids.push("base:enlightened-strikes", "base:ebb-and-flow");
  if (level >= 7) ids.push("base:evasion");
  if (level >= 10) ids.push("base:open-hand-strike", "base:master-of-many-forms");
  if (level >= 11) ids.push("base:warriors-spirit");
  if (level >= 13) ids.push("base:purity-of-body");
  if (level >= 14) ids.push("base:purity-of-mind");
  if (level >= 15) ids.push("base:timeless-body");
  if (level >= 20) ids.push("base:purity-spirit");
  return ids;
}

export function validateTechniqueSelectionIds(ids) {
  if (!Array.isArray(ids)) return "Выбор техник повреждён.";
  if (new Set(ids).size !== ids.length) return "Одна техника не может занимать несколько слотов.";
  const unknown = ids.find((id) => !MONK_TECHNIQUE_BY_ID.has(id));
  return unknown ? `Неизвестный ID техники: ${unknown}.` : null;
}

export function getClericCantrip(id) {
  return CLERIC_CANTRIPS.find((cantrip) => cantrip.id === id) ?? null;
}
