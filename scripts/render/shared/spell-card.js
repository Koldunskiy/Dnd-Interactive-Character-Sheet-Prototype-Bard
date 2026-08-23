import {
  formatSpellSave,
  formatSpellDamage,
  formatHealing
} from '../../calculations.js';

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

export function renderSpellQuickFacts(spell) {
  const components = String(spell.components ?? "")
    .split(" (", 1)[0]
    .trim();

  const durationParts = [];

  if (spell.concentration) {
    durationParts.push("Конц.");
  }

  if (spell.ritual) {
    durationParts.push("Ритуал");
  }

  if (spell.duration) {
    durationParts.push(spell.duration);
  }

  const facts = [
    {
      label: "Время",
      value: spell.castTime ?? spell.castingTime,
    },
    {
      label: "Дистанция",
      value: spell.range,
    },
    {
      label: "Компоненты",
      value: components,
    },
    {
      label: "Длительность",
      value: durationParts.join(" · "),
    },
  ].filter((fact) => fact.value);

  return `
    <dl class="spell-quick-facts">
      ${facts
        .map(
          (fact) => `
            <div class="spell-quick-fact">
              <dt>${escapeHtml(fact.label)}</dt>
              <dd>${escapeHtml(fact.value)}</dd>
            </div>
          `,
        )
        .join("")}
    </dl>
  `;
}

export function renderSpellMetaFacts(items, extraClassName = "") {
  const rows = items.filter((item) => item?.label && item?.value);

  if (!rows.length) {
    return "";
  }

  const className = ["spell-facts", extraClassName].filter(Boolean).join(" ");

  return `
    <dl class="${className}">
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

export function renderSpellCombatStats(spell, spellStats = null) {
  const items = [];

  const damage = formatSpellDamage(spell, spellStats?.spellcastingModifier);
  const healing = formatHealing(spell, spellStats?.spellcastingModifier);
  const save = formatSpellSave(spell, spellStats?.spellSaveDc);

  if (damage) {
    items.push({ label: "Урон", value: damage });
  }

  if (healing) {
    items.push({ label: "Лечение", value: healing });
  }

  if (save) {
    items.push({ label: "Спасбросок", value: save });
  }

  return renderSpellMetaFacts(items, "spell-facts--meta spell-facts--combat");
}

export function formatSpellGeometry(spell) {
  if (!spell) {
    return null;
  }

  const parts = [];

  const hasRangeFeet =
    spell.rangeFeet !== null &&
    spell.rangeFeet !== undefined &&
    Number.isFinite(Number(spell.rangeFeet));

  if (hasRangeFeet) {
    const rangeFeet = Number(spell.rangeFeet);

    if (rangeFeet === 0) {
      parts.push("На себя");
    } else {
      parts.push(`${rangeFeet} футов`);
    }
  } else if (spell.range) {
    parts.push(String(spell.range));
  }

  const hasArea =
    spell.areaShape &&
    spell.areaSizeFeet !== null &&
    spell.areaSizeFeet !== undefined &&
    Number.isFinite(Number(spell.areaSizeFeet));

  if (hasArea) {
    const areaSizeFeet = Number(spell.areaSizeFeet);

    const shapeMap = {
      radius: "радиус",
      cube: "куб",
      cone: "конус",
      sphere: "сфера",
      line: "линия",
      cylinder: "цилиндр",
    };

    const shapeLabel = shapeMap[spell.areaShape] ?? spell.areaShape;
    parts.push(`${shapeLabel} ${areaSizeFeet} футов`);
  }

  if (!parts.length) {
    return null;
  }

  return parts.join(" • ");
}

export function getSpellGeometryFactItem(spell) {
  const geometry = formatSpellGeometry(spell);

  if (!geometry) {
    return null;
  }

  return {
    label: "Дистанция / зона",
    value: geometry,
  };
}