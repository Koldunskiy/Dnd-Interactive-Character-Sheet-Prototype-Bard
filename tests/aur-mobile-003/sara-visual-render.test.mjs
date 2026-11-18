import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import { renderInventoryMarkup } from "../../scripts/render/render-inventory.js";

test("Sara inventory projection groups equipped items without conflating attunement or duplicating actions", () => {
  const state = structuredClone(sara);
  state.inventory.items = [
    { id: "equipped-first", name: "Первый клинок", type: "weapon", equipped: true, attuned: false, quantity: 1 },
    { id: "attuned-only", name: "Настроенный фокус", attuned: true, equipped: false, quantity: 0 },
    { id: "equipped-last", name: "Последняя броня", type: "armor", equipped: true, quantity: 1 },
    {
      id: "healing-potion",
      name: "Зелье исцеления",
      type: "consumable",
      equipped: false,
      quantity: 1,
      consumable: { kind: "healing-potion", potionId: "healing-potion" },
    },
    { id: "long-name", name: "Имя предмета с достаточно длинным описательным названием", quantity: 0 },
  ];
  state.inventory.currencyStatus = "Не заполнено";
  state.inventory.currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  const before = structuredClone(state);
  const markup = renderInventoryMarkup(state);

  const equippedStart = markup.indexOf('data-sara-key="inventory-equipped"');
  const otherStart = markup.indexOf('data-sara-key="inventory-other"');
  assert.ok(equippedStart >= 0 && otherStart > equippedStart);
  assert.ok(markup.indexOf('data-item-id="equipped-first"', equippedStart) <
    markup.indexOf('data-item-id="equipped-last"', equippedStart));
  assert.ok(markup.indexOf('data-item-id="attuned-only"', otherStart) >= otherStart);
  assert.ok(markup.indexOf('data-item-id="healing-potion"', otherStart) >= otherStart);
  assert.match(markup, /Настроено: 1 · Не заполнено/);
  assert.doesNotMatch(markup, /Настроено: 1 · 0 зм · 0 см/);
  assert.match(markup, /Количество: 0/);
  assert.match(markup, /Имя предмета с достаточно длинным описательным названием/);
  assert.match(markup, /class="inventory-item-icon"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(markup, /<img\b/);

  const potionIndex = markup.indexOf('data-item-id="healing-potion"');
  const potionStart = markup.lastIndexOf('<article class="inventory-item-card', potionIndex);
  const potionEnd = markup.indexOf("</article>", potionStart);
  const potionCard = markup.slice(potionStart, potionEnd);
  assert.equal((potionCard.match(/data-action="open-potion-use"/g) ?? []).length, 1);
  assert.match(markup, /data-command-id="potion-use:healing-potion:healing-potion"/);
  assert.deepEqual(state, before);

  state.inventory.items[3].quantity = 0;
  const zeroPotionMarkup = renderInventoryMarkup(state);
  const zeroPotionIndex = zeroPotionMarkup.indexOf('data-item-id="healing-potion"');
  const zeroPotionStart = zeroPotionMarkup.lastIndexOf('<article class="inventory-item-card', zeroPotionIndex);
  const zeroPotionEnd = zeroPotionMarkup.indexOf("</article>", zeroPotionStart);
  assert.doesNotMatch(zeroPotionMarkup.slice(zeroPotionStart, zeroPotionEnd), /data-action="open-potion-use"/);
});

test("Sara inventory leaves absent type and rarity unknown and renders empty state", () => {
  const state = structuredClone(sara);
  state.inventory.items = [{ id: "untyped", name: "Без категории", quantity: 0 }];
  const markup = renderInventoryMarkup(state);
  assert.match(markup, /Без категории/);
  assert.doesNotMatch(markup, /Тип<\/span>.*misc/s);
  assert.doesNotMatch(markup, /Редкость/);

  state.inventory.items = [];
  assert.match(renderInventoryMarkup(state), /Пока ничего не добавлено/);
  assert.deepEqual(state.inventory.items, []);
});
