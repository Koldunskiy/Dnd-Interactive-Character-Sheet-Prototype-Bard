import { openSaraBattleCommand, requestCloseWorkspace } from "../workspace/controller.js";

export function openCharacterRollPanel() {
  return openSaraBattleCommand("character-roll").ok;
}

export function closeCharacterRollPanel() {
  return requestCloseWorkspace();
}

export function hasChangedCharacterRollDraft() {
  return false;
}

export function hasUnsavedCharacterRoll() {
  return false;
}

export function clearCharacterRollDraft() {}

export function markCharacterRollSaved() {}
