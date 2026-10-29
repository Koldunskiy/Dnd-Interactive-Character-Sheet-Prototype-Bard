import { getItemRuleReference } from "../rule-reference.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderItemMetaRow(label, value) {
  if (value == null || value === "") {
    return "";
  }

  return `
    <div class="resource-row resource-row--hp-meta">
      <span class="resource-row-title">${escapeHtml(label)}</span>
      <span class="resource-row-meta">${escapeHtml(value)}</span>
    </div>
  `;
}

function formatItemResource(resource) {
  if (!resource || resource.max == null) {
    return "";
  }

  const current = Number(resource.current ?? 0);
  const max = Number(resource.max ?? 0);
  const refresh = resource.refresh ? ` · ${resource.refresh}` : "";

  return `${current}/${max}${refresh}`;
}

function renderItemResource(label, resource) {
  return renderItemMetaRow(label, formatItemResource(resource));
}

function renderWeaponSummary(item) {
  if (!item.weapon) {
    return "";
  }

  const weapon = item.weapon;
  const properties = Array.isArray(weapon.properties) ? weapon.properties.join(", ") : "";

  return `
    <div class="info-card-text">
      Атака: <strong>${escapeHtml(weapon.attackStat ?? "—")}</strong><br>
      Урон: <strong>${escapeHtml(weapon.damageDice ?? "—")}</strong><br>
      Тип урона: ${escapeHtml(weapon.damageType ?? "—")}<br>
      Свойства: ${escapeHtml(properties || "—")}
    </div>
  `;
}

function renderArmorSummary(item) {
  if (!item.armor) {
    return "";
  }

  const armor = item.armor;
  const dexCap = armor.dexCap == null ? "без ограничений" : armor.dexCap;

  return `
    <div class="info-card-text">
      Категория: <strong>${escapeHtml(armor.category ?? "—")}</strong><br>
      Базовый AC: <strong>${escapeHtml(armor.baseAc ?? "—")}</strong><br>
      Лимит DEX: ${escapeHtml(dexCap)}
    </div>
  `;
}

function renderFocusSummary(item) {
  if (!item.focus) {
    return "";
  }

  const classes = Array.isArray(item.focus.classes) ? item.focus.classes.join(", ") : "";
  const notes = item.focus.notes ? `<br>${escapeHtml(item.focus.notes)}` : "";

  return `
    <div class="info-card-text">
      Фокусировка для: <strong>${escapeHtml(classes || "—")}</strong><br>
      ${notes}
    </div>
  `;
}

function renderConsumableSummary(item) {
  if (!item.consumable) {
    return "";
  }

  return `
    <div class="info-card-text">
      Эффект: <strong>${escapeHtml(item.consumable.effect ?? "—")}</strong><br>
      Формула: <strong>${escapeHtml(item.consumable.formula ?? "—")}</strong>
    </div>
  `;
}

function getItemNoteRows(note) {
  const lines = String(note ?? "").split(/\r?\n/);
  const estimatedRows = lines.reduce(
    (total, line) => total + Math.max(1, Math.ceil(line.length / 18)),
    0,
  );

  return Math.max(3, estimatedRows);
}

function renderItemDetails(item) {
  const reference = getItemRuleReference(item);
  return [
    renderWeaponSummary(item),
    renderArmorSummary(item),
    renderFocusSummary(item),
    renderConsumableSummary(item),
    reference
      ? `<section class="inventory-rule-reference"><h4>Справка предмета</h4><p class="info-card-text">${escapeHtml(reference)}</p></section>`
      : "",
    item.notes
      ? `<section class="inventory-item-notes"><h4>Заметки предмета</h4><p class="info-card-text">${escapeHtml(item.notes)}</p></section>`
      : "",
  ]
    .filter(Boolean)
    .join("");
}

function renderItemSummary(item) {
  const summaryParts = [
    `Количество: ${item.quantity ?? 1}`,
    typeof item.equipped === "boolean"
      ? item.equipped
        ? "Используется"
        : "Не используется"
      : null,
    item.attuned ? "Настроен" : null,
    formatItemResource(item.uses)
      ? `Применения: ${formatItemResource(item.uses)}`
      : null,
    formatItemResource(item.charges)
      ? `Заряды: ${formatItemResource(item.charges)}`
      : null,
  ].filter(Boolean);

  return summaryParts.map(escapeHtml).join(" · ");
}

function renderInventoryItemCard(item, expandedItemIds = []) {
  const itemId = String(item.id ?? "");
  const isExpanded = expandedItemIds.includes(itemId);
  const contentId = `inventory-item-content-${escapeHtml(itemId)}`;
  const toggleLabel = isExpanded ? "Свернуть" : "Подробнее";

  return `
    <article class="inventory-item-card ${isExpanded ? "inventory-item-card--expanded" : "inventory-item-card--collapsed"}" data-item-id="${escapeHtml(itemId)}">
      <div class="inventory-item-main">
        <div class="inventory-item-main__title-wrap">
          <div class="inventory-item-title">${escapeHtml(item.name)}</div>
          <div class="inventory-item-summary">${renderItemSummary(item)}</div>
        </div>

        <div class="inventory-item-main__controls">
          <label class="inventory-equip-toggle">
            <input
              type="checkbox"
              data-action="inventory-toggle-equipped"
              data-item-id="${escapeHtml(itemId)}"
              ${item.equipped ? "checked" : ""}
            />
            <span>Надето / используется</span>
          </label>

          <button
            type="button"
            class="btn btn--utility inventory-toggle-btn"
            data-action="inventory-toggle-expand"
            data-item-id="${escapeHtml(itemId)}"
            aria-expanded="${isExpanded ? "true" : "false"}"
            aria-controls="${contentId}"
          >
            ${toggleLabel}
          </button>
        </div>
      </div>

      <div
        id="${contentId}"
        class="inventory-item-expandable"
        ${isExpanded ? "" : "hidden"}
      >
        <section class="inventory-item-details" aria-label="Подробности предмета">
          ${renderItemMetaRow("Тип", item.type ?? "misc")}
          ${renderItemMetaRow("Стакуемый", item.stackable ? "Да" : "Нет")}
          ${renderItemMetaRow(
            "Теги",
            Array.isArray(item.tags) && item.tags.length ? item.tags.join(", ") : "—",
          )}
          ${renderItemResource("Использования", item.uses)}
          ${renderItemResource("Заряды", item.charges)}

          ${renderItemDetails(item)}
        </section>

        <section class="inventory-item-edit" aria-label="Редактирование предмета">
          <h4 class="inventory-item-edit__title">Редактирование</h4>
          <p class="inventory-item-edit__note">Изменения сохраняются сразу.</p>

          <div class="inventory-item-edit__fields">
            <label class="inventory-edit-field inventory-edit-field--name">
              <span>Название</span>
              <input
                class="inventory-input inventory-input--name"
                type="text"
                value="${escapeHtml(item.name)}"
                data-bind-item-field="name"
                data-item-id="${escapeHtml(itemId)}"
                placeholder="Название предмета"
              />
            </label>

            <label class="inventory-edit-field inventory-edit-field--quantity">
              <span>Количество</span>
              <input
                class="inventory-input inventory-input--qty"
                type="number"
                min="0"
                step="1"
                value="${escapeHtml(item.quantity ?? 1)}"
                data-bind-item-field="quantity"
                data-item-id="${escapeHtml(itemId)}"
                placeholder="Кол-во"
              />
            </label>
            ${item.id === "amulet-of-health" ? `
              <label class="inventory-edit-field">
                <input type="checkbox" data-bind-item-field="attuned" data-item-id="${escapeHtml(itemId)}" ${item.attuned ? "checked" : ""}>
                <span>Настроен</span>
              </label>` : ""}

            <label class="inventory-edit-field inventory-edit-field--notes">
              <span>Заметки</span>
              <textarea
                class="inventory-textarea"
                rows="${getItemNoteRows(item.notes)}"
                data-bind-item-field="notes"
                data-item-id="${escapeHtml(itemId)}"
                placeholder="Заметка по предмету"
              >${escapeHtml(item.notes || "")}</textarea>
            </label>
          </div>
        </section>

        <div class="resource-controls inventory-item-actions">
          <button
            type="button"
            class="btn btn--utility"
            data-action="inventory-remove-item"
            data-item-id="${escapeHtml(itemId)}"
          >
            Удалить
          </button>
        </div>
      </div>
    </article>
  `;
}

export function renderInventoryPanel(state) {
  const inventoryPanel = document.getElementById("inventoryPanel");
  if (!inventoryPanel) {
    return;
  }

  const inventory = state.inventory ?? {};
  const itemsList = Array.isArray(inventory.items) ? inventory.items : [];
  const attunedCount = itemsList.filter((item) => item?.attuned === true).length;
  const currency = inventory.currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  const currencyMarkup = inventory.currencyStatus === "Не заполнено"
    ? `<p class="panel-text">Не заполнено</p>`
    : `<div class="currency-grid">
        ${["cp", "sp", "ep", "gp", "pp"].map((coin) => `
          <label class="currency-field">
            <span>${coin.toUpperCase()}</span>
            <input class="inventory-input" type="number" min="0" step="1"
              value="${escapeHtml(currency[coin] ?? 0)}" data-bind="inventory.currency.${coin}">
          </label>`).join("")}
      </div>`;
  const expandedItemIds = Array.isArray(state?.ui?.inventory?.expandedItemIds)
    ? state.ui.inventory.expandedItemIds
    : [];

  const items = itemsList
    .map((item) => renderInventoryItemCard(item, expandedItemIds))
    .join("");

  inventoryPanel.innerHTML = `
    <h2>Инвентарь</h2>
    ${state.profile?.id === "sara-velaris" ? `<p class="panel-text">Настроенные предметы: ${attunedCount}/3 ячеек.</p>` : ""}
    <p class="panel-text">
      Инвентарь хранит снаряжение, валюту и служит источником правды для оружия, брони, фокусов и расходников.
    </p>

    <div class="inventory-section-gap" aria-hidden="true"></div>

    <div class="cards-grid">
      <div class="info-card">
        <div class="info-card-title">Деньги</div>
        ${currencyMarkup}
      </div>

      <div class="info-card">
        <div class="info-card-title">Заметки</div>
        <textarea
          class="inventory-textarea inventory-textarea--large"
          rows="8"
          data-bind="inventory.notes"
          placeholder="Записи о снаряжении, добыче, долгах, квестовых предметах..."
        >${escapeHtml(inventory.notes || "")}</textarea>
      </div>
    </div>

    <div class="inventory-section-gap" aria-hidden="true"></div>

    <div class="inventory-header-row">
      <h3>Снаряжение · ${escapeHtml(inventory.otherItemsStatus === "Не заполнено" ? "остальные предметы не заполнены" : "")}</h3>
      <button type="button" class="btn" data-action="inventory-add-item">Добавить предмет</button>
    </div>

    <div class="inventory-list">
      ${
        items ||
        `<div class="info-card"><div class="info-card-text">Пока ничего не добавлено.</div></div>`
      }
    </div>
  `;
}