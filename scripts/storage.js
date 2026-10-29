import { migrateLoreNotes } from "./lore-notes.js";
import { getCharacterDescriptor } from "./characters.js";

const STORAGE_KEY = "aurelia-character-sheet:v2";

const SKILL_LABELS = {
  athletics: "Атлетика",
  acrobatics: "Акробатика",
  sleightOfHand: "Ловкость рук",
  stealth: "Скрытность",
  arcana: "Магия",
  history: "История",
  investigation: "Расследование",
  nature: "Природа",
  religion: "Религия",
  animalHandling: "Уход за животными",
  insight: "Проницательность",
  medicine: "Медицина",
  perception: "Восприятие",
  survival: "Выживание",
  deception: "Обман",
  intimidation: "Запугивание",
  performance: "Выступление",
  persuasion: "Убеждение"
};

const SKILL_TO_ABILITY = {
  athletics: "strength",
  acrobatics: "dexterity",
  sleightOfHand: "dexterity",
  stealth: "dexterity",
  arcana: "intelligence",
  history: "intelligence",
  investigation: "intelligence",
  nature: "intelligence",
  religion: "intelligence",
  animalHandling: "wisdom",
  insight: "wisdom",
  medicine: "wisdom",
  perception: "wisdom",
  survival: "wisdom",
  deception: "charisma",
  intimidation: "charisma",
  performance: "charisma",
  persuasion: "charisma"
};

function normalizeSkills(skills) {
  if (!Array.isArray(skills)) {
    return [];
  }

  const byId = new Map();

  for (const raw of skills) {
    if (!raw || typeof raw !== "object") {
      continue;
    }

    let canonicalId = raw.id ?? null;

    if (!canonicalId && raw.name) {
      canonicalId =
        Object.entries(SKILL_LABELS).find(([, label]) => label === raw.name)?.[0] ??
        null;
    }

    if (!canonicalId || !SKILL_LABELS[canonicalId]) {
      continue;
    }

    const proficient = Boolean(raw.proficient);
    const expertise = Boolean(raw.expertise);

    const normalized = {
      id: canonicalId,
      name: SKILL_LABELS[canonicalId],
      ability: SKILL_TO_ABILITY[canonicalId],
      proficient: proficient || expertise,
      expertise,
      source: raw.source ?? null,
    };

    const existing = byId.get(canonicalId);
    if (!existing) {
      byId.set(canonicalId, normalized);
      continue;
    }

    byId.set(canonicalId, {
      ...existing,
      ...normalized,
      proficient: Boolean(existing.proficient || normalized.proficient),
      expertise: Boolean(existing.expertise || normalized.expertise),
      source: existing.source ?? normalized.source ?? null,
    });
  }

  return Array.from(byId.values());
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override ?? base;
  }

  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override ?? base;
  }

  const result = { ...base };

  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = base[key];

    if (Array.isArray(overrideValue)) {
      result[key] = overrideValue;
      continue;
    }

    if (isPlainObject(overrideValue) && isPlainObject(baseValue)) {
      result[key] = deepMerge(baseValue, overrideValue);
      continue;
    }

    result[key] = overrideValue;
  }

  return result;
}

function looksLikeCharacterState(value) {
  return (
    isPlainObject(value) &&
    isPlainObject(value.profile) &&
    isPlainObject(value.abilities) &&
    isPlainObject(value.combat) &&
    isPlainObject(value.spellcasting)
  );
}

function getStorage(storage) {
  return storage ?? globalThis.window?.localStorage ?? null;
}

function isKnownStateShape(value) {
  return looksLikeCharacterState(value) &&
    typeof value.profile.id === "string" &&
    (value.schemaVersion == null || Number.isInteger(value.schemaVersion));
}

function validatePersistedIdentity(parsed, descriptor) {
  if (!isKnownStateShape(parsed)) return "Saved character shape is invalid.";
  if (parsed.profile.id !== descriptor.id) return "Saved character ID does not match its storage key.";
  if (descriptor.id === "aurelia") {
    if (parsed.schemaVersion != null && parsed.schemaVersion !== 1) {
      return `Unsupported Aurelia schema version: ${parsed.schemaVersion}.`;
    }
    if (parsed.profile.rulesetId != null && parsed.profile.rulesetId !== descriptor.rulesetId) {
      return `Unsupported Aurelia ruleset: ${parsed.profile.rulesetId}.`;
    }
    return null;
  }
  if (parsed.schemaVersion !== 1) return `Unsupported character schema version: ${parsed.schemaVersion ?? "missing"}.`;
  if (parsed.profile.rulesetId !== descriptor.rulesetId) {
    return `Unsupported character ruleset: ${parsed.profile.rulesetId ?? "missing"}.`;
  }
  const abilities = parsed.abilities;
  if (!["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]
    .every((ability) => Number.isInteger(abilities[ability]) && abilities[ability] >= 1 && abilities[ability] <= 30)) {
    return "Sara saved ability scores are invalid.";
  }
  if (!Number.isInteger(parsed.profile.level) || parsed.profile.level < 1 || parsed.profile.level > 20) {
    return "Sara saved monk level is invalid.";
  }
  if (!parsed.monk || parsed.monk.schemaVersion !== 1 ||
      !Array.isArray(parsed.monk.ordinaryTechniqueIds) ||
      !parsed.monk.signatureTechniqueSlots || typeof parsed.monk.signatureTechniqueSlots !== "object" ||
      !parsed.combat?.hp || !Number.isInteger(parsed.combat.hp.current) || parsed.combat.hp.current < 0 ||
      !Number.isInteger(parsed.combat.hp.temp) || parsed.combat.hp.temp < 0 ||
      !Number.isInteger(parsed.combat.ki?.current) || parsed.combat.ki.current < 0 ||
      !Number.isInteger(parsed.combat.practiced?.current) || parsed.combat.practiced.current < 0 ||
      !Number.isInteger(parsed.combat.hitDice?.remaining) ||
      parsed.combat.hitDice.remaining < 0 || parsed.combat.hitDice.remaining > parsed.profile.level ||
      !Array.isArray(parsed.inventory?.items) ||
      !Array.isArray(parsed.spellcasting?.racialSpells) ||
      !Array.isArray(parsed.lore?.noteEntries) ||
      parsed.lore.notesMigrationVersion !== 1) {
    return "Sara saved state is missing required schema fields.";
  }
  return null;
}

export function loadCharacterState(descriptor, { storage } = {}) {
  let targetStorage;
  try {
    targetStorage = getStorage(storage);
  } catch (error) {
    return { status: "unavailable", reason: error?.message ?? "Local storage is unavailable." };
  }
  if (!targetStorage) return { status: "unavailable", reason: "Local storage is unavailable." };
  try {
    const raw = targetStorage.getItem(descriptor.storageKey);
    if (raw == null) return { status: "missing" };
    const parsed = JSON.parse(raw);
    const reason = validatePersistedIdentity(parsed, descriptor);
    if (reason) return { status: "invalid", reason };
    const migrations = [];
    if (parsed.schemaVersion == null) migrations.push("legacy-aurelia-schema");
    if (parsed.lore?.notesMigrationVersion !== 1) migrations.push("lore-notes");
    return { status: "loaded", state: parsed, migrations };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { status: "invalid", reason: "Saved character JSON is malformed." };
    }
    return { status: "unavailable", reason: error?.message ?? "Could not read local storage." };
  }
}

export function loadPersistedState(descriptor = getCharacterDescriptor("aurelia"), options = {}) {
  const result = loadCharacterState(descriptor, options);
  return result.status === "loaded" ? result.state : null;
}

export function saveCharacterState(state, descriptor = getCharacterDescriptor(state?.profile?.id), { storage } = {}) {
  if (!descriptor || state?.profile?.id !== descriptor.id) {
    return { ok: false, error: new Error("Character identity does not match its descriptor.") };
  }
  const reason = validatePersistedIdentity(state, descriptor);
  if (reason) return { ok: false, error: new Error(reason) };
  let targetStorage;
  try {
    targetStorage = getStorage(storage);
  } catch (error) {
    return { ok: false, error };
  }
  if (!targetStorage) return { ok: false, error: new Error("Local storage is unavailable.") };
  try {
    targetStorage.setItem(descriptor.storageKey, JSON.stringify(state));
    return { ok: true };
  } catch (error) {
    console.warn("Не удалось сохранить состояние листа", error);
    return { ok: false, error };
  }
}

export function savePersistedState(state) {
  return saveCharacterState(state);
}

export function clearPersistedState(descriptor = getCharacterDescriptor("aurelia"), { storage } = {}) {
  let targetStorage;
  try {
    targetStorage = getStorage(storage);
  } catch (error) {
    return { ok: false, error };
  }
  if (!targetStorage || !descriptor) return { ok: false, error: new Error("Local storage is unavailable.") };
  try {
    targetStorage.removeItem(descriptor.storageKey);
    return { ok: true };
  } catch (error) {
    console.warn("Не удалось очистить сохранённое состояние листа", error);
    return { ok: false, error };
  }
}

export function buildInitialState(baseState, descriptor = getCharacterDescriptor(baseState?.profile?.id)) {
  if (!descriptor) throw new Error("No character descriptor matches the requested defaults.");
  const loaded = loadCharacterState(descriptor);
  if (loaded.status === "invalid" || loaded.status === "unavailable") {
    throw new Error(`Character state ${loaded.status}: ${loaded.reason}`);
  }
  const baseClone = structuredClone(baseState);

  if (loaded.status === "missing") {
    return normalizeCharacterState(baseClone);
  }

  return mergeCharacterState(baseClone, loaded.state);
}

export function mergeCharacterState(baseState, persistedState) {
  const merged = deepMerge(structuredClone(baseState), persistedState);
  if (!isKnownStateShape(merged)) throw new Error("Merged character state has an invalid shape.");
  if (Array.isArray(merged.skills)) {
    merged.skills = normalizeSkills(merged.skills);
  }

  const migratedLore = migrateLoreNotes(merged.lore);
  merged.lore = migratedLore.lore;
  if (merged.lore && typeof merged.lore === "object" && !Array.isArray(merged.lore)) {
    if (migratedLore.issue) merged.lore.notesMigrationIssue = migratedLore.issue;
    else delete merged.lore.notesMigrationIssue;
  }
  return merged;
}

export function normalizeCharacterState(state) {
  const normalized = structuredClone(state);
  if (Array.isArray(normalized.skills)) normalized.skills = normalizeSkills(normalized.skills);
  const migratedLore = migrateLoreNotes(normalized.lore);
  normalized.lore = migratedLore.lore;
  if (migratedLore.issue && normalized.lore && typeof normalized.lore === "object" && !Array.isArray(normalized.lore)) {
    normalized.lore.notesMigrationIssue = migratedLore.issue;
  }
  return normalized;
}