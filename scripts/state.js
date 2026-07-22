import { character } from "../data/character.js";
import {
  buildInitialState,
  savePersistedState,
  clearPersistedState
} from "./storage.js";

let state = buildInitialState(character);
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => listener(state));
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

function commit(nextState) {
  state = nextState;
  savePersistedState(state);
  notify();
}

export function getState() {
  return state;
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

export function updateState(updater) {
  const draft = cloneState(state);
  const nextDraft = updater(draft) ?? draft;
  commit(nextDraft);
}

export function resetState() {
  state = structuredClone(character);
  clearPersistedState();
  notify();
}

export function getValue(path) {
  return getByPath(state, path);
}