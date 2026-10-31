import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import { renderTechniquesPanel } from "../../scripts/render/render-techniques.js";

test("technique catalogue no longer renders replaced battle forms or missile return controls", () => {
  const panel = {
    innerHTML: "",
    dataset: {},
    addEventListener() {},
    querySelectorAll() { return []; },
    replaceChildren() {},
  };
  const priorDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) { return id === "techniquesPanel" ? panel : null; },
  };

  try {
    renderTechniquesPanel(structuredClone(sara));
    assert.match(panel.innerHTML, /Техники монаха/);
    assert.doesNotMatch(panel.innerHTML, /data-technique-form="ll-monk:(?:step-of-the-wind|patient-defense|mystic-regeneration|deflect-strike|deflect-missile|empowered-strike|stunning-strike|crippling-strike|slowing-strike)"/);
    assert.doesNotMatch(panel.innerHTML, /data-(?:missile-return|sara-attack-submit|sara-damage-submit|racial-spell-form|battle-technique-form)=/);
  } finally {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
  }
});
