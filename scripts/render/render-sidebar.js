export function renderQuickStats(state, derived) {
  const quickStats = document.getElementById("quickStats");
  if (!quickStats) {
    return;
  }

  const items = [
    {
      label: "Класс брони",
      value: derived.armorClass
    },
    {
      label: "Инициатива",
      value: derived.formattedInitiative
    },
    {
      label: "Хиты",
      value: `${derived.currentHitPoints} / ${derived.maxHitPoints}`
    },
    {
      label: "СЛ заклинаний",
      value: derived.spellSaveDc
    },
    {
      label: "Атака заклинанием",
      value: derived.formattedSpellAttackBonus
    },
    {
      label: "Бонус мастерства",
      value: `+${state.profile.proficiencyBonus}`
    }
  ];

  quickStats.innerHTML = items
    .map((item) => {
      return `
        <div class="quick-stat">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
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

  sidebarSummary.textContent = state.profile.summary;
}