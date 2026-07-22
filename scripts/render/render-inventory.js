export function renderInventoryPanel(state) {
  const inventoryPanel = document.getElementById("inventoryPanel");
  if (!inventoryPanel) {
    return;
  }

  const items = state.inventory.items
    .map((item) => {
      return `
        <div class="inventory-item-card" data-item-id="${item.id}">
          <div class="inventory-item-main">
            <input
              class="inventory-input inventory-input--name"
              type="text"
              value="${item.name}"
              data-bind-item-field="name"
              data-item-id="${item.id}"
              placeholder="Название предмета"
            />

            <input
              class="inventory-input inventory-input--qty"
              type="number"
              min="0"
              step="1"
              value="${item.quantity}"
              data-bind-item-field="quantity"
              data-item-id="${item.id}"
              placeholder="Кол-во"
            />

            <label class="inventory-equip-toggle">
              <input
                type="checkbox"
                data-bind-item-field="equipped"
                data-item-id="${item.id}"
                ${item.equipped ? "checked" : ""}
              />
              <span>Надето / используется</span>
            </label>
          </div>

          <textarea
            class="inventory-textarea"
            rows="2"
            data-bind-item-field="notes"
            data-item-id="${item.id}"
            placeholder="Заметка по предмету"
          >${item.notes || ""}</textarea>

          <div class="resource-controls">
            <button
              type="button"
              class="btn btn--utility"
              data-action="inventory-remove-item"
              data-item-id="${item.id}"
            >
              Удалить
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  inventoryPanel.innerHTML = `
    <h2>Инвентарь</h2>
    <p class="panel-text">
      Здесь можно хранить снаряжение, деньги и краткие заметки по текущему состоянию персонажа.
    </p>

    <div style="height: 18px;"></div>

    <div class="cards-grid">
      <div class="info-card">
        <div class="info-card-title">Деньги</div>
        <div class="currency-grid">
          <label class="currency-field">
            <span>CP</span>
            <input class="inventory-input" type="number" min="0" step="1" value="${state.inventory.currency.cp}" data-bind="inventory.currency.cp" />
          </label>

          <label class="currency-field">
            <span>SP</span>
            <input class="inventory-input" type="number" min="0" step="1" value="${state.inventory.currency.sp}" data-bind="inventory.currency.sp" />
          </label>

          <label class="currency-field">
            <span>EP</span>
            <input class="inventory-input" type="number" min="0" step="1" value="${state.inventory.currency.ep}" data-bind="inventory.currency.ep" />
          </label>

          <label class="currency-field">
            <span>GP</span>
            <input class="inventory-input" type="number" min="0" step="1" value="${state.inventory.currency.gp}" data-bind="inventory.currency.gp" />
          </label>

          <label class="currency-field">
            <span>PP</span>
            <input class="inventory-input" type="number" min="0" step="1" value="${state.inventory.currency.pp}" data-bind="inventory.currency.pp" />
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
        >${state.inventory.notes || ""}</textarea>
      </div>
    </div>

    <div style="height: 18px;"></div>

    <div class="inventory-header-row">
      <h3>Снаряжение</h3>
      <button type="button" class="btn" data-action="inventory-add-item">Добавить предмет</button>
    </div>

    <div class="inventory-list">
      ${items || `<div class="info-card"><div class="info-card-text">Пока ничего не добавлено.</div></div>`}
    </div>
  `;
}