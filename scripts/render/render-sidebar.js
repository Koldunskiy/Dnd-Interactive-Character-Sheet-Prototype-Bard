function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatSigned(value) {
  const number = Number(value);

  if (Number.isNaN(number)) {
    return "—";
  }

  return number >= 0 ? `+${number}` : `${number}`;
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  return String(value);
}

export function renderQuickStats(state, derived) {
  const quickStats = document.getElementById("quickStats");
  if (!quickStats) {
    return;
  }

  const currentHp = derived.currentHitPoints ?? derived.currentHp ?? "—";
  const maxHp = derived.maxHitPoints ?? derived.maxHp ?? "—";

  const items = [
    {
      label: "Класс брони",
      value: formatValue(derived.armorClass),
    },
    {
      label: "Инициатива",
      value: formatValue(derived.formattedInitiative),
    },
    {
      label: "Хиты",
      value: `${currentHp} / ${maxHp}`,
    },
    {
      label: "СЛ заклинаний",
      value: formatValue(derived.spellSaveDc),
    },
    {
      label: "Атака заклинанием",
      value: formatValue(derived.formattedSpellAttackBonus),
    },
    {
      label: "Бонус мастерства",
      value: formatSigned(derived.proficiencyBonus),
    },
  ];

  quickStats.innerHTML = items
    .map((item) => {
      return `
        <div class="quick-stat">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
        </div>
      `;
    })
    .join("");
}

export function renderSidebarSummary(state) {
  const sidebarSummary = document.getElementById("sidebarSummary");
  if (!sidebarSummary) {
    return;
  }

  sidebarSummary.textContent = state.profile?.summary ?? "";
}