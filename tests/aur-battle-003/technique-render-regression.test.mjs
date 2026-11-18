import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import { WARRIOR_ADEPT_STYLES } from "../../data/monk-techniques.js";
import { renderTechniquesPanel } from "../../scripts/render/render-techniques.js";
import { renderSpellCardHeader } from "../../scripts/render/shared/spell-card.js";
import {
  activationLabel,
  fightingStylePresentation,
  spellTitle,
} from "../../scripts/presentation/ru.js";

test("technique catalogue no longer renders replaced battle forms or missile return controls", () => {
  const panel = {
    innerHTML: "",
    dataset: {},
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    replaceChildren() {},
  };
  const priorDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) { return id === "techniquesPanel" ? panel : null; },
  };

  try {
    renderTechniquesPanel(structuredClone(sara));
    assert.match(panel.innerHTML, /<h2>Техники<\/h2>/);
    assert.match(panel.innerHTML, /data-technique-tab="mine"/);
    assert.match(panel.innerHTML, /technique-card__badge">Активация:/);
    assert.match(panel.innerHTML, /technique-card__badge">Стоимость:/);
    assert.doesNotMatch(panel.innerHTML, /data-technique-form="ll-monk:(?:step-of-the-wind|patient-defense|mystic-regeneration|deflect-strike|deflect-missile|empowered-strike|stunning-strike|crippling-strike|slowing-strike)"/);
    assert.doesNotMatch(panel.innerHTML, /data-(?:missile-return|sara-attack-submit|sara-damage-submit|racial-spell-form|battle-technique-form)=/);
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});

test("fighting styles and roll timing labels use Russian presentation text", () => {
  const expected = [
    ["Стрельба", "дальнобойным атакам оружием", "укрытие на три четверти"],
    ["Слепой воин", "Восприятием", "слепое зрение"],
    ["Сбалансированный бой", "оружием ближнего боя", "безоружные удары"],
    ["Лёгкий бой", "Без доспехов", "скорость увеличивается"],
    ["Метатель", "метательное оружие", "дальность его броска"],
    ["Бой древковым оружием", "глефой", "входит в вашу досягаемость", "перемещается внутри неё"],
    ["Универсальный бой", "универсальным оружием", "схватить, толкнуть"],
  ];
  assert.equal(WARRIOR_ADEPT_STYLES.length, expected.length);
  expected.forEach(([title, ...phrases], index) => {
    const presentation = fightingStylePresentation(WARRIOR_ADEPT_STYLES[index]);
    assert.equal(presentation.title, title);
    phrases.forEach((phrase) => assert.ok(presentation.text.includes(phrase), title));
    assert.doesNotMatch(`${presentation.title} ${presentation.text}`, /half cover|three-quarters cover|ll-style:/i);
  });
  assert.equal(activationLabel("after-roll"), "После броска");
  assert.equal(activationLabel("on-miss"), "При промахе");
  assert.equal(spellTitle("Hypnotic Pattern"), "Гипнотический узор");
  const spellHeader = renderSpellCardHeader({
    name: "Hypnotic Pattern",
    originalName: "Hypnotic Pattern",
  });
  assert.match(spellHeader, /<h3 class="spell-card-title">Гипнотический узор<\/h3>/);
  assert.match(spellHeader, /<summary>Оригинал и источник<\/summary><span>Hypnotic Pattern<\/span>/);
});
