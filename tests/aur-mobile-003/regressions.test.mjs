import test from "node:test";
import assert from "node:assert/strict";
import { character } from "../../data/character.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import { renderSpellLibrary } from "../../scripts/render/render-spell-library.js";
import { renderSpells } from "../../scripts/render/render-spells.js";
import { renderMeleePanel } from "../../scripts/render/render-melee.js";
import { escapeHtml } from "../../scripts/render/shared/spell-card.js";
import {
  buildCharacterSpellCollections,
  findMissingSpellIds,
  resolveSpellById,
} from "../../scripts/selectors/spellcasting.js";
import {
  LEGACY_NOTE_ID,
  createNoteEntry,
  deleteNoteEntry,
  migrateLoreNotes,
  updateNoteEntry,
  validateNoteEntries,
} from "../../scripts/lore-notes.js";
import {
  decideSwipe,
  isClearlyVertical,
  isCurrentScrollRestore,
  isSwipeContextValid,
} from "../../scripts/tab-gestures.js";
import {
  getFeatureReference,
  getItemRuleReference,
  getSongOfRestDie,
  getSpellPersonalHint,
} from "../../scripts/rule-reference.js";

const persisted = new Map();
let failStorageWrite = false;
globalThis.window = {
  localStorage: {
    getItem: (key) => persisted.get(key) ?? null,
    setItem: (key, value) => {
      if (failStorageWrite) throw new Error("mock storage failure");
      persisted.set(key, value);
    },
    removeItem: (key) => persisted.delete(key),
  },
  confirm: () => true,
  alert: (message) => alerts.push(message),
};
const alerts = [];

const { createActionHandlers } = await import("../../scripts/actions.js");
const { getState, subscribe, updateState } = await import("../../scripts/state.js");
const { savePersistedState } = await import("../../scripts/storage.js");
const actions = createActionHandlers({ resetState: () => {} });
const cloneCharacter = () => structuredClone(character);

function applySpell(state, dataset) {
  actions["spell-cast"](state, {
    isConnected: true,
    dataset: { processing: "true", ...dataset },
  });
}

test("A: Aurelia spell overview and selection limits use the canonical collection", () => {
  const collections = buildCharacterSpellCollections(character);
  assert.equal(collections.counts.cantrips, 6);
  assert.equal(collections.counts.nonracialLevelledSpells, 14);
  assert.equal(collections.counts.racialSpells, 2);
  assert.equal(collections.counts.classCantrips, 4);
  assert.equal(collections.limits.classCantrips, 4);
  assert.equal(collections.counts.knownSpells, 15);
  assert.equal(collections.limits.knownSpells, 15);
});

test("I: fresh defaults retain accepted combat baselines", () => {
  const derived = getDerivedStats(character);
  assert.equal(derived.maxHitPoints, 111);
  assert.equal(derived.armorClass, 18);
  assert.equal(derived.spellSaveDc, 17);
  assert.equal(derived.spellAttackBonus, 9);
  assert.equal(derived.formattedInitiative, "+6");
  assert.equal(derived.passivePerception, 12);
  assert.equal(derived.weapons.find((weapon) => weapon.id === "sun-blade").formattedAttackBonus, "+10");
  assert.equal(derived.weapons.find((weapon) => weapon.id === "sun-blade").damageBonus, 8);
});

test("I: HP, weapon, inspiration, flourish, turn and inventory actions retain their behavior", () => {
  const state = cloneCharacter();
  state.combat.hp.current = 40;
  state.combat.hp.temp = 7;
  state.ui.hpAdjustAmount = 10;
  actions["hp-apply-damage"](state);
  assert.equal(state.combat.hp.current, 37);
  assert.equal(state.combat.hp.temp, 0);
  actions["hp-apply-heal"](state);
  assert.equal(state.combat.hp.current, 47);

  actions["weapon-attack"](state);
  assert.equal(state.ui.turn.actionUsed, true);
  state.ui.turn.actionUsed = false;
  actions["bardic-use"](state, { dataset: { markBonusAction: "true" } });
  assert.equal(state.combat.bardicInspiration.current, 4);
  assert.equal(state.ui.turn.bonusActionUsed, true);
  state.ui.turn.bonusActionUsed = false;
  actions["bardic-use"](state, { dataset: { markBonusAction: "false" } });
  assert.equal(state.combat.bardicInspiration.current, 3);
  assert.equal(state.ui.turn.bonusActionUsed, false);

  state.ui.turn.actionUsed = true;
  state.ui.turn.reactionUsed = true;
  state.ui.turn.turnNumber = 4;
  actions["turn-end"](state);
  assert.deepEqual(state.ui.turn, {
    actionUsed: false,
    bonusActionUsed: false,
    reactionUsed: false,
    turnNumber: 5,
  });

  const potion = state.inventory.items.find((item) => item.id === "healing-potion");
  potion.quantity = 1;
  actions["inventory-toggle-equipped"](state, { dataset: { itemId: "healing-potion" } });
  const updatedPotion = state.inventory.items.find((item) => item.id === "healing-potion");
  assert.equal(updatedPotion.quantity, 1);
  assert.equal(updatedPotion.equipped, true);
});

test("D: ability controls are guarded and expertise/proficiency transitions remain valid", () => {
  const state = cloneCharacter();
  const before = structuredClone(state);
  actions["ability-adjust"](state, { dataset: { abilityId: "dexterity", delta: "1" } });
  actions["skill-toggle"](state, { dataset: { skillId: "athletics", toggle: "expertise" } });
  actions["saving-throw-toggle"](state, { dataset: { abilityId: "strength" } });
  assert.deepEqual(state, before);

  state.ui.abilitiesEditable = true;
  actions["skill-toggle"](state, { dataset: { skillId: "athletics", toggle: "expertise" } });
  assert.equal(state.skills.find((skill) => skill.id === "athletics").proficient, true);
  assert.equal(state.skills.find((skill) => skill.id === "athletics").expertise, true);
  actions["skill-toggle"](state, { dataset: { skillId: "athletics", toggle: "expertise" } });
  assert.equal(state.skills.find((skill) => skill.id === "athletics").proficient, true);
  actions["skill-toggle"](state, { dataset: { skillId: "athletics", toggle: "proficient" } });
  assert.equal(state.skills.find((skill) => skill.id === "athletics").expertise, false);
});

test("A: canonical aliases and overlapping membership do not duplicate records or counts", () => {
  const state = cloneCharacter();
  state.spellcasting.cantripIds.push("mage-hand");
  state.spellcasting.preparedSpellIds.push("counterspell-2014");
  const collections = buildCharacterSpellCollections(state);
  assert.equal(collections.counts.classCantrips, 4);
  assert.equal(collections.counts.knownSpells, 15);
  assert.equal(collections.spells.filter((spell) => spell.id === "counterspell-2014").length, 1);
  assert.equal(collections.spells.find((spell) => spell.id === "counterspell-2014").memberships.length, 2);
  assert.equal(character.spellcasting.cantripIds.includes("mage-hand"), false);
});

test("A: missing IDs remain diagnostic and are not resolved through 2024 aliases", () => {
  const state = cloneCharacter();
  state.spellcasting.preparedSpellIds.push("missing-2014");
  assert.deepEqual(findMissingSpellIds(state), ["missing-2014"]);
  assert.equal(resolveSpellById("missing-2024"), null);
  assert.equal(state.spellcasting.preparedSpellIds.includes("missing-2014"), true);
});

test("A: canonical override wins over legacy alias without mutating character", () => {
  const state = cloneCharacter();
  state.spellcasting.cantripIds.push("mage-hand");
  state.spellcasting.spellOverrides["mage-hand"] = { sourceLabel: "legacy" };
  state.spellcasting.spellOverrides["mage-hand-2014"] = { sourceLabel: "canonical" };
  const before = structuredClone(state);
  const spell = buildCharacterSpellCollections(state).spells.find((entry) => entry.id === "mage-hand-2014");
  assert.equal(spell.sourceLabel, "canonical");
  assert.deepEqual(state, before);
});

test("A: ordinary selections can be removed at the limit and canonical aliases are removed together", () => {
  const state = cloneCharacter();
  state.spellcasting.cantripIds.push("mage-hand");
  actions["spell-library-toggle-select"](state, {
    dataset: { spellLibrarySelect: "mage-hand-2014", spellLibraryMode: "cantrip" },
  });
  assert.equal(state.spellcasting.cantripIds.some((id) => ["mage-hand", "mage-hand-2014"].includes(id)), false);

  const before = [...state.spellcasting.preparedSpellIds];
  actions["spell-library-toggle-select"](state, {
    dataset: { spellLibrarySelect: "cure-wounds-2014", spellLibraryMode: "prepared" },
  });
  assert.deepEqual(state.spellcasting.preparedSpellIds, before);
});

test("R2: selected spells can be removed below their learning level without changing other memberships", () => {
  const state = cloneCharacter();
  state.profile.level = 4;
  state.spellcasting.preparedSpellIds = [
    "hypnotic-pattern",
    "hypnotic-pattern-2014",
    "healing-word-2014",
    "unknown-kept",
  ];

  const beforeInvalidRequests = structuredClone(state);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    actions["spell-library-toggle-select"](state, {
      dataset: { spellLibrarySelect: "missing-spell-2014", spellLibraryMode: "prepared" },
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.deepEqual(state, beforeInvalidRequests);

  actions["spell-library-toggle-select"](state, {
    dataset: { spellLibrarySelect: "hypnotic-pattern-2014", spellLibraryMode: "invalid" },
  });
  assert.deepEqual(state, beforeInvalidRequests);

  actions["spell-library-toggle-select"](state, {
    dataset: { spellLibrarySelect: "hypnotic-pattern-2014", spellLibraryMode: "cantrip" },
  });
  assert.deepEqual(state, beforeInvalidRequests);

  actions["spell-library-toggle-select"](state, {
    dataset: { spellLibrarySelect: "minor-illusion-2014", spellLibraryMode: "cantrip" },
  });
  assert.deepEqual(state, beforeInvalidRequests);

  actions["spell-library-toggle-select"](state, {
    dataset: { spellLibrarySelect: "hypnotic-pattern-2014", spellLibraryMode: "prepared" },
  });
  assert.deepEqual(state.spellcasting.preparedSpellIds, ["healing-word-2014", "unknown-kept"]);

  const afterRemoval = structuredClone(state);
  actions["spell-library-toggle-select"](state, {
    dataset: { spellLibrarySelect: "hypnotic-pattern-2014", spellLibraryMode: "prepared" },
  });
  assert.deepEqual(state, afterRemoval);
});

test("R2: over-limit selections can be removed but further additions remain blocked", () => {
  const state = cloneCharacter();
  state.spellcasting.preparedSpellIds.push("cure-wounds-2014");
  const overLimit = buildCharacterSpellCollections(state);
  assert.ok(overLimit.counts.knownSpells > overLimit.limits.knownSpells);
  assert.ok(resolveSpellById("faerie-fire-2014"));

  actions["spell-library-toggle-select"](state, {
    dataset: { spellLibrarySelect: "healing-word-2014", spellLibraryMode: "prepared" },
  });
  assert.equal(state.spellcasting.preparedSpellIds.includes("healing-word-2014"), false);

  const afterRemoval = structuredClone(state);
  actions["spell-library-toggle-select"](state, {
    dataset: { spellLibrarySelect: "faerie-fire-2014", spellLibraryMode: "prepared" },
  });
  assert.deepEqual(state, afterRemoval);
});

test("R3: library renders removal for a selected unavailable spell and wires the existing action", () => {
  const state = cloneCharacter();
  state.profile.level = 2;
  const collections = buildCharacterSpellCollections(state);
  assert.ok(collections.counts.knownSpells > collections.limits.knownSpells);

  const root = { innerHTML: "" };
  renderSpellLibrary(root, state);
  const holdButton = root.innerHTML.match(
    /<button\b(?=[^>]*data-spell-library-select="hold-person-2014")[^>]*>[\s\S]*?<\/button>/,
  )?.[0];
  assert.ok(holdButton);
  assert.match(holdButton, /data-spell-library-mode="prepared"/);
  assert.match(holdButton, /aria-pressed="true"/);
  assert.doesNotMatch(holdButton, /\sdisabled(?:\s|>)/);
  assert.match(holdButton, /Убрать из известных/);
  assert.doesNotMatch(root.innerHTML, /data-spell-library-select="minor-illusion-2014"/);

  const before = structuredClone(state);
  actions["spell-library-toggle-select"](state, {
    dataset: { spellLibrarySelect: "hold-person-2014", spellLibraryMode: "prepared" },
  });
  assert.equal(state.spellcasting.preparedSpellIds.includes("hold-person-2014"), false);
  assert.equal(
    state.spellcasting.preparedSpellIds.some(
      (id) => resolveSpellById(id)?.id === "hold-person-2014",
    ),
    false,
  );
  assert.equal(state.spellcasting.preparedSpellIds.length, before.spellcasting.preparedSpellIds.length - 1);

  const afterRemoval = structuredClone(state);
  renderSpellLibrary(root, state);
  assert.doesNotMatch(root.innerHTML, /data-spell-library-select="hold-person-2014"/);
  actions["spell-library-toggle-select"](state, {
    dataset: { spellLibrarySelect: "hold-person-2014", spellLibraryMode: "prepared" },
  });
  assert.deepEqual(state, afterRemoval);
});

test("R4: retained Eyebite gets a circle section without fictional slots", () => {
  const state = cloneCharacter();
  state.profile.level = 1;
  state.spellcasting.preparedSpellIds = ["eyebite-2014"];
  state.spellcasting.grantedSpellIds = [
    "minor-illusion-2014",
    "disguise-self-2014",
    "invisibility-2014",
    "mind-sliver-2014",
  ];
  state.ui.spells.expandedSpellIds = ["eyebite-2014"];
  const selectedBefore = structuredClone(state.spellcasting.preparedSpellIds);
  const derived = getDerivedStats(state);
  derived.spellSlots = [
    { level: 1, max: 2, available: 2 },
    { level: 2, max: 1, available: 1 },
  ];
  const root = { innerHTML: "" };

  renderSpells(root, state, derived);
  const html = root.innerHTML;
  assert.ok(html.includes('<h2 class="section-title">1 круг</h2>'));
  assert.ok(html.includes('<h2 class="section-title">2 круг</h2>'));
  assert.ok(html.includes('<h2 class="section-title">6 круг</h2>'));
  assert.ok(html.includes("Выбранных заклинаний этого круга нет."));
  assert.ok(html.includes("Ячейки этого круга сейчас недоступны"));
  assert.match(html, /data-slot-level="1"/);
  assert.match(html, /data-slot-level="2"/);
  assert.doesNotMatch(html, /data-slot-level="6"/);
  assert.equal((html.match(/data-spells-toggle="eyebite-2014"/g) ?? []).length, 1);
  assert.match(html, /Нет доступных ячеек/);
  assert.ok(html.includes(escapeHtml(resolveSpellById("eyebite-2014").description)));
  assert.deepEqual(state.spellcasting.preparedSpellIds, selectedBefore);

  const beforeInvalidCast = structuredClone(state);
  alerts.length = 0;
  applySpell(state, { spellId: "eyebite-2014", spellMode: "slot", slotLevel: "6" });
  assert.deepEqual(state, beforeInvalidCast);
  assert.match(alerts.at(-1), /недоступно/);

  const defaultState = cloneCharacter();
  const defaultRoot = { innerHTML: "" };
  renderSpells(defaultRoot, defaultState, getDerivedStats(defaultState));
  const defaultHtml = defaultRoot.innerHTML;
  const circleIndexes = [1, 2, 3, 4, 5, 6].map((level) =>
    defaultHtml.indexOf(`<h2 class="section-title">${level} круг</h2>`),
  );
  assert.ok(circleIndexes.every((index) => index >= 0));
  assert.deepEqual(circleIndexes, [...circleIndexes].sort((a, b) => a - b));
});

test("R6: each recognized flourish reference contains its full effect and current die", () => {
  const derived = getDerivedStats(character);
  const references = [
    {
      id: "flourish-оборонительный-росчерк",
      name: "Оборонительный росчерк",
      fragments: ["действия Атака в свой ход", "Не более одного росчерка за ход", "одно использование Вдохновения барда", "урону этого попадания", "КД", "до начала следующего хода самого барда"],
    },
    {
      id: "flourish-режущий-росчерк",
      name: "Режущий росчерк",
      fragments: ["основной цели", "любое число других видимых существ", "в пределах 5 футов от барда", "не полный урон оружия"],
    },
    {
      id: "flourish-мобильный-росчерк",
      name: "Мобильный росчерк",
      fragments: ["дополнительный урон", "5 + результат броска", "реакцию", "скорости ходьбы", "свободное место", "в пределах 5 футов от цели"],
    },
  ];

  for (const feature of references) {
    const reference = getFeatureReference(feature, character, derived);
    assert.ok(reference);
    assert.ok(reference.headline.includes(derived.bardicInspiration.dice));
    for (const fragment of feature.fragments) assert.ok(reference.details.includes(fragment), fragment);
  }

  const updatedDerived = structuredClone(derived);
  updatedDerived.bardicInspiration.dice = "1к8";
  assert.match(
    getFeatureReference(references[0], character, updatedDerived).headline,
    /1к8/,
  );
  assert.equal(
    getFeatureReference({
      id: "custom-feature",
      name: "Пользовательский эффект",
      notes: "Оборонительный росчерк, но это произвольная заметка",
    }, character, derived),
    null,
  );
});

test("R6: expanded combat cards show projections separately from saved notes", () => {
  const state = cloneCharacter();
  const derived = getDerivedStats(state);
  derived.bardicInspiration.dice = "1к12";
  const features = derived.combatCards.features;
  const customFeature = {
    id: "custom-feature",
    kind: "feature",
    title: "Пользовательская способность",
    cost: "",
    notes: "Заметка: Оборонительный росчерк упомянут как текст, не правило.",
    tags: [],
  };
  features.push(customFeature);
  state.ui.melee.expandedCardIds = features.map((feature) => `feature:${feature.id}`);
  const previousDocument = globalThis.document;
  const panel = { innerHTML: "" };

  try {
    globalThis.document = { getElementById: (id) => id === "meleePanel" ? panel : null };
    renderMeleePanel(state, derived);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  const html = panel.innerHTML;
  assert.match(html, /1к12/);
  assert.match(html, /Сохранённый текст:/);
  assert.match(html, /После попадания оружием в составе действия Атака в свой ход/);
  assert.match(html, /до начала следующего хода самого барда/);
  assert.match(html, /любое число других видимых существ/);
  assert.match(html, /не полный урон оружия/);
  assert.match(html, /5 \+ результат броска/);
  assert.match(html, /свободное место в пределах 5 футов от цели/);
  assert.match(html, /Заметка: Оборонительный росчерк упомянут как текст, не правило\./);

  const articles = [...html.matchAll(/<article class="combat-expandable-card[\s\S]*?<\/article>/g)]
    .map(([article]) => article);
  for (const feature of features) {
    const article = articles.find((item) => item.includes(escapeHtml(feature.title)));
    assert.ok(article);
    if (feature.id.startsWith("flourish-")) {
      assert.equal((article.match(/data-action="bardic-use"/g) ?? []).length, 1);
    }
  }
  const weapon = derived.combatCards.weapons[0];
  assert.ok(articles.some((article) =>
    article.includes(escapeHtml(weapon.title)) &&
    article.includes('data-action="weapon-attack"'),
  ));

  const customArticle = articles.find((article) =>
    article.includes('data-melee-toggle="feature:custom-feature"'),
  );
  assert.ok(customArticle);
  assert.match(customArticle, /Заметка: Оборонительный росчерк упомянут как текст, не правило\./);
  assert.doesNotMatch(customArticle, /После попадания оружием в составе действия Атака/);
});

test("B: counterspell marks reaction and charges selected slot once", () => {
  const state = cloneCharacter();
  applySpell(state, { spellId: "counterspell-2014", spellMode: "slot", slotLevel: "3", castTime: "1 действие", setsConcentration: "false" });
  assert.equal(state.ui.turn.reactionUsed, true);
  assert.equal(state.ui.turn.actionUsed, false);
  assert.equal(state.spellcasting.slotsUsed[3], 1);
});

test("B: healing word marks bonus action; dataset cannot override game properties", () => {
  const state = cloneCharacter();
  applySpell(state, { spellId: "healing-word-2014", spellMode: "slot", slotLevel: "1", castTime: "1 реакция" });
  assert.equal(state.ui.turn.bonusActionUsed, true);
  assert.equal(state.ui.turn.reactionUsed, false);
  assert.equal(state.spellcasting.slotsUsed[1], 1);
});

test("B: cantrip uses no slot and racial uses at zero never fall back to a slot", () => {
  const cantrip = cloneCharacter();
  applySpell(cantrip, { spellId: "mind-sliver-2014", spellMode: "cantrip", slotLevel: "5" });
  assert.equal(cantrip.spellcasting.slotsUsed[5], 0);

  const racial = cloneCharacter();
  racial.spellcasting.spellOverrides["invisibility-2014"].uses.current = 0;
  const before = structuredClone(racial);
  alerts.length = 0;
  applySpell(racial, { spellId: "invisibility-2014", spellMode: "racial", slotLevel: "2" });
  assert.deepEqual(racial, before);
  assert.equal(alerts.at(-1), "Расовое применение этого заклинания израсходовано.");
});

test("B: upcast spends exactly the explicitly selected higher slot; racial use spends no slot", () => {
  const upcast = cloneCharacter();
  applySpell(upcast, { spellId: "dissonant-whispers-2014", spellMode: "slot", slotLevel: "3" });
  assert.equal(upcast.spellcasting.slotsUsed[1], 0);
  assert.equal(upcast.spellcasting.slotsUsed[3], 1);

  const racial = cloneCharacter();
  applySpell(racial, { spellId: "disguise-self-2014", spellMode: "racial", slotLevel: "2" });
  assert.equal(racial.spellcasting.spellOverrides["disguise-self-2014"].uses.current, 0);
  assert.equal(racial.spellcasting.slotsUsed[2], 0);
});

test("B: cancelling concentration and invalid slot levels make no state changes", () => {
  const state = cloneCharacter();
  state.combat.concentration = "Гипнотический узор";
  const before = structuredClone(state);
  window.confirm = () => false;
  applySpell(state, { spellId: "hypnotic-pattern-2014", spellMode: "slot", slotLevel: "3" });
  assert.deepEqual(state, before);

  window.confirm = () => true;
  applySpell(state, { spellId: "hypnotic-pattern-2014", spellMode: "slot", slotLevel: "NaN" });
  assert.deepEqual(state, before);
});

test("F: short rest preserves HP, temp HP, slots and racial uses and filters only short-rest effects", () => {
  window.confirm = () => true;
  const state = cloneCharacter();
  state.profile.level = 4;
  state.combat.hp.current = 33;
  state.combat.hp.temp = 7;
  state.combat.bardicInspiration.current = 0;
  state.spellcasting.slotsUsed[1] = 2;
  state.spellcasting.spellOverrides["disguise-self-2014"].uses.current = 0;
  state.ui.activeEffects = [
    { id: "s", durationType: "until-short-rest" },
    { id: "c", durationType: "custom" },
    { id: "u", durationType: "unknown" },
    { id: "m", notes: "kept" },
  ];
  actions["short-rest"](state);
  assert.equal(state.combat.hp.current, 33);
  assert.equal(state.combat.hp.temp, 7);
  assert.equal(state.combat.bardicInspiration.current, 0);
  assert.equal(state.spellcasting.slotsUsed[1], 2);
  assert.equal(state.spellcasting.spellOverrides["disguise-self-2014"].uses.current, 0);
  assert.deepEqual(state.ui.activeEffects.map((effect) => effect.id), ["c", "u", "m"]);
});

test("F: short rest restores inspiration only with Font and uses derived CHA maximum", () => {
  window.confirm = () => true;
  for (const level of [5, 12]) {
    const state = cloneCharacter();
    state.profile.level = level;
    state.abilities.charisma = 16;
    state.combat.bardicInspiration.current = 0;
    actions["short-rest"](state);
    assert.equal(state.combat.bardicInspiration.current, 3);
  }
});

test("F: cancelling rest leaves the draft unchanged", () => {
  const state = cloneCharacter();
  const before = structuredClone(state);
  window.confirm = () => false;
  actions["short-rest"](state);
  actions["long-rest"](state);
  assert.deepEqual(state, before);
  window.confirm = () => true;
});

test("F: long rest restores agreed resources and preserves non-expiring/unknown effects", () => {
  const state = cloneCharacter();
  state.combat.hp.current = 12;
  state.combat.hp.temp = 7;
  state.combat.concentration = "Иллюзия";
  state.ui.turn = { actionUsed: true, bonusActionUsed: true, reactionUsed: true, turnNumber: 8 };
  state.spellcasting.slotsUsed[1] = 3;
  state.combat.bardicInspiration.current = 0;
  state.spellcasting.spellOverrides["disguise-self-2014"].uses.current = 0;
  state.ui.activeEffects = [
    { id: "s", durationType: "until-short-rest" },
    { id: "l", durationType: "until-long-rest" },
    { id: "c", durationType: "custom" },
    { id: "p", durationType: "permanent" },
    { id: "u", durationType: "unrecognized" },
    { id: "m", notes: "retained" },
  ];
  actions["long-rest"](state);
  assert.equal(state.combat.hp.current, 111);
  assert.equal(state.combat.hp.temp, 0);
  assert.equal(state.combat.concentration, "");
  assert.deepEqual(state.ui.turn, { actionUsed: false, bonusActionUsed: false, reactionUsed: false, turnNumber: 1 });
  assert.equal(state.spellcasting.slotsUsed[1], 0);
  assert.equal(state.combat.bardicInspiration.current, 5);
  assert.equal(state.spellcasting.spellOverrides["disguise-self-2014"].uses.current, 1);
  assert.deepEqual(state.ui.activeEffects.map((effect) => effect.id), ["c", "p", "u", "m"]);
});

test("G: migration preserves exact legacy text, merges entries, and is idempotent", () => {
  const source = {
    notes: "  Кириллица🙂\\n<script>не HTML</script>  ",
    noteEntries: [{ id: "n1", title: "Имя", text: "Текст", extra: 7 }],
  };
  const migrated = migrateLoreNotes(source);
  assert.equal(migrated.lore.noteEntries[0].id, LEGACY_NOTE_ID);
  assert.equal(migrated.lore.noteEntries[0].text, source.notes);
  assert.equal(migrated.lore.noteEntries[1].extra, 7);
  assert.equal(migrateLoreNotes(migrated.lore).lore.noteEntries.length, 2);
});

test("G: deleted legacy entry does not return and malformed collection remains intact", () => {
  const migrated = migrateLoreNotes({ notes: "legacy" }).lore;
  migrated.noteEntries = [];
  assert.equal(migrateLoreNotes(migrated).lore.noteEntries.length, 0);
  const malformed = { notes: "preserve", noteEntries: "raw" };
  const result = migrateLoreNotes(malformed);
  assert.equal(result.lore.noteEntries, "raw");
  assert.match(result.issue, /повреждена/);
});

test("G: note CRUD is stable-ID based and preserves order on edits", () => {
  const created = createNoteEntry([], { id: "a", title: "One", text: "" });
  const second = createNoteEntry(created.entries, { id: "b", title: "Two", text: "x" });
  const edited = updateNoteEntry(second.entries, "b", "title", "Renamed");
  assert.deepEqual(edited.entries.map((entry) => entry.id), ["b", "a"]);
  assert.equal(edited.entries[0].title, "Renamed");
  assert.equal(deleteNoteEntry(edited.entries, "a").entries.length, 1);
  assert.match(validateNoteEntries([{ id: "duplicate", title: "a", text: "" }, { id: "duplicate", title: "b", text: "" }]), /ID/);
});

test("G: storage failure returns failure while state remains in memory and later save succeeds", () => {
  const updates = [];
  const unsubscribe = subscribe((_state, metadata) => {
    if (metadata?.kind === "lore-note-edit") updates.push(metadata);
  });
  const id = getState().lore.noteEntries[0]?.id ?? "memory-test";
  failStorageWrite = true;
  updateState((draft) => {
    draft.lore.noteEntries = [{ id, title: "Memory", text: "Сохранить🙂" }];
    return draft;
  }, { kind: "lore-note-edit", noteId: id, field: "text" });
  assert.equal(getState().lore.noteEntries[0].text, "Сохранить🙂");
  assert.equal(updates.at(-1).persistenceResult.ok, false);

  failStorageWrite = false;
  const result = savePersistedState(getState());
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(persisted.get("aurelia-character-sheet:v2")).lore.noteEntries[0].text, "Сохранить🙂");
  unsubscribe();
});

test("H: swipe thresholds, directions, edges, and vertical gestures are deterministic", () => {
  const swipe = (dx, dy, duration = 180, startX = 180, activeIndex = 2) =>
    decideSwipe({ dx, dy, duration, startX, viewportWidth: 390, count: 6, activeIndex });
  assert.equal(swipe(-80, 20), 3);
  assert.equal(swipe(80, 20), 1);
  assert.equal(swipe(40, 0), null);
  assert.equal(swipe(-80, 60), null);
  assert.equal(swipe(-80, 10, 79), null);
  assert.equal(swipe(-80, 10, 701), null);
  assert.equal(swipe(-80, 10, 180, 23), null);
  assert.equal(swipe(80, 5, 180, 180, 0), null);
  assert.equal(swipe(-80, 5, 180, 180, 5), null);
  assert.equal(isClearlyVertical(2, 12), true);
  assert.equal(isClearlyVertical(80, 45), false);
  assert.equal(isSwipeContextValid({ contactCount: 2, startTab: "profile", activeTab: "profile", compact: true, visible: true }), false);
  assert.equal(isSwipeContextValid({ contactCount: 1, startTab: "profile", activeTab: "melee", compact: true, visible: true }), false);
  assert.equal(isSwipeContextValid({ contactCount: 1, startTab: "profile", activeTab: "profile", compact: false, visible: true }), false);
  assert.equal(isSwipeContextValid({ contactCount: 1, startTab: "profile", activeTab: "profile", compact: true, visible: true, cancelled: true }), false);
  assert.equal(isCurrentScrollRestore({ requestedGeneration: 3, currentGeneration: 3, requestedTab: "lore", activeTab: "lore" }), true);
  assert.equal(isCurrentScrollRestore({ requestedGeneration: 2, currentGeneration: 3, requestedTab: "profile", activeTab: "lore" }), false);
});

test("E: dynamic rule references and personalized spell hints use current values", () => {
  assert.equal(getSongOfRestDie(12), "1к8");
  assert.equal(getSongOfRestDie(17), "1к12");
  const derived = {
    level: 12,
    abilityModifiers: { charisma: 5 },
    abilityChecks: { charisma: 7 },
    proficiencyBonus: 4,
    bardicInspiration: { dice: "1к10", max: 5, refresh: "Короткий или долгий отдых" },
  };
  assert.match(getSpellPersonalHint({ id: "mind-sliver-2014" }, derived), /3к6/);
  assert.match(getSpellPersonalHint({ id: "healing-word-2014" }, derived, 3), /3к4 \+ 5/);
  assert.match(getSpellPersonalHint({ id: "counterspell-2014" }, derived), /\+7/);
  assert.match(getFeatureReference({ name: "Песнь отдыха" }, { profile: { level: 12 } }, derived).headline, /1к8/);
  assert.match(getItemRuleReference({ id: "sun-blade" }), /не применяется/);
});
