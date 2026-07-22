function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderSpellMeta(spell) {
  const parts = [];

  if (spell.school) parts.push(escapeHtml(spell.school));
  if (spell.castTime) parts.push(`Каст: ${escapeHtml(spell.castTime)}`);
  if (spell.range) parts.push(`Дистанция: ${escapeHtml(spell.range)}`);
  if (spell.duration) parts.push(`Длительность: ${escapeHtml(spell.duration)}`);

  if (spell.concentration) {
    parts.push("Концентрация");
  }

  if (spell.ritual) {
    parts.push("Ритуал");
  }

  return parts
    .map((item) => `<span class="spell-meta-chip">${item}</span>`)
    .join("");
}

function renderSpellStats(spell) {
  const rows = [];

  if (spell.save) {
    rows.push(
      `<div class="spell-stat"><span class="spell-stat-label">Спасбросок</span><span class="spell-stat-value">${escapeHtml(spell.save)}</span></div>`
    );
  }

  if (spell.attackBonus) {
    rows.push(
      `<div class="spell-stat"><span class="spell-stat-label">Атака</span><span class="spell-stat-value">${escapeHtml(spell.attackBonus)}</span></div>`
    );
  }

  if (spell.damage) {
    rows.push(
      `<div class="spell-stat"><span class="spell-stat-label">Эффект</span><span class="spell-stat-value">${escapeHtml(spell.damage)}</span></div>`
    );
  }

  if (spell.upcast) {
    rows.push(
      `<div class="spell-stat"><span class="spell-stat-label">Апкаст</span><span class="spell-stat-value">${escapeHtml(spell.upcast)}</span></div>`
    );
  }

  if (spell.uses?.max) {
    rows.push(
      `<div class="spell-stat"><span class="spell-stat-label">Использования</span><span class="spell-stat-value">${escapeHtml(
        `${spell.uses.current}/${spell.uses.max} · ${spell.uses.refresh ?? ""}`
      )}</span></div>`
    );
  }

  if (!rows.length) {
    return "";
  }

  return `<div class="spell-stats-grid">${rows.join("")}</div>`;
}

function renderSpellCard(spell, characterLevel) {
  const isLocked =
    Boolean(spell.locked) ||
    (spell.availableFromLevel && spell.availableFromLevel > characterLevel);

  const badges = [
    `<span class="spell-badge spell-badge--source spell-badge--${escapeHtml(
      spell.source ?? "class"
    )}">${escapeHtml(spell.sourceLabel ?? "Классовое")}</span>`,
    `<span class="spell-badge spell-badge--level">${
      spell.level === 0 ? "Заговор" : `${spell.level} круг`
    }</span>`
  ];

  if (isLocked && spell.availableFromLevel) {
    badges.push(
      `<span class="spell-badge spell-badge--locked">С ${escapeHtml(
        `${spell.availableFromLevel} уровня`
      )}</span>`
    );
  }

  return `
    <article class="spell-card ${isLocked ? "spell-card--locked" : ""}">
      <div class="spell-card-header">
        <div>
          <h3 class="spell-card-title">${escapeHtml(spell.name)}</h3>
          ${
            spell.originalName
              ? `<div class="spell-card-subtitle">${escapeHtml(spell.originalName)}</div>`
              : ""
          }
        </div>
        <div class="spell-badges">
          ${badges.join("")}
        </div>
      </div>

      <div class="spell-meta-row">
        ${renderSpellMeta(spell)}
      </div>

      ${renderSpellStats(spell)}

      ${
        spell.description
          ? `<p class="spell-description">${escapeHtml(spell.description)}</p>`
          : ""
      }

      ${
        spell.notes
          ? `<p class="spell-notes">${escapeHtml(spell.notes)}</p>`
          : ""
      }

      ${
        spell.vibe
          ? `<p class="spell-vibe">${escapeHtml(spell.vibe)}</p>`
          : ""
      }
    </article>
  `;
}

function sortSpells(spells) {
  return [...spells].sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    return String(a.name).localeCompare(String(b.name), "ru");
  });
}

export function renderSpells(root, character, derived) {
  if (!root) return;

  const spellcasting = character.spellcasting ?? {};
  const spells = Array.isArray(spellcasting.spells) ? spellcasting.spells : [];
  const level = character.profile?.level ?? 1;

  const cantrips = sortSpells(spells.filter((spell) => spell.level === 0));
  const leveledSpells = sortSpells(spells.filter((spell) => spell.level > 0));

  const slotEntries = Object.entries(spellcasting.slots ?? {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([slotLevel, slotData]) => {
      const available = Math.max((slotData.max ?? 0) - (slotData.used ?? 0), 0);
      return `
        <div class="resource-card">
          <div class="resource-card-label">${escapeHtml(`${slotLevel} круг`)}</div>
          <div class="resource-card-value">${available}/${escapeHtml(slotData.max ?? 0)}</div>
          <div class="resource-card-subtle">потрачено: ${escapeHtml(slotData.used ?? 0)}</div>
        </div>
      `;
    })
    .join("");

  root.innerHTML = `
    <section class="panel-section panel-section--spells">
      <div class="section-heading-row">
        <div>
          <h2 class="section-title">Заклинания</h2>
          <p class="section-subtitle">
            Харизма — базовая характеристика. Сл спасброска: ${escapeHtml(
              derived.spellSaveDc ?? "—"
            )}, атака заклинанием: ${escapeHtml(derived.spellAttackBonus ?? "—")}.
          </p>
        </div>
      </div>

      <div class="resource-grid">
        ${slotEntries}
      </div>

      ${
        spellcasting.notes
          ? `<p class="section-copy">${escapeHtml(spellcasting.notes)}</p>`
          : ""
      }
    </section>

    <section class="panel-section">
      <div class="section-heading-row">
        <h2 class="section-title">Заговоры</h2>
      </div>
      <div class="spell-grid">
        ${
          cantrips.length
            ? cantrips.map((spell) => renderSpellCard(spell, level)).join("")
            : `<p class="empty-copy">Нет заговоров.</p>`
        }
      </div>
    </section>

    <section class="panel-section">
      <div class="section-heading-row">
        <h2 class="section-title">Известные заклинания</h2>
      </div>
      <div class="spell-grid">
        ${
          leveledSpells.length
            ? leveledSpells.map((spell) => renderSpellCard(spell, level)).join("")
            : `<p class="empty-copy">Нет известных заклинаний.</p>`
        }
      </div>
    </section>
  `;
}