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
      const currentHp = state.combat?.hp?.current ?? "—";
      const maxHp = derived?.maxHitPoints ?? "—";
      const currentKi = state.combat?.ki?.current ?? "—";
      const maxKi = derived?.monk?.kiMaximum ?? "—";
      const currentPracticed = state.combat?.practiced?.current ?? 0;
      const maxPracticed = derived?.monk?.practicedMaximum ?? "—";
      saraResources.replaceChildren();
      for (const [label, value] of [
        ["HP", `${currentHp}/${maxHp}`],
        ["Ци", `${currentKi}/${maxKi}`],
        ["Отработано", `${currentPracticed}/${maxPracticed}`],
      ]) {
        const item = document.createElement("span");
        const strong = document.createElement("strong");
        item.append(`${label} `, strong);
        strong.textContent = value;
        saraResources.append(item);
      }
    } else {
      saraResources.replaceChildren();
    }
  }
}
