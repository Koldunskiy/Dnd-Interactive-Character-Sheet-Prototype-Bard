export const THEME_IDS = Object.freeze(["teal-slate", "wine-gold"]);

const CHARACTER_THEME_DEFAULTS = Object.freeze({
  "sara-velaris": "teal-slate",
  aurelia: "wine-gold",
});

const runtimeOverrides = new Map();

export function isThemeId(value) {
  return THEME_IDS.includes(value);
}

export function getCharacterThemeOverride(characterId, preferences) {
  const override = preferences?.themeOverrides?.[characterId];
  return isThemeId(override) ? override : null;
}

export function resolveCharacterTheme(characterId, preferences) {
  if (runtimeOverrides.has(characterId)) {
    return runtimeOverrides.get(characterId) ?? CHARACTER_THEME_DEFAULTS[characterId] ?? "wine-gold";
  }
  return getCharacterThemeOverride(characterId, preferences) ??
    CHARACTER_THEME_DEFAULTS[characterId] ?? "wine-gold";
}

export function getSelectedCharacterTheme(characterId, preferences) {
  if (runtimeOverrides.has(characterId)) {
    return runtimeOverrides.get(characterId) ?? "character";
  }
  return getCharacterThemeOverride(characterId, preferences) ?? "character";
}

export function setRuntimeCharacterThemeOverride(characterId, themeId) {
  if (!characterId || (themeId !== null && !isThemeId(themeId))) return false;
  runtimeOverrides.set(characterId, themeId);
  return true;
}

export function clearRuntimeCharacterThemeOverride(characterId) {
  runtimeOverrides.delete(characterId);
}

export function applyResolvedTheme(themeId, documentRef = globalThis.document) {
  if (!isThemeId(themeId) || !documentRef?.documentElement) return false;
  documentRef.documentElement.dataset.theme = themeId;
  const themeColor = documentRef.querySelector?.('meta[name="theme-color"]');
  if (themeColor) themeColor.content = themeId === "teal-slate" ? "#101722" : "#090607";
  return true;
}
