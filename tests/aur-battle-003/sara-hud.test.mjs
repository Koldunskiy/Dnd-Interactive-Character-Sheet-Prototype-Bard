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
  const markup = renderSaraHud(model);
  assert.doesNotMatch(markup, /sara-hud--compact/);
  assert.equal(model.hp, 0);
  assert.equal(model.maxHp, getDerivedStats(state).maxHitPoints);
  assert.equal(model.ki.current, getDerivedStats(state).ki.current);
  assert.match(markup, /<span>ХП<\/span><strong>0 \/ \d+/);
  assert.match(markup, /role="meter" aria-label="ХП" aria-valuemin="0"/);
  assert.match(markup, /Временные ХП <strong>4<\/strong>/);
  assert.match(markup, /Концентрация: <strong>&lt;focus&gt;/);
  assert.match(markup, /&lt;effect&gt;/);
  assert.match(markup, /&amp;source/);
  assert.match(markup, /Отдельный эффект/);
  assert.match(markup, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(markup, /<img src=x/);
  assert.deepEqual(state, before);
});

test("resource meters clamp only presentation and keep temporary HP separate", () => {
  const model = {
    hp: 0, maxHp: 10, tempHp: 7, ki: { current: 5, maximum: 10 },
    practiced: { current: 2, maximum: 3 }, effects: [],
  };
  const zeroMarkup = renderSaraHud(model);
  assert.match(zeroMarkup, /--sara-resource-fill:0%/);
  assert.match(zeroMarkup, /Временные ХП <strong>7<\/strong>/);
  model.hp = 5;
  assert.match(renderSaraHud(model), /--sara-resource-fill:50%/);
  model.hp = 10;
  assert.match(renderSaraHud(model), /--sara-resource-fill:100%/);
  model.hp = 14;
  const overMaximum = renderSaraHud(model);
  assert.match(overMaximum, /14 \/ 10/);
  assert.match(overMaximum, /aria-valuenow="10" aria-valuetext="14 \/ 10"/);
  assert.match(overMaximum, /--sara-resource-fill:100%/);
  assert.equal((overMaximum.match(/--sara-resource-fill:100%/g) ?? []).length, 1);
});

test("invalid resource pairs are neutral, explicit, and never inject numeric markup", () => {
  const base = { hp: 5, maxHp: 10, tempHp: 0, ki: { current: 5, maximum: 10 }, effects: [] };
  for (const [current, maximum] of [
    [undefined, 10], [5, undefined], [5, 0], [5, -1], [-1, 10],
    [null, 10], [NaN, 10], [Infinity, 10], ["<img>", 10], [true, 10],
  ]) {
    const markup = renderSaraHud({ ...base, hp: current, maxHp: maximum });
    assert.match(markup, /ХП: нет корректных данных/);
    assert.match(markup, /Нет корректных данных/);
    assert.equal((markup.match(/aria-valuemax=/g) ?? []).length, 1);
    assert.match(markup, /--sara-resource-fill:0%/);
    assert.doesNotMatch(markup, /NaN|Infinity|<img>/);
  }
  const zeroMaximum = renderSaraHud({ ...base, hp: 0, maxHp: 0 });
  assert.match(zeroMaximum, /0 \/ 0/);
  assert.match(zeroMaximum, /Ци<\/span><strong>5 \/ 10/);
  const huge = renderSaraHud({ ...base, hp: Number.MAX_VALUE, maxHp: Number.MIN_VALUE });
  assert.match(huge, /--sara-resource-fill:100%/);
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
    const derived = getDerivedStats(state);
    renderHeader(state, derived);
    const markup = nodes.saraHeaderResources.innerHTML;
    assert.equal(nodes.saraHeaderResources.hidden, false);
    assert.match(markup, /37 \/ \d+/);
    assert.match(markup, /sara-hud--header/);
    assert.match(markup, /Отработано/);
    renderHeader({ profile: { id: "another", name: "Other" } });
    assert.equal(nodes.saraHeaderResources.hidden, true);
    assert.equal(nodes.saraHeaderResources.innerHTML, "");
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
  updateSaraHudRegion(region, firstModel);
  const firstMarkup = region.innerHTML;
  const sameDetails = region.details[0];
  sameDetails.open = true;
  updateSaraHudRegion(region, firstModel);
  assert.equal(region.innerHTML, firstMarkup);
  assert.equal(region.details[0], sameDetails);

  const changed = structuredClone(withEffect);
  changed.combat.hp.current -= 1;
  updateSaraHudRegion(region, getSaraHudModel(changed));
  assert.notEqual(region.innerHTML, firstMarkup);
  assert.equal(region.details[0].open, true);
});
