import { getSaraHudModel, updateSaraHudRegion } from "./sara-hud.js";

export function renderHeader(state, derived = null) {
  const name = document.getElementById("heroName");
  const subtitle = document.getElementById("heroSubtitle");
  const rollShortcut = document.getElementById("characterRollShortcut");
  const saraResources = document.getElementById("saraHeaderResources");
  const characterName = state.profile?.name ?? "Безымянный персонаж";
  if (name) name.textContent = characterName;
  document.title = `${characterName} — лист персонажа`;
  if (subtitle) {
    subtitle.textContent = [
      state.profile?.race,
      state.profile?.className,
      state.profile?.subclass
    ].filter(Boolean).join(" · ");
  }
  if (rollShortcut) rollShortcut.hidden = state.profile?.id !== "sara-velaris";
  if (saraResources) {
    const isSara = state.profile?.id === "sara-velaris";
    saraResources.hidden = !isSara;
    if (isSara) {
      updateSaraHudRegion(saraResources, getSaraHudModel(state, derived ?? undefined), {
        presentation: "header",
      });
    } else {
      saraResources.replaceChildren();
    }
  }
}
