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

    let canonicalId = raw.id;

    if (!canonicalId) {
      canonicalId = Object.entries(SKILL_LABELS).find(([, label]) => label === raw.name)?.[0] ?? null;
    }

    if (!canonicalId) {
      continue;
    }

    const normalized = {
      ...raw,
      id: canonicalId,
      name: SKILL_LABELS[canonicalId] ?? raw.name ?? canonicalId,
      ability: SKILL_TO_ABILITY[canonicalId] ?? raw.ability ?? "",
      proficient: Boolean(raw.proficient),
      expertise: Boolean(raw.expertise),
      source: raw.source ?? null
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
      source: existing.source ?? normalized.source ?? null
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

export function loadPersistedState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return looksLikeCharacterState(parsed) ? parsed : null;
  } catch (error) {
    console.warn("Не удалось загрузить сохранённое состояние листа", error);
    return null;
  }
}

export function savePersistedState(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Не удалось сохранить состояние листа", error);
  }
}

export function clearPersistedState() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("Не удалось очистить сохранённое состояние листа", error);
  }
}

export function buildInitialState(baseState) {
  const persistedState = loadPersistedState();
  const baseClone = structuredClone(baseState);

  if (!persistedState) {
    if (Array.isArray(baseClone.skills)) {
      baseClone.skills = normalizeSkills(baseClone.skills);
    }
    return baseClone;
  }

  const merged = deepMerge(baseClone, persistedState);

  if (Array.isArray(merged.skills)) {
    merged.skills = normalizeSkills(merged.skills);
  }

  return merged;
}