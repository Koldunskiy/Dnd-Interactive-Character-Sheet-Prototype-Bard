export function renderHeader(state) {
  const header = document.getElementById("appHeader");
  if (!header) return;

  header.innerHTML = `
    <div class="app-header__main">
      <div>
        <p class="eyebrow">Character Sheet</p>
        <h1>${escapeHtml(state.profile?.name ?? "Безымянный персонаж")}</h1>
      </div>
      <div class="app-header__actions">
        ...
      </div>
    </div>
  `;
}