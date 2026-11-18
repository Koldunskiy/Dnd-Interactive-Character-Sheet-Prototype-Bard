import test from "node:test";
import assert from "node:assert/strict";
import { sara } from "../../data/sara.js";
import {
  captureMovingItemStates,
  renderInventoryMarkup,
  restoreMovingItemStates,
  updateInventorySearchVisibility,
} from "../../scripts/render/render-inventory.js";

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
  assert.match(markup, /Настроено: 1/);
  assert.match(markup, /Кошелёк: <strong>Не заполнено<\/strong>/);
  assert.doesNotMatch(markup, /Кошелёк: <strong>0 зм · 0 см/);
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

  const moved = structuredClone(state);
  moved.inventory.items[1].equipped = true;
  const movedMarkup = renderInventoryMarkup(moved);
  assert.equal((movedMarkup.match(/<article\b[^>]*data-item-id="attuned-only"/g) ?? []).length, 1);
  assert.ok(movedMarkup.indexOf('data-item-id="attuned-only"') <
    movedMarkup.indexOf('data-sara-key="inventory-other"'));

  state.inventory.items[3].quantity = 0;
  const zeroPotionMarkup = renderInventoryMarkup(state);
  const zeroPotionIndex = zeroPotionMarkup.indexOf('data-item-id="healing-potion"');
  const zeroPotionStart = zeroPotionMarkup.lastIndexOf('<article class="inventory-item-card', zeroPotionIndex);
  const zeroPotionEnd = zeroPotionMarkup.indexOf("</article>", zeroPotionStart);
  assert.doesNotMatch(zeroPotionMarkup.slice(zeroPotionStart, zeroPotionEnd), /data-action="open-potion-use"/);
});

test("Sara inventory leaves absent type and rarity unknown and renders empty state", () => {
  const seededMarkup = renderInventoryMarkup(structuredClone(sara));
  assert.match(seededMarkup, /Тип: Разное/);
  assert.match(seededMarkup, /Редкость: Необычный/);
  assert.match(seededMarkup, /Эффективное Телосложение равно 19/);
  assert.match(seededMarkup, /При ношении даёт \+1 к броскам попадания и урона/);

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

test("Sara inventory search filters both equipment groups and reapplies after render", () => {
  const equippedCard = { textContent: "Амулет здоровья", hidden: false };
  const otherCard = { textContent: "Зелье исцеления", hidden: false };
  const groups = [
    { hidden: false, querySelectorAll: () => [equippedCard] },
    { hidden: false, querySelectorAll: () => [otherCard] },
  ];
  const input = { value: "зелье" };
  const empty = { hidden: false };
  const panel = {
    querySelector(selector) {
      if (selector === "[data-sara-inventory-search]") return input;
      if (selector === "[data-inventory-search-empty]") return empty;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".inventory-item-card") return [equippedCard, otherCard];
      if (selector === ".inventory-item-group") return groups;
      return [];
    },
  };

  updateInventorySearchVisibility(panel);
  assert.equal(equippedCard.hidden, true);
  assert.equal(otherCard.hidden, false);
  assert.deepEqual(groups.map((group) => group.hidden), [true, false]);
  assert.equal(empty.hidden, true);

  updateInventorySearchVisibility(panel);
  assert.equal(otherCard.hidden, false);
  assert.equal(groups[1].hidden, false);
});

test("moving an edited inventory card between groups preserves input, disclosure, conflict and focus", () => {
  const document = {
    activeElement: null,
    createElement() {
      return {
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
      };
    },
  };
  class Field {
    constructor(tagName, type, value, attributes = {}) {
      this.tagName = tagName;
      this.type = type;
      this.value = value;
      this.checked = false;
      this.attributes = { ...attributes };
      this.dataset = {
        saraDirty: this.attributes["data-sara-dirty"],
        saraConflict: this.attributes["data-sara-conflict"],
      };
      this.selectionStart = 2;
      this.selectionEnd = value.length;
      this.selectionDirection = "forward";
      this.ownerDocument = document;
      this.label = {
        conflict: null,
        querySelector: () => this.label.conflict,
        append(node) { this.conflict = node; },
      };
    }
    matches(selector) {
      if (selector === "input, textarea, select") return true;
      if (selector === 'input[type="checkbox"], input[type="radio"]') {
        return this.tagName === "INPUT" && ["checkbox", "radio"].includes(this.type);
      }
      return false;
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === "data-sara-dirty") this.dataset.saraDirty = String(value);
      if (name === "data-sara-conflict") this.dataset.saraConflict = String(value);
    }
    removeAttribute(name) {
      delete this.attributes[name];
      if (name === "data-sara-dirty") delete this.dataset.saraDirty;
      if (name === "data-sara-conflict") delete this.dataset.saraConflict;
    }
    closest(selector) { return selector === "label" ? this.label : null; }
    focus() { document.activeElement = this; }
    setSelectionRange(start, end, direction) {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    }
  }
  const makeCard = (group, fields, details) => ({
    getAttribute: (name) => name === "data-item-id" ? "item-a" : null,
    closest: (selector) => selector === ".inventory-item-group" ? group : null,
    querySelectorAll(selector) {
      if (selector === "input, textarea, select, button") return fields;
      if (selector === "details") return details;
      return [];
    },
  });
  const oldNotes = new Field("TEXTAREA", "textarea", "unsaved note", {
    "data-bind-item-field": "notes",
    "data-sara-dirty": "true",
    "data-sara-edit-start": "saved note",
    "data-sara-conflict": "true",
    "aria-invalid": "true",
  });
  const oldDetails = { open: true };
  const oldToggle = new Field("INPUT", "checkbox", "", {
    "data-action": "inventory-toggle-equipped",
  });
  const oldCard = makeCard({ getAttribute: () => "inventory-equipped" }, [oldToggle, oldNotes], [oldDetails]);
  const panel = {
    ownerDocument: document,
    cards: [oldCard],
    querySelectorAll: () => panel.cards,
  };
  document.activeElement = oldNotes;
  oldToggle.checked = true;
  const snapshots = captureMovingItemStates(panel, [{ id: "item-a", type: "misc", equipped: false }]);
  assert.equal(snapshots.length, 1);

  const newNotes = new Field("TEXTAREA", "textarea", "saved note", {
    "data-bind-item-field": "notes",
  });
  const newDetails = { open: false };
  panel.cards = [makeCard(
    { getAttribute: () => "inventory-other" },
    [newNotes],
    [newDetails],
  )];
  document.activeElement = {};
  restoreMovingItemStates(panel, snapshots);

  assert.equal(newNotes.value, "unsaved note");
  assert.equal(newNotes.dataset.saraDirty, "true");
  assert.equal(newNotes.dataset.saraConflict, "true");
  assert.equal(newNotes.getAttribute("data-sara-edit-start"), "saved note");
  assert.equal(newNotes.selectionStart, 2);
  assert.equal(newNotes.selectionEnd, "unsaved note".length);
  assert.equal(newDetails.open, true);
  assert.equal(document.activeElement, newNotes);
  assert.equal(newNotes.label.conflict.textContent,
    "Значение изменилось в другом обновлении; ваш ввод сохранён.");

  const oldOtherNotes = new Field("TEXTAREA", "textarea", "other note", {
    "data-bind-item-field": "notes",
  });
  const otherCard = makeCard(
    { getAttribute: () => "inventory-other" },
    [oldOtherNotes],
    [{ open: false }],
  );
  panel.cards = [otherCard];
  document.activeElement = oldOtherNotes;
  const appearingToggleSnapshots = captureMovingItemStates(panel, [{ id: "item-a", type: "misc", equipped: true }]);
  const newToggle = new Field("INPUT", "checkbox", "", {
    "data-action": "inventory-toggle-equipped",
  });
  const equippedNotes = new Field("TEXTAREA", "textarea", "other note", {
    "data-bind-item-field": "notes",
  });
  panel.cards = [makeCard(
    { getAttribute: () => "inventory-equipped" },
    [newToggle, equippedNotes],
    [{ open: false }],
  )];
  document.activeElement = {};
  restoreMovingItemStates(panel, appearingToggleSnapshots);
  assert.equal(document.activeElement, equippedNotes);
  assert.notEqual(document.activeElement, newToggle);

  const oldAction = new Field("BUTTON", "button", "", {
    "data-action": "inventory-toggle-expand",
  });
  const actionCard = makeCard(
    { getAttribute: () => "inventory-equipped" },
    [oldAction],
    [{ open: true }],
  );
  panel.cards = [actionCard];
  document.activeElement = oldAction;
  const disappearingActionSnapshots = captureMovingItemStates(panel, [{ id: "item-a", equipped: false }]);
  const removeAction = new Field("BUTTON", "button", "", {
    "data-action": "inventory-remove-item",
  });
  panel.cards = [makeCard(
    { getAttribute: () => "inventory-other" },
    [removeAction],
    [{ open: true }],
  )];
  document.activeElement = {};
  restoreMovingItemStates(panel, disappearingActionSnapshots);
  assert.notEqual(document.activeElement, removeAction);
  assert.equal(removeAction.focused, undefined);
});
