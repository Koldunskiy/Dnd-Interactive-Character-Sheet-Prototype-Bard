import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import { getDerivedStats } from "../../scripts/calculations.js";
import {
  getSaraHudModel,
  renderSaraHud,
  updateSaraHudRegion,
} from "../../scripts/render/sara-hud.js";

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
  assert.match(markup, /ХП <strong>0\//);
  assert.match(markup, /Временные ХП 4/);
  assert.match(markup, /Концентрация: <strong>&lt;focus&gt;/);
  assert.match(markup, /&lt;effect&gt;/);
  assert.match(markup, /&amp;source/);
  assert.match(markup, /Отдельный эффект/);
  assert.match(markup, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(markup, /<img src=x/);
  assert.deepEqual(state, before);
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
