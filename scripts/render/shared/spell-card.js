export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatSpellLevel(level) {
  return Number(level) === 0 ? "Заговор" : `${level} круг`;
}

export function renderSpellBody(...parts) {
  const content = parts.filter(Boolean).join("");

  if (!content) {
    return "";
  }

  return `<div class="spell-body">${content}</div>`;
}

export function formatSpellSchoolLine(level, school) {
  const levelLabel = formatSpellLevel(level);

  if (!school) {
    return levelLabel;
  }

  return `${levelLabel}, ${school}`;
}

export function getBaseSpellFactItems(spell) {
  return [
    { label: "Время накладывания", value: spell.castTime ?? spell.castingTime },
    { label: "Дистанция", value: spell.range },
    { label: "Компоненты", value: spell.components },
    { label: "Длительность", value: spell.duration },
  ];
}

export function renderSpellFacts(items) {
  const rows = items.filter((item) => item?.label && item?.value);

  if (!rows.length) {
    return "";
  }

  return `
    <dl class="spell-facts">
      ${rows
        .map(
          (item) => `
            <div class="spell-fact">
              <dt class="spell-fact-label">${escapeHtml(item.label)}</dt>
              <dd class="spell-fact-value">${escapeHtml(item.value)}</dd>
            </div>
          `,
        )
        .join("")}
    </dl>
  `;
}

export function renderTextParagraph(className, value) {
  if (!value) {
    return "";
  }

  return `<p class="${className}">${escapeHtml(value)}</p>`;
}

export function renderSpellCardHeader({ name, originalName, badges }) {
  return `
    <div class="spell-card-header">
      <div class="spell-card-heading">
        <h3 class="spell-card-title">${escapeHtml(name)}</h3>
        ${
          originalName
            ? `<div class="spell-card-subtitle">${escapeHtml(originalName)}</div>`
            : ""
        }
      </div>

      <div class="spell-badges">
        ${(badges ?? []).join("")}
      </div>
    </div>
  `;
}

export function renderSpellSummaryLine(spell) {
  return `
    <p class="spell-card-summary">
      ${escapeHtml(formatSpellSchoolLine(spell.level, spell.school))}
    </p>
  `;
}