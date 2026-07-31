function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInfoCard(title, text, fallback = "—") {
  if (!text && text !== 0) {
    return `
      <div class="info-card">
        <div class="info-card-title">${escapeHtml(title)}</div>
        <div class="info-card-text">${escapeHtml(fallback)}</div>
      </div>
    `;
  }

  return `
    <div class="info-card">
      <div class="info-card-title">${escapeHtml(title)}</div>
      <div class="info-card-text">${escapeHtml(text)}</div>
    </div>
  `;
}

export function renderLorePanel(state) {
  const lorePanel = document.getElementById("lorePanel");
  if (!lorePanel) {
    return;
  }

  const lore = state.lore ?? {};

  const primaryCards = [
    renderInfoCard("Внешний вид", lore.appearance),
    renderInfoCard("Орден", lore.order),
    renderInfoCard("Цель", lore.motivation),
    renderInfoCard("Характер", lore.personality),
  ].join("");

  const extraCards = [
    lore.racePerspective
      ? renderInfoCard("Расовая перспектива", lore.racePerspective)
      : "",
    lore.performerIdentity
      ? renderInfoCard("Сценический образ", lore.performerIdentity)
      : "",
    lore.trauma
      ? renderInfoCard("Травма", lore.trauma)
      : "",
    lore.gmTriggers
      ? renderInfoCard("Триггеры для мастера", lore.gmTriggers)
      : "",
  ]
    .filter(Boolean)
    .join("");

  lorePanel.innerHTML = `
    <h2>Лор</h2>

    <div class="cards-grid">
      ${primaryCards}
      ${extraCards}
    </div>

    <div style="height: 18px;"></div>

    <div class="info-card">
      <div class="info-card-title">Заметки</div>
      <textarea
        class="lore-notes-textarea"
        rows="10"
        data-bind="lore.notes"
        placeholder="Любые дополнительные заметки: связи, сцены из прошлого, манеры речи, секреты, отношение к союзникам, планы, зацепки для отыгрыша..."
      >${escapeHtml(lore.notes || "")}</textarea>
    </div>
  `;
}