export function renderHeader(state) {
  const name = document.getElementById("heroName");
  const subtitle = document.getElementById("heroSubtitle");
  const rollShortcut = document.getElementById("characterRollShortcut");
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
}
