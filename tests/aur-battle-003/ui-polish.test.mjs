import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sara } from "../../data/sara.js";
import { APP_PREFERENCES_KEY } from "../../scripts/characters.js";
import {
  getState,
  openCharacterSession,
  readAppPreferences,
  saveAppPreferences,
  updateState,
} from "../../scripts/state.js";
import {
  applyResolvedTheme,
  clearRuntimeCharacterThemeOverride,
  getSelectedCharacterTheme,
  resolveCharacterTheme,
  setRuntimeCharacterThemeOverride,
} from "../../scripts/themes.js";
import { calculateCharacterRoll } from "../../scripts/rolls/calculations.js";
import {
  correctCharacterRollOutcome,
  recordAndAmendCharacterRoll,
  recordCharacterRoll,
  resolveCharacterRollConsequence,
} from "../../scripts/rolls/commands.js";
import { getSaraRollBreakdown } from "../../scripts/rolls/providers/sara.js";
import { renderBattleConsole } from "../../scripts/render/render-battle-console.js";
import { renderCommandWorkspace } from "../../scripts/render/render-command-workspace.js";

test("battle cards separate full-width titles from wrapping costs and keep full spell details accessible", () => {
  const markup = renderBattleConsole(structuredClone(sara));
  assert.match(markup, /battle-command-card__chips/);
  assert.match(markup, /Ядовитые брызги[\s\S]*?Без лимита/);
  assert.match(markup, /Мистическая регенерация/);
  assert.match(markup, /Дружба с животными[\s\S]*?Подходящая змея; спасбросок Мудрости/);
  assert.match(markup, /Внушение[\s\S]*?Цель слышит и понимает предложение/);
  assert.match(markup, /<details class="battle-command-card__details">/);
  assert.match(markup, /Только видимая змея/);
  assert.equal(markup.split("Только видимая змея-зверь").length - 1, 1);
});

test("battle cards and global surfaces have wrapping and theme-token safeguards", async () => {
  const [battleCss, themeCss, tokens, workspaceCss] = await Promise.all([
    readFile(new URL("../../styles/battle-console.css", import.meta.url), "utf8"),
    readFile(new URL("../../styles/theme-surfaces.css", import.meta.url), "utf8"),
    readFile(new URL("../../styles/tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../../styles/action-workspace.css", import.meta.url), "utf8"),
  ]);
  assert.match(battleCss, /\.battle-command-card__open\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(battleCss, /\.battle-command-card\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(battleCss, /\.battle-command-card__chips\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(battleCss, /\.battle-command-card__chip\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(themeCss, /:root\[data-theme\]\s+dialog::backdrop/);
  assert.match(themeCss, /--backdrop/);
  assert.match(tokens, /:root\[data-theme="teal-slate"\]/);
  assert.match(tokens, /--color-accent:\s*var\(--accent\)/);
  assert.match(workspaceCss, /font-size:\s*clamp\(4rem,\s*18vw,\s*4\.75rem\)/);
});

test("new roll form omits DC and consequence inputs and renders a live total", () => {
  const session = {
    scenarioId: "character-roll",
    currentStep: "command-input",
    currentStepKey: "command-input:character-roll",
    rawInputsByStep: {
      "command-input:character-roll": {
        kind: "saving-throw",
        id: "dexterity",
        rollMode: "normal",
        firstD20: "14",
        dc: "22",
        incomingDamage: "9",
        consequenceProfile: "save-half",
      },
    },
    command: { titleRu: "Проверка или спасбросок" },
  };
  const markup = Object.values(renderCommandWorkspace(session, structuredClone(sara))).join("\n");
  assert.doesNotMatch(markup, /Сложность \(если известна\)|Входящий урон \(если применимо\)/);
  assert.doesNotMatch(markup, /name="(?:dc|incomingDamage|consequenceProfile)"/);
  assert.doesNotMatch(markup, /Подтвердить и записать/);
  assert.match(markup, /data-roll-total/);
  assert.match(markup, /data-roll-outcome="success"/);
  assert.match(markup, /data-roll-outcome="failure"/);
});

test("late save-half profile can use the Evasion feature snapshot", () => {
  const breakdown = getSaraRollBreakdown(structuredClone(sara), "saving-throw", "dexterity");
  const preview = calculateCharacterRoll({
    kind: "saving-throw",
    rollMode: "normal",
    firstD20: "14",
  }, breakdown);
  assert.equal(preview.ok, true);
  assert.equal(preview.featureSnapshot.evasionAvailable, true);
});

test("manual outcome updates both checks and saving throws without creating another roll", () => {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const created = recordCharacterRoll({
    kind: "ability-check",
    id: "athletics",
    rollMode: "normal",
    firstD20: "12",
  });
  assert.equal(created.status, "applied");
  const recordCount = getState().characterRolls.records.length;
  const result = correctCharacterRollOutcome(created.record.id, "success");
  assert.equal(result.status, "applied");
  assert.equal(result.record.id, created.record.id);
  assert.equal(result.record.manualOutcome, "success");
  assert.equal(result.record.dcResult, true);
  assert.equal(getState().characterRolls.records.length, recordCount);
});

test("theme resolution keeps per-character overrides independent and supports automatic defaults", () => {
  const preferences = {
    lastCharacterId: "sara-velaris",
    lastTab: { "sara-velaris": "melee" },
    themeOverrides: { aurelia: "teal-slate" },
    retainedField: "preserved",
  };
  assert.equal(resolveCharacterTheme("sara-velaris", null), "teal-slate");
  assert.equal(resolveCharacterTheme("aurelia", null), "wine-gold");
  assert.equal(resolveCharacterTheme("sara-velaris", preferences), "teal-slate");
  assert.equal(resolveCharacterTheme("aurelia", preferences), "teal-slate");
  assert.equal(getSelectedCharacterTheme("sara-velaris", preferences), "character");
  assert.equal(getSelectedCharacterTheme("aurelia", preferences), "teal-slate");
  const root = { dataset: {} };
  const meta = { content: "" };
  assert.equal(applyResolvedTheme("wine-gold", {
    documentElement: root,
    querySelector: () => meta,
  }), true);
  assert.equal(root.dataset.theme, "wine-gold");
  assert.equal(meta.content, "#090607");

  setRuntimeCharacterThemeOverride("sara-velaris", "wine-gold");
  assert.equal(resolveCharacterTheme("sara-velaris", preferences), "wine-gold");
  assert.equal(resolveCharacterTheme("aurelia", preferences), "teal-slate");
  clearRuntimeCharacterThemeOverride("sara-velaris");
});

test("theme preferences preserve unrelated fields and leave malformed storage untouched", () => {
  const values = new Map([[APP_PREFERENCES_KEY, JSON.stringify({
    lastCharacterId: "sara-velaris",
    lastTab: { "sara-velaris": "melee" },
    themeOverrides: { aurelia: "wine-gold" },
    futureOption: { enabled: true },
  })]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const loaded = readAppPreferences(storage);
  assert.equal(loaded.status, "loaded");
  assert.equal(saveAppPreferences({
    ...loaded.preferences,
    themeOverrides: {
      ...loaded.preferences.themeOverrides,
      "sara-velaris": "teal-slate",
    },
  }, storage).ok, true);
  const saved = readAppPreferences(storage);
  assert.equal(saved.preferences.lastCharacterId, "sara-velaris");
  assert.deepEqual(saved.preferences.lastTab, { "sara-velaris": "melee" });
  assert.deepEqual(saved.preferences.themeOverrides, {
    aurelia: "wine-gold",
    "sara-velaris": "teal-slate",
  });
  assert.deepEqual(saved.preferences.futureOption, { enabled: true });

  const malformed = "{";
  values.set(APP_PREFERENCES_KEY, malformed);
  assert.equal(readAppPreferences(storage).status, "invalid");
  assert.equal(values.get(APP_PREFERENCES_KEY), malformed);
});

test("priced Indomitable Spirit record-and-amend is atomic and requires timing confirmation", () => {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const before = getState();
  const input = {
    kind: "ability-check",
    id: "athletics",
    rollMode: "normal",
    firstD20: "12",
  };
  const rejected = recordAndAmendCharacterRoll(input, "ll-monk:indomitable-spirit", {
    timingConfirmed: false,
  });
  assert.notEqual(rejected.status, "applied");
  assert.match(rejected.reason, /исход ещё не объявлен/);
  assert.equal(getState().characterRolls?.records?.length ?? 0, 0);
  assert.equal(getState().combat.ki.current, before.combat.ki.current);

  const applied = recordAndAmendCharacterRoll(input, "ll-monk:indomitable-spirit", {
    timingConfirmed: true,
  });
  assert.equal(applied.status, "applied");
  assert.equal(applied.record.total, 12 + applied.record.totalModifier);
  assert.equal(applied.record.appliedAmendments.length, 1);
  assert.equal(getState().characterRolls.records.length, 1);
  assert.equal(getState().combat.ki.current, before.combat.ki.current - 1);
});

test("saving-throw consequences distinguish no damage, Evasion, and DM-final damage", () => {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const noDamageRoll = recordCharacterRoll({
    kind: "saving-throw", id: "dexterity", rollMode: "normal", firstD20: "14",
  }, { outcome: "success", askForDamage: true });
  assert.equal(noDamageRoll.status, "applied");
  const noDamage = resolveCharacterRollConsequence(
    noDamageRoll.record.id, "no-damage",
  );
  assert.equal(noDamage.status, "applied");
  assert.equal(noDamage.record.consequence.status, "resolved-none");

  const evasionRoll = recordCharacterRoll({
    kind: "saving-throw", id: "dexterity", rollMode: "normal", firstD20: "5",
  }, { outcome: "failure", askForDamage: true });
  assert.equal(evasionRoll.status, "applied");
  assert.equal(evasionRoll.record.featureSnapshot.evasionAvailable, true);
  const begin = resolveCharacterRollConsequence(evasionRoll.record.id, "has-damage");
  assert.equal(begin.status, "applied");
  updateState((draft) => {
    draft.combat.hp.temp = 2;
    return draft;
  });
  const beforeHp = getState().combat.hp.current;
  const applied = resolveCharacterRollConsequence(
    evasionRoll.record.id,
    "apply-to-character",
    { damage: "9", damageBasis: "full-effect", effectProfile: "save-half" },
  );
  assert.equal(applied.status, "applied");
  assert.equal(applied.record.consequence.finalDamage, 4);
  assert.equal(applied.record.consequence.evasionUsed, true);
  assert.equal(getState().combat.hp.current, beforeHp - 2);
  assert.equal(getState().combat.hp.temp, 0);
  const hpAfterFirstApplication = getState().combat.hp.current;
  const repeated = resolveCharacterRollConsequence(
    evasionRoll.record.id,
    "apply-to-character",
    { damage: "9", damageBasis: "full-effect", effectProfile: "save-half" },
  );
  assert.notEqual(repeated.status, "applied");
  assert.equal(getState().combat.hp.current, hpAfterFirstApplication);

  const failureOnlyRoll = recordCharacterRoll({
    kind: "saving-throw", id: "dexterity", rollMode: "normal", firstD20: "5",
  }, { outcome: "failure", askForDamage: true });
  resolveCharacterRollConsequence(failureOnlyRoll.record.id, "has-damage");
  const failureOnly = resolveCharacterRollConsequence(
    failureOnlyRoll.record.id,
    "tracked-elsewhere",
    { damage: "9", damageBasis: "full-effect", effectProfile: "failure-full" },
  );
  assert.equal(failureOnly.record.consequence.finalDamage, 9);
  assert.equal(failureOnly.record.consequence.evasionUsed, false);

  const dmFinalRoll = recordCharacterRoll({
    kind: "saving-throw", id: "dexterity", rollMode: "normal", firstD20: "20",
  }, { outcome: "success", askForDamage: true });
  resolveCharacterRollConsequence(dmFinalRoll.record.id, "has-damage");
  const dmFinal = resolveCharacterRollConsequence(
    dmFinalRoll.record.id,
    "tracked-elsewhere",
    { damage: "7", damageBasis: "dm-final" },
  );
  assert.equal(dmFinal.status, "applied");
  assert.equal(dmFinal.record.consequence.finalDamage, 7);
  assert.equal(dmFinal.record.consequence.evasionUsed, false);
});

test("unknown saving-throw outcome can be resumed and does not default to failure", () => {
  openCharacterSession("sara-velaris", () => ({ status: "missing" }));
  const created = recordCharacterRoll({
    kind: "saving-throw", id: "wisdom", rollMode: "normal", firstD20: "1",
  }, { askForDamage: true });
  assert.equal(created.status, "applied");
  assert.equal(created.record.manualOutcome, null);
  assert.equal(created.record.dcResult, null);
  assert.equal(created.record.consequence.status, "awaiting-outcome");
  const updated = correctCharacterRollOutcome(created.record.id, "success");
  assert.equal(updated.status, "applied");
  assert.equal(updated.record.manualOutcome, "success");
  assert.equal(updated.record.consequence.status, "awaiting-damage-decision");
});
