import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CHARACTER_DESCRIPTORS } from "../../scripts/characters.js";

test("Sara shell keeps stable five-tab roots and a shared task dock", async () => {
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  const saraTabs = CHARACTER_DESCRIPTORS["sara-velaris"].tabs;
  assert.deepEqual(saraTabs, ["profile", "melee", "techniques", "inventory", "lore"]);
  assert.deepEqual(CHARACTER_DESCRIPTORS.aurelia.tabs, [
    "profile", "melee", "spells", "inventory", "lore", "spell-library",
  ]);
  for (const tab of saraTabs) {
    assert.equal(html.match(new RegExp(`data-tab="${tab}"`, "g"))?.length, 1);
    assert.equal(html.match(new RegExp(`data-panel="${tab}"`, "g"))?.length, 1);
  }
  assert.match(html, /id="saraHeaderResources"/);
  assert.match(html, /id="saraSaveStatus"/);
  assert.match(html, /id="saraProfileMediaSlot"/);
  assert.match(html, /<\/main>\s*<div class="sara-task-dock[^"]*"[^>]*data-sara-task-dock/);
  assert.ok(html.indexOf("styles/theme-surfaces.css") < html.indexOf("styles/sara-ui.css"));
});
