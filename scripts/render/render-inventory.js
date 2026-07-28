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

function renderItemResource(label, resource) {
  if (!resource || resource.max == null) {
    return "";
  }

  const current = Number(resource.current ?? 0);
  const max = Number(resource.max ?? 0);
  const refresh = resource.refresh ? ` · ${resource.refresh}` : "";

  return renderItemMetaRow(label, `${current}/${max}${refresh}`);
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

  return `
    <div class="info-card-text">
      Фокусировка для: <strong>${escapeHtml(classes || "—")}</strong><br>
      ${item.focus.notes ? escapeHtml(item.focus.notes) : ""}
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

function renderItemDetails(item) {
  return [
    renderWeaponSummary(item),
    renderArmorSummary(item),
    renderFocusSummary(item),
    renderConsumableSummary(item),
  ]
    .filter(Boolean)
    .join("");
}

function renderInventoryItemCard(item, expandedItemIds = []) {
  const itemId = String(item.id ?? "");
  const isExpanded = expandedItemIds.includes(itemId);
  const contentId = `inventory-item-content-${escapeHtml(itemId)}`;
  const toggleLabel = isExpanded ? "Свернуть" : "Подробнее";

  const summaryParts = [
    item.type ? `Тип: ${item.type}` : null,
    item.equipped ? "Используется" : null,
    Number(item.quantity ?? 1) > 1 ? `Кол-во: ${item.quantity}` : null,
  ].filter(Boolean);

  return `
    <article class="inventory-item-card ${isExpanded ? "inventory-item-card--expanded" : "inventory-item-card--collapsed"}" data-item-id="${escapeHtml(itemId)}">
      <div class="inventory-item-main">
        <div class="inventory-item-main__title-wrap">
          <input
            class="inventory-input inventory-input--name"
            type="text"
            value="${escapeHtml(item.name)}"
            data-bind-item-field="name"
            data-item-id="${escapeHtml(itemId)}"
            placeholder="Название предмета"
          />
          ${
            summaryParts.length
              ? `<div class="inventory-item-summary">${escapeHtml(summaryParts.join(" · "))}</div>`
              : ""
          }
        </div>

        <div class="inventory-item-main__controls">
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
        ${renderItemMetaRow("Тип", item.type ?? "misc")}
        ${renderItemMetaRow("Стакуемый", item.stackable ? "Да" : "Нет")}
        ${renderItemMetaRow(
          "Теги",
          Array.isArray(item.tags) && item.tags.length ? item.tags.join(", ") : "—",
        )}
        ${renderItemResource("Использования", item.uses)}
        ${renderItemResource("Заряды", item.charges)}

        ${renderItemDetails(item)}

        <textarea
          class="inventory-textarea"
          rows="2"
          data-bind-item-field="notes"
          data-item-id="${escapeHtml(itemId)}"
          placeholder="Заметка по предмету"
        >${escapeHtml(item.notes || "")}</textarea>

        <div class="resource-controls">
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
  const currency = inventory.currency ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  const expandedItemIds = Array.isArray(state?.ui?.inventory?.expandedItemIds)
    ? state.ui.inventory.expandedItemIds
    : [];

  const items = itemsList
    .map((item) => renderInventoryItemCard(item, expandedItemIds))
    .join("");

  inventoryPanel.innerHTML = `
    <h2>Инвентарь</h2>
    <p class="panel-text">
      Инвентарь хранит снаряжение, валюту и служит источником правды для оружия, брони, фокусов и расходников.
    </p>

    <div style="height: 18px;"></div>

    <div class="cards-grid">
      <div class="info-card">
        <div class="info-card-title">Деньги</div>
        <div class="currency-grid">
          <label class="currency-field">
            <span>CP</span>
            <input
              class="inventory-input"
              type="number"
              min="0"
              step="1"
              value="${escapeHtml(currency.cp)}"
              data-bind="inventory.currency.cp"
            />
          </label>

          <label class="currency-field">
            <span>SP</span>
            <input
              class="inventory-input"
              type="number"
              min="0"
              step="1"
              value="${escapeHtml(currency.sp)}"
              data-bind="inventory.currency.sp"
            />
          </label>

          <label class="currency-field">
            <span>EP</span>
            <input
              class="inventory-input"
              type="number"
              min="0"
              step="1"
              value="${escapeHtml(currency.ep)}"
              data-bind="inventory.currency.ep"
            />
          </label>

          <label class="currency-field">
            <span>GP</span>
            <input
              class="inventory-input"
              type="number"
              min="0"
              step="1"
              value="${escapeHtml(currency.gp)}"
              data-bind="inventory.currency.gp"
            />
          </label>

          <label class="currency-field">
            <span>PP</span>
            <input
              class="inventory-input"
              type="number"
              min="0"
              step="1"
              value="${escapeHtml(currency.pp)}"
              data-bind="inventory.currency.pp"
            />
          </label>
        </div>
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

    <div style="height: 18px;"></div>

    <div class="inventory-header-row">
      <h3>Снаряжение</h3>
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