import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import {
  getSaraHudModel,
  renderSaraHud,
  updateSaraHudRegion,
} from "../../scripts/render/sara-hud.js";
import { renderHeader } from "../../scripts/render/render-header.js";

function resourceBlock(markup, kind) {
  const start = markup.indexOf(`class="sara-hud__resource sara-hud__resource--${kind}"`);
  assert.notEqual(start, -1, `missing ${kind} resource block`);
  const opening = markup.lastIndexOf("<div", start);
  const tags = /<\/?div\b[^>]*>/g;
  tags.lastIndex = opening;
  let depth = 0;
  let match;
  while ((match = tags.exec(markup))) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return markup.slice(opening, tags.lastIndex);
  }
  assert.fail(`unclosed ${kind} resource block`);
}

function assertValidResource(markup, kind, current, maximum, percent) {
  const block = resourceBlock(markup, kind);
  const label = kind === "hp" ? "ХП" : "Ци";
  assert.ok(block.includes(`<span>${label}</span><strong>${current} / ${maximum}</strong>`));
  assert.ok(block.includes(`style="--sara-resource-fill:${percent}%"`));
  assert.ok(block.includes(`role="meter" aria-label="${label}" aria-valuemin="0"`));
  assert.ok(block.includes(`aria-valuemax="${maximum}"`));
  assert.ok(block.includes(`aria-valuenow="${Math.min(current, maximum)}"`));
  return block;
}

function assertInvalidResource(markup, kind, currentText, maximumText) {
  const block = resourceBlock(markup, kind);
  const label = kind === "hp" ? "ХП" : "Ци";
  assert.ok(block.includes(`<span>${label}</span><strong>${currentText} / ${maximumText}</strong>`));
  assert.ok(block.includes(`aria-label="${label}: нет корректных данных"`));
  assert.ok(block.includes("Нет корректных данных"));
  assert.ok(block.includes("style=\"--sara-resource-fill:0%\""));
  assert.doesNotMatch(block, /role="meter"|aria-valuemin=|aria-valuemax=|aria-valuenow=/);
  return block;
}

test("Sara HUD projects current derived resources and escapes optional text without mutation", () => {
  const state = structuredClone(sara);
  state.combat.hp.current = 0;
  state.combat.hp.temp = 4;
  state.combat.concentration = "<focus>";
  state.ui.activeEffects = [
    { id: "valid", name: "<effect>", source: "&source", duration: "1 round",
      notes: '<img src=x onerror="alert(1)">' },
    { id: "same-source", name: "Отдельный эффект", source: "<focus>" },
    { id: "invalid", name: " " },
  ];
  const before = structuredClone(state);
  const model = getSaraHudModel(state, getDerivedStats(state));
  const modelBefore = structuredClone(model);
  const markup = renderSaraHud(model);
  assert.doesNotMatch(markup, /sara-hud--compact/);
  assert.equal(model.hp, 0);
  assert.equal(model.maxHp, getDerivedStats(state).maxHitPoints);
  assert.equal(model.ki.current, getDerivedStats(state).ki.current);
  assertValidResource(markup, "hp", 0, model.maxHp, 0);
  assertValidResource(markup, "ki", model.ki.current, model.ki.maximum, 100);
  assert.match(markup, /Временные ХП <strong>4<\/strong>/);
  assert.match(markup, /Концентрация: <strong>&lt;focus&gt;/);
  assert.match(markup, /&lt;effect&gt;/);
  assert.match(markup, /&amp;source/);
  assert.match(markup, /Отдельный эффект/);
  assert.match(markup, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(markup, /<img src=x/);
  assert.deepEqual(state, before);
  assert.deepEqual(model, modelBefore);
});

test("HP and Ki meters independently render zero, partial, full, and over-maximum values", () => {
  const model = {
    hp: 25, maxHp: 100, tempHp: 0, ki: { current: 75, maximum: 100 },
    practiced: { current: 2, maximum: 3 }, effects: [],
  };
  for (const [current, percent] of [[0, 0], [25, 25], [100, 100], [125, 100]]) {
    model.hp = current;
    const markup = renderSaraHud(model);
    const hpBlock = assertValidResource(markup, "hp", current, 100, percent);
    if (current > 100) assert.ok(hpBlock.includes('aria-valuenow="100" aria-valuetext="125 / 100"'));
    assertValidResource(markup, "ki", 75, 100, 75);
  }
  model.hp = 25;
  for (const [current, percent] of [[0, 0], [50, 50], [100, 100], [125, 100]]) {
    model.ki.current = current;
    const markup = renderSaraHud(model);
    assertValidResource(markup, "hp", 25, 100, 25);
    const kiBlock = assertValidResource(markup, "ki", current, 100, percent);
    if (current > 100) assert.ok(kiBlock.includes('aria-valuenow="100" aria-valuetext="125 / 100"'));
  }
});

test("invalid HP and Ki pairs are independently neutral and exclude invalid meter attributes", () => {
  const model = {
    hp: 25, maxHp: 100, tempHp: 0, ki: { current: 75, maximum: 100 }, effects: [],
  };
  const invalidCases = [
    [undefined, 100, "—", "100"],
    [5, undefined, "5", "—"],
    [5, 0, "5", "0"],
    [5, -1, "5", "-1"],
    [-1, 100, "-1", "100"],
    [null, 100, "—", "100"],
    [NaN, 100, "—", "100"],
    [Infinity, 100, "—", "100"],
    ["<img>", 100, "—", "100"],
    [true, 100, "—", "100"],
  ];
  for (const [current, maximum, currentText, maximumText] of invalidCases) {
    model.hp = current;
    model.maxHp = maximum;
    const markup = renderSaraHud(model);
    assertInvalidResource(markup, "hp", currentText, maximumText);
    assertValidResource(markup, "ki", 75, 100, 75);
    assert.doesNotMatch(resourceBlock(markup, "hp"), /NaN|Infinity|<img>/);
  }
  for (const [current, maximum, currentText, maximumText] of invalidCases) {
    model.hp = 25;
    model.maxHp = 100;
    model.ki = { current, maximum };
    const markup = renderSaraHud(model);
    assertValidResource(markup, "hp", 25, 100, 25);
    assertInvalidResource(markup, "ki", currentText, maximumText);
  }
  const zeroMaximum = renderSaraHud({
    ...model, hp: 0, maxHp: 0, ki: { current: 75, maximum: 100 },
  });
  assertInvalidResource(zeroMaximum, "hp", "0", "0");
  const huge = renderSaraHud({
    ...model, hp: Number.MAX_VALUE, maxHp: Number.MIN_VALUE,
    ki: { current: 75, maximum: 100 },
  });
  assertValidResource(huge, "hp", Number.MAX_VALUE, Number.MIN_VALUE, 100);
});

test("temporary HP changes do not alter the HP meter fill", () => {
  const model = {
    hp: 25, maxHp: 100, tempHp: 0, ki: { current: 75, maximum: 100 }, effects: [],
  };
  const before = resourceBlock(renderSaraHud(model), "hp");
  model.tempHp = 9;
  const afterMarkup = renderSaraHud(model);
  const after = resourceBlock(afterMarkup, "hp");
  assert.equal(after, before);
  assert.match(afterMarkup, /Временные ХП <strong>9<\/strong>/);
});

test("scene, header, task, and compact presentations retain required resource labels", () => {
  const model = {
    hp: 8, maxHp: 10, tempHp: 3, ki: { current: 4, maximum: 6 },
    practiced: { current: 2, maximum: 5 }, armorClass: 17, speed: 40,
    reactionAvailable: true, concentration: "", effects: [],
  };
  const scene = renderSaraHud(model);
  const header = renderSaraHud(model, { presentation: "header" });
  const taskCompact = renderSaraHud(model, { presentation: "task", compact: true });
  for (const markup of [scene, header, taskCompact]) {
    assert.match(markup, /ХП/);
    assert.match(markup, /Ци/);
    assert.match(markup, /8 \/ 10/);
    assert.match(markup, /4 \/ 6/);
    assert.match(markup, /Временные ХП/);
  }
  assert.match(header, /Отработано <strong>2\/5/);
  assert.doesNotMatch(header, /Эффекты/);
  assert.match(scene, /Реакция/);
  assert.doesNotMatch(taskCompact, /Реакция/);
});

test("header delegates Sara resources to the shared model and clears them for another owner", () => {
  const nodes = {
    heroName: { textContent: "" },
    heroSubtitle: { textContent: "" },
    characterRollShortcut: { hidden: false },
    saraHeaderResources: {
      hidden: true, innerHTML: "", details: [],
      querySelectorAll: () => [],
      replaceChildren() { this.innerHTML = ""; },
    },
  };
  const originalDocument = globalThis.document;
  globalThis.document = {
    title: "",
    getElementById: (id) => nodes[id] ?? null,
  };
  try {
    const state = structuredClone(sara);
    state.combat.hp.current = 37;
    const stateBefore = structuredClone(state);
    const derived = getDerivedStats(state);
    const derivedBefore = structuredClone(derived);
    renderHeader(state, derived);
    const markup = nodes.saraHeaderResources.innerHTML;
    assert.equal(nodes.saraHeaderResources.hidden, false);
    assert.match(markup, /37 \/ \d+/);
    assert.match(markup, /sara-hud--header/);
    assert.match(markup, /Отработано/);
    assert.deepEqual(state, stateBefore);
    assert.deepEqual(derived, derivedBefore);
    const anotherState = { profile: { id: "another", name: "Other" } };
    const anotherStateBefore = structuredClone(anotherState);
    renderHeader(anotherState);
    assert.equal(nodes.saraHeaderResources.hidden, true);
    assert.equal(nodes.saraHeaderResources.innerHTML, "");
    assert.deepEqual(anotherState, anotherStateBefore);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("HUD omits zero temporary HP and renders both reaction states", () => {
  const state = structuredClone(sara);
  state.combat.hp.temp = 0;
  state.ui.turn.reactionUsed = false;
  assert.match(renderSaraHud(getSaraHudModel(state)), /Реакция <strong>готова/);
  assert.doesNotMatch(renderSaraHud(getSaraHudModel(state)), /Временные ХП/);
  state.ui.turn.reactionUsed = true;
  assert.match(renderSaraHud(getSaraHudModel(state)), /Реакция <strong>потрачена/);
});

test("targeted HUD update preserves details state without replacing its own region unnecessarily", () => {
  class Details {
    open = false;
  }
  class Region {
    details = [];
    _html = "";
    get innerHTML() { return this._html; }
    set innerHTML(value) {
      this._html = value;
      this.details = value.includes("<details") ? [new Details()] : [];
    }
    querySelectorAll(selector) {
      return selector === "details" ? this.details : [];
    }
  }
  const region = new Region();
  updateSaraHudRegion(null, getSaraHudModel(sara));
  const withEffect = structuredClone(sara);
  withEffect.ui.activeEffects = [{ id: "effect", name: "Открытый эффект", source: "Тест" }];
  const firstModel = getSaraHudModel(withEffect);
  const firstModelBefore = structuredClone(firstModel);
  updateSaraHudRegion(region, firstModel);
  const firstMarkup = region.innerHTML;
  const sameDetails = region.details[0];
  sameDetails.open = true;
  updateSaraHudRegion(region, firstModel);
  assert.equal(region.innerHTML, firstMarkup);
  assert.equal(region.details[0], sameDetails);
  assert.deepEqual(firstModel, firstModelBefore);

  const changed = structuredClone(withEffect);
  changed.combat.hp.current -= 1;
  updateSaraHudRegion(region, getSaraHudModel(changed));
  assert.notEqual(region.innerHTML, firstMarkup);
  assert.equal(region.details[0].open, true);
  assert.deepEqual(firstModel, firstModelBefore);
});
