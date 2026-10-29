import { character } from "../data/character.js";
import {
  mergeCharacterState,
  normalizeCharacterState,
  loadCharacterState,
  saveCharacterState,
  clearPersistedState
} from "./storage.js";
import {
  APP_PREFERENCES_KEY,
  getCharacterDescriptor
} from "./characters.js";
import { getDerivedStats } from "./calculations.js";

let state = normalizeCharacterState(character);
let activeCharacterId = character.profile.id;
let sessionGeneration = 1;
let stateRevision = 0;
const listeners = new Set();
const completedOperations = new Map();
const MAX_REMEMBERED_OPERATIONS = 100;

function notify(metadata = null, persistenceResult = null) {
  const event = { ...(metadata ?? {}), persistenceResult };
  listeners.forEach((listener) => listener(state, event));
}

function cloneState(value) {
  return structuredClone(value);
}

function getByPath(obj, path) {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

function setByPath(obj, path, value) {
  const keys = path.split(".");
  const lastKey = keys.pop();

  let current = obj;
  for (const key of keys) {
    if (current[key] == null || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }

  current[lastKey] = value;
}

function commit(nextState, metadata = null) {
  if (state.profile?.id === "sara-velaris" && nextState.profile?.id === "sara-velaris") {
    const derived = getDerivedStats(nextState);
    nextState.combat.hp.current = Math.min(
      Math.max(0, Number(nextState.combat.hp.current)),
      derived.maxHitPoints
    );
    nextState.combat.ki.current = Math.min(
      Math.max(0, Number(nextState.combat.ki.current)),
      derived.monk.kiMaximum
    );
    nextState.combat.practiced.current = Math.min(
      Math.max(0, Number(nextState.combat.practiced.current)),
      derived.monk.practicedMaximum
    );
  }
  state = nextState;
  stateRevision += 1;
  const persistenceResult = saveCharacterState(state, getCharacterDescriptor(activeCharacterId));
  notify(metadata, persistenceResult);
  return persistenceResult;
}

export function getState() {
  return state;
}

export function getSessionContext() {
  return Object.freeze({
    characterId: activeCharacterId,
    sessionGeneration,
    stateRevision
  });
}

export function isCurrentSession(context) {
  return Boolean(context) &&
    context.characterId === activeCharacterId &&
    context.sessionGeneration === sessionGeneration;
}

export function openCharacterSession(characterId, loadState = loadCharacterState) {
  const descriptor = getCharacterDescriptor(characterId);
  if (!descriptor) return { status: "invalid", reason: `Unknown character ID: ${characterId}` };
  const loaded = loadState(descriptor);
  if (loaded.status === "invalid" || loaded.status === "unavailable") return loaded;
  const nextState = loaded.status === "missing"
    ? normalizeCharacterState(descriptor.defaults)
    : mergeCharacterState(descriptor.defaults, loaded.state);
  if (characterId === "sara-velaris") {
    const derived = getDerivedStats(nextState);
    nextState.combat.hp.current = Math.min(
      Math.max(0, Number(nextState.combat.hp.current)),
      derived.maxHitPoints
    );
    nextState.combat.ki.current = Math.min(
      Math.max(0, Number(nextState.combat.ki.current)),
      derived.monk.kiMaximum
    );
    nextState.combat.practiced.current = Math.min(
      Math.max(0, Number(nextState.combat.practiced.current)),
      derived.monk.practicedMaximum
    );
  }
  state = nextState;
  activeCharacterId = characterId;
  sessionGeneration += 1;
  stateRevision = 0;
  completedOperations.clear();
  notify({ kind: "session-open", characterId }, { ok: true, persisted: loaded.status === "loaded" });
  return { status: loaded.status, state, context: getSessionContext(), migrations: loaded.migrations ?? [] };
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setValue(path, value) {
  const draft = cloneState(state);
  setByPath(draft, path, value);
  commit(draft);
}

export function updateState(updater, metadata = null) {
  const draft = cloneState(state);
  const nextDraft = updater(draft) ?? draft;
  return commit(nextDraft, metadata);
}

export function updateSessionState(context, updater, {
  metadata = null,
  operationId = null,
  validate = null
} = {}) {
  if (!isCurrentSession(context)) return { status: "rejected", reason: "stale-session" };
  if (operationId && completedOperations.has(operationId)) {
    return { status: "rejected", reason: "duplicate-operation" };
  }
  if (context.stateRevision !== stateRevision) return { status: "rejected", reason: "stale-revision" };
  let validationReason;
  try {
    validationReason = validate?.(state);
  } catch (error) {
    return { status: "rejected", reason: error?.message ?? "operation-validation-failed" };
  }
  if (validationReason) return { status: "rejected", reason: validationReason };
  const draft = cloneState(state);
  let nextDraft;
  try {
    const updated = updater(draft);
    nextDraft = updated === false ? false : updated ?? draft;
  } catch (error) {
    return { status: "rejected", reason: error?.message ?? "operation-failed" };
  }
  if (nextDraft === false) {
    return { status: "unchanged", revision: stateRevision };
  }
  const persistence = commit(nextDraft, metadata);
  if (operationId) {
    completedOperations.set(operationId, stateRevision);
    while (completedOperations.size > MAX_REMEMBERED_OPERATIONS) {
      completedOperations.delete(completedOperations.keys().next().value);
    }
  }
  return { status: "applied", revision: stateRevision, persistence };
}

export function retryPersistedState() {
  const persistence = saveCharacterState(state, getCharacterDescriptor(activeCharacterId));
  notify({ kind: "persistence-retry" }, persistence);
  return persistence;
}

export function readAppPreferences(storage) {
  try {
    const targetStorage = storage ?? globalThis.window?.localStorage ?? null;
    if (!targetStorage) return { status: "unavailable", reason: "Local storage is unavailable." };
    const raw = targetStorage.getItem(APP_PREFERENCES_KEY);
    if (raw == null) return { status: "missing" };
    let value;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return { status: "invalid", reason: "Application preferences JSON is malformed." };
      }
      throw error;
    }
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        (value.lastCharacterId != null && !getCharacterDescriptor(value.lastCharacterId)) ||
        (value.lastTab != null && typeof value.lastTab !== "object")) {
      return { status: "invalid", reason: "Application preferences have an invalid shape." };
    }
    return { status: "loaded", preferences: value };
  } catch (error) {
    return { status: "unavailable", reason: error?.message ?? "Could not read application preferences." };
  }
}

export function saveAppPreferences(preferences, storage) {
  try {
    const targetStorage = storage ?? globalThis.window?.localStorage ?? null;
    if (!targetStorage) throw new Error("Local storage is unavailable.");
    targetStorage.setItem(APP_PREFERENCES_KEY, JSON.stringify(preferences));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

export function resetState() {
  const descriptor = getCharacterDescriptor(activeCharacterId);
  const confirmed = globalThis.window?.confirm?.(
    `Сбросить сохранение персонажа «${descriptor.defaults.profile.name}» и вернуть defaults?`,
  );
  if (!confirmed) return { ok: false, cancelled: true };
  state = normalizeCharacterState(descriptor.defaults);
  sessionGeneration += 1;
  stateRevision = 0;
  completedOperations.clear();
  const persistenceResult = clearPersistedState(descriptor);
  notify({ kind: "reset", characterId: activeCharacterId }, persistenceResult);
  return persistenceResult;
}

export function getValue(path) {
  return getByPath(state, path);
}