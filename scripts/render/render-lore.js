function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInfoCard(key, title, text, fallback = "—") {
  if (!text && text !== 0) {
    return `
      <details
        class="info-card profile-responsive-disclosure"
        data-profile-disclosure="lore-${escapeHtml(key)}"
        open
      >
        <summary class="info-card-title">${escapeHtml(title)}</summary>
        <div class="info-card-text">${escapeHtml(fallback)}</div>
      </details>
    `;
  }

  return `
    <details
      class="info-card profile-responsive-disclosure"
      data-profile-disclosure="lore-${escapeHtml(key)}"
      open
    >
      <summary class="info-card-title">${escapeHtml(title)}</summary>
      <div class="info-card-text">${escapeHtml(text)}</div>
    </details>
  `;
}

export function renderLorePanel(state) {
  const lorePanel = document.getElementById("lorePanel");
  if (!lorePanel) {
    return;
  }

  const disclosureState = new Map(
    [...lorePanel.querySelectorAll("details[data-profile-disclosure]")].map(
      (details) => [details.dataset.profileDisclosure, details.open],
    ),
  );
  const compact = window.matchMedia("(max-width: 899px)").matches;
  const lore = state.lore ?? {};

  const primaryCards = [
    renderInfoCard("appearance", "Внешний вид", lore.appearance),
    renderInfoCard("order", "Орден", lore.order),
    renderInfoCard("motivation", "Цель", lore.motivation),
    renderInfoCard("personality", "Характер", lore.personality),
  ].join("");

  const extraCards = [
    lore.racePerspective
      ? renderInfoCard("race-perspective", "Расовая перспектива", lore.racePerspective)
      : "",
    lore.performerIdentity
      ? renderInfoCard("performer-identity", "Сценический образ", lore.performerIdentity)
      : "",
    lore.trauma
      ? renderInfoCard("trauma", "Травма", lore.trauma)
      : "",
    lore.gmTriggers
      ? renderInfoCard("gm-triggers", "Триггеры для мастера", lore.gmTriggers)
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

    <details
      class="info-card profile-responsive-disclosure"
      data-profile-disclosure="lore-notes"
      open
    >
      <summary class="info-card-title">Заметки</summary>
      <textarea
        class="lore-notes-textarea"
        rows="10"
        data-bind="lore.notes"
        placeholder="Любые дополнительные заметки: связи, сцены из прошлого, манеры речи, секреты, отношение к союзникам, планы, зацепки для отыгрыша..."
      >${escapeHtml(lore.notes || "")}</textarea>
    </details>
  `;

  lorePanel
    .querySelectorAll("details[data-profile-disclosure]")
    .forEach((details) => {
      const key = details.dataset.profileDisclosure;
      details.open = disclosureState.has(key)
        ? disclosureState.get(key)
        : !compact;
    });
}