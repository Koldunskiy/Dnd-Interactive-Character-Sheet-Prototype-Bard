import { escapeHtml } from "./spell-card.js";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function renderSpellSlotPips(slot) {
  const level = Number(slot?.level || 0);
  const max = Math.max(0, Number(slot?.max || 0));
  const available = clamp(Number(slot?.available || 0), 0, max);

  return `
    <div class="resource-row">
      <div class="resource-row-main">
        <span class="resource-row-title">${escapeHtml(`${level} круг`)}</span>
        <span class="resource-row-meta">${escapeHtml(String(available))}/${escapeHtml(String(max))} доступно</span>
      </div>

      <div class="resource-pip-track">
        ${Array.from({ length: max }, (_, index) => {
          const pipIndex = index + 1;
          const isActive = pipIndex <= available;

          return `
            <button
              type="button"
              class="resource-pip ${isActive ? "resource-pip--active" : ""}"
              data-action="slot-set-used"
              data-slot-level="${escapeHtml(String(level))}"
              data-slot-index="${escapeHtml(String(pipIndex))}"
              aria-label="Установить доступные ячейки ${escapeHtml(String(pipIndex))} из ${escapeHtml(String(max))} для ${escapeHtml(String(level))} круга"
              aria-pressed="${isActive ? "true" : "false"}"
            ></button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}