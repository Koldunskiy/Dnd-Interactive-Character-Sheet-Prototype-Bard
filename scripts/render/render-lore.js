function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderLorePanel(state) {
  const lorePanel = document.getElementById("lorePanel");
  if (!lorePanel) {
    return;
  }

  const lore = state.lore ?? {};

  const extraCards = [
    lore.racePerspective && `
      <div class="info-card">
        <div class="info-card-title">Расовая перспектива</div>
        <div class="info-card-text">${escapeHtml(lore.racePerspective)}</div>
      </div>
    `,
    lore.performerIdentity && `
      <div class="info-card">
        <div class="info-card-title">Сценический образ</div>
        <div class="info-card-text">${escapeHtml(lore.performerIdentity)}</div>
      </div>
    `
  ].filter(Boolean).join("");

  lorePanel.innerHTML = `
    <h2>Лор</h2>
    <div class="cards-grid">
      <div class="info-card">
        <div class="info-card-title">Внешний вид</div>
        <div class="info-card-text">${escapeHtml(lore.appearance || "—")}</div>
      </div>

      <div class="info-card">
        <div class="info-card-title">Орден</div>
        <div class="info-card-text">${escapeHtml(lore.order || "—")}</div>
      </div>

      <div class="info-card">
        <div class="info-card-title">Цель</div>
        <div class="info-card-text">${escapeHtml(lore.motivation || "—")}</div>
      </div>

      <div class="info-card">
        <div class="info-card-title">Характер</div>
        <div class="info-card-text">${escapeHtml(lore.personality || "—")}</div>
      </div>

      ${extraCards}
    </div>
  `;
}