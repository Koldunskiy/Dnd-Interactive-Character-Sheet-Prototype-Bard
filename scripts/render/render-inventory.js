import { getItemRuleReference } from "../rule-reference.js";
import { setPanelMarkup } from "./sara-dom.js";

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

function itemTypeLabel(type) {
  return ({
    armor: "Доспех",
    consumable: "Расходник",
    focus: "Фокус",
    misc: "Разное",
    tool: "Инструмент",
    weapon: "Оружие",
  })[type] ?? "";
}

function itemRarityLabel(rarity) {
  return ({
    common: "Обычный",
    uncommon: "Необычный",
    rare: "Редкий",
    "very-rare": "Очень редкий",
    legendary: "Легендарный",
    artifact: "Артефакт",
  })[rarity] ?? "";
}

function renderItemMainEffect(item) {
  if (item.id === "amulet-of-health") {
    return `<p class="inventory-item-effect">Эффективное Телосложение равно 19, если базовое значение ниже 19.</p>`;
  }
  if (item.id === "insignia-of-claws" && typeof item.description === "string") {
    const additionalLimits = item.description.indexOf(" Не повышает");
    const effect = additionalLimits > 0
      ? item.description.slice(0, additionalLimits)
      : item.description;
    return effect
      ? `<p class="inventory-item-effect">${escapeHtml(effect)}</p>`
      : "";
  }
  return "";
}

function renderItemIcon(item) {
  const type = item?.type ?? (item?.weapon ? "weapon" : item?.armor ? "armor" :
    item?.focus ? "focus" : item?.consumable ? "consumable" : "misc");
  const paths = {
    weapon: '<path d="m6 18 12-12M14 5l5 5M4 20l5-1-4-4-1 5Z"/>',
    armor: '<path d="M12 3 19 6v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3Z"/><path d="M9 10h6"/>',
    focus: '<path d="M12 3v18M5 8h14M7 8l-3 6h6L7 8Zm10 0-3 6h6l-3-6Z"/>',
    consumable: '<path d="M9 3h6M10 3v5l-4 5v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6l-4-5V3M7 14h10"/>',
    misc: '<path d="M5 5h14v14H5zM8 9h8M8 12h8M8 15h5"/>',
  };
  const icon = paths[type] ?? paths.misc;
  return `<svg class="inventory-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`;
}

function renderInventoryItemCard(item, expandedItemIds = [], isSara = false) {
  const itemId = String(item.id ?? "");
  const isExpanded = expandedItemIds.includes(itemId);
  const contentId = `inventory-item-content-${escapeHtml(itemId)}`;
  const toggleLabel = isExpanded ? "Свернуть" : "Подробнее";
  if (!isSara) {
    return `
      <article class="inventory-item-card ${isExpanded ? "inventory-item-card--expanded" : "inventory-item-card--collapsed"}" data-item-id="${escapeHtml(itemId)}">
        <div class="inventory-item-main">
          <div class="inventory-item-main__title-wrap">
            <div class="inventory-item-title">${escapeHtml(item.name)}</div>
            <div class="inventory-item-summary">${renderItemSummary(item)}</div>
          </div>
          <div class="inventory-item-main__controls">
            <label class="inventory-equip-toggle"><input type="checkbox" data-action="inventory-toggle-equipped"
              data-item-id="${escapeHtml(itemId)}" ${item.equipped ? "checked" : ""}>
              <span>Надето / используется</span></label>
            <button type="button" class="btn btn--utility inventory-toggle-btn" data-action="inventory-toggle-expand"
              data-item-id="${escapeHtml(itemId)}" aria-expanded="${isExpanded}" aria-controls="${contentId}">${toggleLabel}</button>
          </div>
        </div>
        <div id="${contentId}" class="inventory-item-expandable" ${isExpanded ? "" : "hidden"}>
          <section class="inventory-item-details" aria-label="Подробности предмета">
            ${renderItemMetaRow("Тип", item.type ?? "misc")}
            ${renderItemMetaRow("Стакуемый", item.stackable ? "Да" : "Нет")}
            ${renderItemMetaRow("Теги", Array.isArray(item.tags) && item.tags.length ? item.tags.join(", ") : "—")}
            ${renderItemResource("Использования", item.uses)}
            ${renderItemResource("Заряды", item.charges)}
            ${renderItemDetails(item)}
          </section>
          <section class="inventory-item-edit" aria-label="Редактирование предмета">
            <h4 class="inventory-item-edit__title">Редактирование</h4>
            <p class="inventory-item-edit__note">Изменения сохраняются сразу.</p>
            <div class="inventory-item-edit__fields">
              <label class="inventory-edit-field inventory-edit-field--name"><span>Название</span>
                <input class="inventory-input inventory-input--name" type="text" value="${escapeHtml(item.name)}"
                  data-bind-item-field="name" data-item-id="${escapeHtml(itemId)}" placeholder="Название предмета"></label>
              <label class="inventory-edit-field inventory-edit-field--quantity"><span>Количество</span>
                <input class="inventory-input inventory-input--qty" type="number" min="0" step="1"
                  value="${escapeHtml(item.quantity ?? 1)}" data-bind-item-field="quantity"
                  data-item-id="${escapeHtml(itemId)}" placeholder="Кол-во"></label>
              ${item.id === "amulet-of-health" ? `<label class="inventory-edit-field">
                <input type="checkbox" data-bind-item-field="attuned" data-item-id="${escapeHtml(itemId)}" ${item.attuned ? "checked" : ""}>
                <span>Настроен</span></label>` : ""}
              <label class="inventory-edit-field inventory-edit-field--notes"><span>Заметки</span>
                <textarea class="inventory-textarea" rows="${getItemNoteRows(item.notes)}"
                  data-bind-item-field="notes" data-item-id="${escapeHtml(itemId)}"
                  placeholder="Заметка по предмету">${escapeHtml(item.notes || "")}</textarea></label>
            </div>
          </section>
          <div class="resource-controls inventory-item-actions">
            <button type="button" class="btn btn--utility" data-action="inventory-remove-item"
              data-item-id="${escapeHtml(itemId)}">Удалить</button>
          </div>
        </div>
      </article>`;
  }
  const equippable = item.equipped === true || Boolean(item.weapon || item.armor || item.focus) ||
    ["weapon", "armor", "focus"].includes(item.type);

  return `
    <article class="inventory-item-card ${isExpanded ? "inventory-item-card--expanded" : "inventory-item-card--collapsed"}" data-item-id="${escapeHtml(itemId)}">
      <div class="inventory-item-main">
        <div class="inventory-item-main__title-wrap">
          <div class="inventory-item-heading"><span class="inventory-item-icon-well">${renderItemIcon(item)}</span>
            <div class="inventory-item-title">${escapeHtml(item.name)}</div>
          </div>
          <div class="inventory-item-badges">
            ${itemTypeLabel(item.type) ? `<span>Тип: ${escapeHtml(itemTypeLabel(item.type))}</span>` : ""}
            ${itemRarityLabel(item.rarity) ? `<span>Редкость: ${escapeHtml(itemRarityLabel(item.rarity))}</span>` : ""}
          </div>
          <div class="inventory-item-summary">${renderItemSummary(item)}</div>
          ${renderItemMainEffect(item)}
        </div>

        <div class="inventory-item-main__controls">
          ${equippable ? `<label class="inventory-equip-toggle">
            <input
              type="checkbox"
              data-action="inventory-toggle-equipped"
              data-item-id="${escapeHtml(itemId)}"
              ${item.equipped ? "checked" : ""}
            />
            <span>Надето / используется</span>
          </label>` : ""}
          ${item.consumable?.kind === "healing-potion" && Number(item.quantity ?? 0) > 0
              ? `<button type="button" class="btn btn--primary" data-action="open-potion-use"
                  data-command-id="potion-use:${escapeHtml(item.consumable.potionId)}:${encodeURIComponent(itemId)}">
                  Использовать · записать лечение</button>` : ""}

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
        <details class="sara-details inventory-item-details">
          <summary>Свойства и правила</summary>
          <section aria-label="Подробности предмета">
            ${renderItemMetaRow("Тип", item.type)}
            ${renderItemMetaRow("Редкость", item.rarity)}
            ${renderItemMetaRow("Стакуемый", item.stackable ? "Да" : "Нет")}
            ${renderItemMetaRow(
              "Теги",
              Array.isArray(item.tags) && item.tags.length ? item.tags.join(", ") : "—",
            )}
            ${renderItemResource("Использования", item.uses)}
            ${renderItemResource("Заряды", item.charges)}
            ${renderItemDetails(item)}
          </section>
        </details>

        <details class="sara-details inventory-item-edit">
          <summary>Редактировать</summary>
          <section aria-label="Редактирование предмета">
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
          <button type="button" class="btn btn--utility" data-action="inventory-quantity-adjust"
            data-item-id="${escapeHtml(itemId)}" data-quantity-delta="-1"
            ${Number(item.quantity ?? 0) <= 0 ? "disabled" : ""}>−1</button>
          <button type="button" class="btn btn--utility" data-action="inventory-quantity-adjust"
            data-item-id="${escapeHtml(itemId)}" data-quantity-delta="1">+1</button>
          <button
            type="button"
            class="btn btn--utility"
            data-action="inventory-remove-item"
            data-item-id="${escapeHtml(itemId)}"
          >
            Удалить
          </button>
        </div>
        </details>
      </div>
    </article>
  `;
}

export function renderInventoryMarkup(state) {
  const inventory = state.inventory ?? {};
  const itemsList = Array.isArray(inventory.items) ? inventory.items : [];
  const isSara = state.profile?.id === "sara-velaris";
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

  const items = itemsList.map((item) =>
    renderInventoryItemCard(item, expandedItemIds, isSara));
  const equippedItems = itemsList
    .map((item, index) => ({ item, markup: items[index] }))
    .filter(({ item }) => item?.equipped === true);
  const otherItems = itemsList
    .map((item, index) => ({ item, markup: items[index] }))
    .filter(({ item }) => item?.equipped !== true);
  const itemGroups = isSara
    ? `<section class="inventory-item-group" data-sara-key="inventory-equipped">
        <h3>Используется</h3>${equippedItems.length
          ? equippedItems.map(({ markup: card }) => card).join("")
          : `<p class="sara-empty-state">Пока ничего не используется.</p>`}
      </section>
      <section class="inventory-item-group" data-sara-key="inventory-other">
        <h3>Остальное</h3>${otherItems.length
          ? otherItems.map(({ markup: card }) => card).join("")
          : `<p class="sara-empty-state">Других предметов пока нет.</p>`}
      </section>`
    : items.join("");
  const currencySummary = inventory.currencyStatus === "Не заполнено"
    ? "Не заполнено"
    : `${currency.gp ?? 0} зм · ${currency.sp ?? 0} см`;
  const inventoryItemsMarkup = itemsList.length
    ? itemGroups
    : isSara
      ? `<p class="sara-empty-state">Пока ничего не добавлено.</p>`
      : `<div class="info-card"><div class="info-card-text">Пока ничего не добавлено.</div></div>`;

  const markup = `
    ${isSara ? `<header class="sara-tab-heading"><h2>Вещи</h2>
      <button type="button" class="btn" data-action="inventory-add-item">Добавить</button></header>` : "<h2>Инвентарь</h2>"}
    ${isSara ? "" : `<p class="panel-text">`}
    ${isSara ? "" : `
      Инвентарь хранит снаряжение, валюту и служит источником правды для оружия, брони, фокусов и расходников.
    </p>`}

    ${isSara ? `<label class="sara-inventory-search">Поиск предмета<input type="search" data-sara-inventory-search placeholder="Название или свойство"></label>` : ""}

    ${isSara ? `<div class="sara-inventory-layout">` : ""}
    ${isSara ? `<div class="inventory-list">${inventoryItemsMarkup}</div>
      <aside class="sara-inventory-sidebar">
        <p class="sara-inventory-summary">Настроено: ${attunedCount}</p>
        <p class="sara-inventory-wallet">Кошелёк: <strong>${escapeHtml(currencySummary)}</strong></p>
        <button type="button" class="btn btn--utility" data-action="open-currency-editor">Изменить деньги</button>
        <details class="sara-details sara-inventory-editors">
          <summary>Деньги и заметки о снаряжении</summary>
          <section class="info-card"><h3>Деньги</h3>${currencyMarkup}</section>
          <section class="info-card"><h3>Заметки</h3>
            <textarea class="inventory-textarea inventory-textarea--large" rows="4"
              data-bind="inventory.notes" placeholder="Записи о снаряжении, добыче, долгах, квестовых предметах...">${escapeHtml(inventory.notes || "")}</textarea>
          </section>
        </details>
      </aside>` : `<div class="inventory-section-gap" aria-hidden="true"></div>
      <div class="cards-grid">
        <div class="info-card"><div class="info-card-title">Деньги</div>${currencyMarkup}</div>
        <div class="info-card"><div class="info-card-title">Заметки</div>
          <textarea class="inventory-textarea inventory-textarea--large" rows="8" data-bind="inventory.notes"
            placeholder="Записи о снаряжении, добыче, долгах, квестовых предметах...">${escapeHtml(inventory.notes || "")}</textarea></div>
      </div>
      <div class="inventory-section-gap" aria-hidden="true"></div>`}

    ${isSara ? "" : `<div class="inventory-header-row"><h3>Снаряжение · ${escapeHtml(inventory.otherItemsStatus === "Не заполнено" ? "остальные предметы не заполнены" : "")}</h3>
      <button type="button" class="btn" data-action="inventory-add-item">Добавить предмет</button></div>`}

    ${isSara ? "" : `<div class="inventory-list">${inventoryItemsMarkup}</div>`}
    ${isSara ? `</div>` : ""}
    ${isSara ? `<p class="sara-empty-state" data-inventory-search-empty hidden>По этому запросу предметы не найдены.</p>` : ""}
  `;
  return markup;
}

export function updateInventorySearchVisibility(panel) {
  const query = panel.querySelector("[data-sara-inventory-search]")?.value
    .trim().toLocaleLowerCase("ru") ?? "";
  const cards = [...panel.querySelectorAll(".inventory-item-card")];
  for (const card of cards) {
    card.hidden = Boolean(query) &&
      !card.textContent.toLocaleLowerCase("ru").includes(query);
  }
  for (const group of panel.querySelectorAll(".inventory-item-group")) {
    const hasVisibleCard = [...group.querySelectorAll(".inventory-item-card")]
      .some((card) => !card.hidden);
    group.hidden = Boolean(query) && !hasVisibleCard;
  }
  const empty = panel.querySelector("[data-inventory-search-empty]");
  if (empty) empty.hidden = !query || cards.some((card) => !card.hidden);
}

function getMovingControlDescriptor(control) {
  const field = control.getAttribute("data-bind-item-field");
  const action = control.getAttribute("data-action");
  if (!field && !action) return null;
  return {
    tagName: control.tagName,
    type: control.type ?? "",
    field,
    action,
    itemId: control.getAttribute("data-item-id"),
    quantityDelta: control.getAttribute("data-quantity-delta"),
    commandId: control.getAttribute("data-command-id"),
  };
}

function isSameMovingControl(control, descriptor) {
  const candidate = getMovingControlDescriptor(control);
  return candidate != null && candidate.tagName === descriptor.tagName &&
    candidate.type === descriptor.type &&
    candidate.field === descriptor.field &&
    candidate.action === descriptor.action &&
    candidate.itemId === descriptor.itemId &&
    candidate.quantityDelta === descriptor.quantityDelta &&
    candidate.commandId === descriptor.commandId;
}

export function captureMovingItemStates(panel, items) {
  const targetGroups = new Map(items
    .filter((item) => item?.id != null && String(item.id))
    .map((item) => [String(item.id), item.equipped === true
      ? "inventory-equipped" : "inventory-other"]));
  const activeElement = panel.ownerDocument?.activeElement ?? document.activeElement;
  return [...panel.querySelectorAll(".inventory-item-card")].flatMap((card) => {
    const itemId = card.getAttribute("data-item-id");
    const targetGroup = targetGroups.get(itemId);
    const currentGroup = card.closest(".inventory-item-group")?.getAttribute("data-sara-key");
    if (!targetGroup || !currentGroup || targetGroup === currentGroup) return [];

    const controls = [...card.querySelectorAll("input, textarea, select, button")];
    const fields = controls
      .filter((field) => field.matches("input, textarea, select"))
      .map((field) => {
        const preserve = field === activeElement || field.dataset.saraDirty === "true";
        const textSelectionSupported = field.tagName === "TEXTAREA" ||
          ["text", "search", "tel", "url", "password"].includes(field.type);
        return {
          field,
          preserve,
          value: preserve ? field.value : undefined,
          checked: preserve && field.matches('input[type="checkbox"], input[type="radio"]')
            ? field.checked : undefined,
          selectedValues: preserve && field.tagName === "SELECT" && field.multiple
            ? [...field.selectedOptions].map((option) => option.value) : undefined,
          selectionStart: preserve && textSelectionSupported ? field.selectionStart : null,
          selectionEnd: preserve && textSelectionSupported ? field.selectionEnd : null,
          selectionDirection: preserve && textSelectionSupported ? field.selectionDirection : null,
          markers: ["data-sara-dirty", "data-sara-edit-start", "data-sara-conflict", "aria-invalid"]
            .map((name) => [name, field.getAttribute(name)]),
          descriptor: getMovingControlDescriptor(field),
        };
      });
    const focusedDescriptor = controls.includes(activeElement)
      ? getMovingControlDescriptor(activeElement) : null;
    return [{
      itemId,
      details: [...card.querySelectorAll("details")].map((details) => details.open),
      fields,
      focusedDescriptor,
    }];
  });
}

export function restoreMovingItemStates(panel, snapshots) {
  if (!snapshots.length) return;
  const cards = [...panel.querySelectorAll(".inventory-item-card")];
  for (const snapshot of snapshots) {
    const card = cards.find((candidate) =>
      candidate.getAttribute("data-item-id") === snapshot.itemId);
    if (!card) continue;

    const details = [...card.querySelectorAll("details")];
    snapshot.details.forEach((open, index) => {
      if (details[index]) details[index].open = open;
    });

    const controls = [...card.querySelectorAll("input, textarea, select, button")];
    for (const fieldState of snapshot.fields) {
      if (!fieldState.preserve || !fieldState.descriptor) continue;
      const field = controls.find((candidate) => isSameMovingControl(candidate, fieldState.descriptor));
      if (!field) continue;
      field.value = fieldState.value;
      if (fieldState.checked !== undefined) field.checked = fieldState.checked;
      if (fieldState.selectedValues) {
        for (const option of field.options) {
          option.selected = fieldState.selectedValues.includes(option.value);
        }
      }
      for (const [name, value] of fieldState.markers) {
        if (value == null) field.removeAttribute(name);
        else field.setAttribute(name, value);
      }
      if (field.dataset.saraConflict === "true") {
        field.setAttribute("aria-invalid", "true");
        const label = field.closest("label");
        if (label && !label.querySelector(".sara-field-conflict")) {
          const message = panel.ownerDocument.createElement("span");
          message.className = "sara-field-conflict";
          message.setAttribute("role", "status");
          message.textContent = "Значение изменилось в другом обновлении; ваш ввод сохранён.";
          label.append(message);
        }
      }
    }

    const focused = snapshot.focusedDescriptor
      ? controls.find((candidate) =>
        isSameMovingControl(candidate, snapshot.focusedDescriptor) &&
        !candidate.disabled &&
        candidate.getAttribute("aria-disabled") !== "true")
      : null;
    if (focused && focused !== panel.ownerDocument.activeElement) {
      focused.focus({ preventScroll: true });
    }
    if (focused && focused === panel.ownerDocument.activeElement) {
      for (const fieldState of snapshot.fields) {
        if (fieldState.descriptor && fieldState.selectionStart != null &&
          fieldState.selectionEnd != null &&
          isSameMovingControl(focused, fieldState.descriptor)) {
          focused.setSelectionRange(
            fieldState.selectionStart,
            fieldState.selectionEnd,
            fieldState.selectionDirection ?? "none",
          );
          break;
        }
      }
    }
  }
}

export function renderInventoryPanel(state) {
  const inventoryPanel = document.getElementById("inventoryPanel");
  if (!inventoryPanel) return;
  const markup = renderInventoryMarkup(state);
  const movingStates = state.profile?.id === "sara-velaris"
    ? captureMovingItemStates(inventoryPanel, state.inventory?.items ?? [])
    : [];
  setPanelMarkup(inventoryPanel, markup, state.profile?.id);
  restoreMovingItemStates(inventoryPanel, movingStates);
  if (state.profile?.id === "sara-velaris") {
    updateInventorySearchVisibility(inventoryPanel);
  }
}