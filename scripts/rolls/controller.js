import { ABILITY_KEYS, ABILITY_LABELS_RU, SKILL_ID_META } from "../rules.js";
import {
  amendCharacterRoll,
  correctCharacterRollOutcome,
  recordCharacterRoll,
  resolveCharacterRollConsequence,
} from "./commands.js";
import { escapeHtml } from "../render/shared/spell-card.js";
import { isWorkspaceOpen } from "../workspace/controller.js";

let draft = {
  kind: "ability-check",
  id: "strength",
  rollMode: "normal",
  firstD20: "",
  secondD20: "",
  dc: "",
  incomingDamage: "",
  consequenceProfile: "none",
  spellSaveSource: false,
  advantageReason: "",
  disadvantageReason: "",
};
let latestResult = null;
let unsavedRecord = false;
let draftDirty = false;

function option(value, label, selected) {
  return `<option value="${value}"${selected ? " selected" : ""}>${label}</option>`;
}

function reasonRu(reason) {
  return ({
    "stale-session": "Сеанс персонажа изменился.",
    "stale-revision": "Состояние персонажа изменилось; повторите действие.",
    "duplicate-operation": "Эта операция уже выполнена.",
    "persistence-failed": "Сначала повторите сохранение.",
  })[reason] ?? reason ?? "Неизвестная ошибка.";
}

function renderResult() {
  const result = document.getElementById("characterRollResult");
  const amendments = document.getElementById("characterRollAmendments");
  if (!result) return;
  const breakdown = latestResult?.modifierSnapshot?.map((source) =>
    `${source.label} ${source.value >= 0 ? "+" : ""}${source.value}`).join(" · ");
  result.textContent = latestResult
    ? `${latestResult.label}: к20 ${latestResult.rawD20Rolls.join(" и ")}; выбран ${latestResult.chosenD20}; ` +
      `${breakdown ? `${breakdown}; ` : ""}${latestResult.totalModifier >= 0 ? "+" : ""}${latestResult.totalModifier} = ${latestResult.total}` +
      (latestResult.dc == null ? "" : ` против Сл ${latestResult.dc}: ${latestResult.dcResult ? "успех" : "провал"}`) +
      (latestResult.spellSaveSource ? "; спасбросок от заклинания" : "") +
      (latestResult.advantageReason ? `; преимущество: ${latestResult.advantageReason}` : "") +
      (latestResult.disadvantageReason ? `; помеха: ${latestResult.disadvantageReason}` : "") +
      (unsavedRecord ? " — не сохранено" : "")
    : "";
  result.dataset.state = latestResult ? "saved" : "empty";
  if (!amendments) return;
  amendments.replaceChildren();
  if (!latestResult) return;
  const options = [];
  if (latestResult.skillId === "persuasion") {
    options.push(["ll-monk:mantle-of-courtesy", "Применить «Мантию учтивости» · 1 ци"]);
  }
  if (latestResult.skillId === "athletics") {
    options.push(["ll-monk:indomitable-spirit", "Применить «Несокрушимый дух» · 1 ци"]);
  }
  for (const [techniqueId, label] of options) {
    if (latestResult.appliedAmendments?.some((entry) => entry.techniqueId === techniqueId)) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn--utility";
    button.textContent = label;
    button.disabled = unsavedRecord;
    button.addEventListener("click", () => {
      const amended = amendCharacterRoll(latestResult.id, techniqueId);
      const error = document.getElementById("characterRollError");
      if (amended.status !== "applied") {
        if (error) error.textContent = `Поправка не применена: ${reasonRu(amended.reason)}.`;
        return;
      }
      latestResult = amended.record;
      unsavedRecord = amended.persistence?.ok === false;
      renderResult();
    });
    amendments.append(button);
  }
  if (latestResult.kind === "saving-throw" && latestResult.consequence) {
    if (latestResult.consequence.status === "pending") {
      for (const [resolution, label] of [
        ["apply-to-character", "Применить последствие к хитам"],
        ["tracked-elsewhere", "Урон учтён вне приложения"],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn--utility";
        button.textContent = label;
        button.disabled = unsavedRecord;
        button.addEventListener("click", () => {
          const resolved = resolveCharacterRollConsequence(latestResult.id, resolution);
          const error = document.getElementById("characterRollError");
          if (resolved.status !== "applied") {
            if (error) error.textContent = `Последствие не применено: ${reasonRu(resolved.reason)}.`;
            return;
          }
          latestResult = resolved.record;
          unsavedRecord = resolved.persistence?.ok === false;
          renderResult();
        });
        amendments.append(button);
      }
    } else if (latestResult.consequence.status === "awaiting-outcome") {
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Результат спасброска");
      select.innerHTML = '<option value="">Уточнить исход</option><option value="success">Успех</option><option value="failure">Провал</option>';
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn--utility";
      button.textContent = "Записать исход";
      button.disabled = unsavedRecord;
      button.addEventListener("click", () => {
        const corrected = correctCharacterRollOutcome(latestResult.id, select.value);
        const error = document.getElementById("characterRollError");
        if (corrected.status !== "applied") {
          if (error) error.textContent = `Исход не записан: ${reasonRu(corrected.reason)}.`;
          return;
        }
        latestResult = corrected.record;
        unsavedRecord = corrected.persistence?.ok === false;
        renderResult();
      });
      amendments.append(select, button);
    } else if (["applied", "tracked-elsewhere"].includes(latestResult.consequence.status)) {
      const message = document.createElement("p");
      message.textContent = latestResult.consequence.status === "applied"
        ? `Последствие применено: ${latestResult.consequence.calculatedDamage} урона; ХП ${latestResult.consequence.hpBefore} → ${latestResult.consequence.hpAfter}, временные ХП ${latestResult.consequence.tempHpBefore} → ${latestResult.consequence.tempHpAfter}.`
        : "Последствие отмечено как учтённое вне приложения; ХП не изменены.";
      amendments.append(message);
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Исправленный результат спасброска");
      select.innerHTML = '<option value="">Исправить исход</option><option value="success">Успех</option><option value="failure">Провал</option>';
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn--utility";
      button.textContent = "Сохранить исправление";
      button.disabled = unsavedRecord;
      button.addEventListener("click", () => {
        const corrected = correctCharacterRollOutcome(latestResult.id, select.value);
        const error = document.getElementById("characterRollError");
        if (corrected.status !== "applied") {
          if (error) error.textContent = `Исход не исправлен: ${reasonRu(corrected.reason)}.`;
          return;
        }
        latestResult = corrected.record;
        unsavedRecord = corrected.persistence?.ok === false;
        renderResult();
        if (error) error.textContent =
          "Исход исправлен; ранее применённые хиты не пересчитаны.";
      });
      amendments.append(select, button);
    }
  }
}

function setDraftFromForm(form) {
  draft = {
    ...draft,
    kind: form.elements.kind.value,
    id: form.elements.id.value,
    rollMode: form.elements.rollMode.value,
    firstD20: form.elements.firstD20.value,
    secondD20: form.elements.secondD20.value,
    dc: form.elements.dc.value,
    incomingDamage: form.elements.incomingDamage.value,
    consequenceProfile: form.elements.consequenceProfile.value,
    spellSaveSource: form.elements.spellSaveSource.checked,
    advantageReason: form.elements.advantageReason.value,
    disadvantageReason: form.elements.disadvantageReason.value,
  };
}

function renderIdOptions() {
  return draft.kind === "saving-throw"
    ? ABILITY_KEYS.map((id) => option(id, ABILITY_LABELS_RU[id], id === draft.id)).join("")
    : [
        ...ABILITY_KEYS.map((id) => option(id, ABILITY_LABELS_RU[id], id === draft.id)),
        ...Object.entries(SKILL_ID_META).map(([id, meta]) => option(id, meta.label, id === draft.id)),
      ].join("");
}

export function renderCharacterRollPanel(character) {
  const root = document.getElementById("characterRollsRoot");
  if (!(root instanceof HTMLElement)) return;
  const enabled = character?.profile?.id === "sara-velaris";
  root.hidden = true;
  root.innerHTML = `
    <section class="character-roll-panel" role="dialog" aria-modal="true" aria-labelledby="characterRollTitle">
      <button class="character-roll-backdrop" type="button" data-roll-close aria-label="Закрыть панель броска"></button>
      <div class="character-roll-card">
        <div class="section-heading-row">
          <div><div class="eyebrow">Физические кости</div><h2 id="characterRollTitle">Проверка персонажа</h2></div>
          <button type="button" class="btn" data-roll-close>Закрыть</button>
        </div>
        ${enabled ? `
          <form id="characterRollForm">
            <label>Тип
              <select name="kind">
                ${option("ability-check", "Проверка характеристики или навыка", draft.kind === "ability-check")}
                ${option("saving-throw", "Спасбросок", draft.kind === "saving-throw")}
              </select>
            </label>
            <label>Бросок
              <select name="id">${renderIdOptions()}</select>
            </label>
            <label>Режим
              <select name="rollMode">
                ${option("normal", "Обычный", draft.rollMode === "normal")}
                ${option("advantage", "Преимущество", draft.rollMode === "advantage")}
                ${option("disadvantage", "Помеха", draft.rollMode === "disadvantage")}
              </select>
            </label>
            <div class="character-roll-dice">
              <label>Первый к20<input name="firstD20" type="number" min="1" max="20" inputmode="numeric" value="${escapeHtml(draft.firstD20)}"></label>
              <label>Второй к20<input name="secondD20" type="number" min="1" max="20" inputmode="numeric" value="${escapeHtml(draft.secondD20)}" ${draft.rollMode === "normal" ? "disabled" : ""}></label>
            </div>
            <label>Сложность (если известна)<input name="dc" type="number" min="1" max="99" inputmode="numeric" value="${escapeHtml(draft.dc)}"></label>
            <label>Входящий урон (если спасбросок определяет урон)<input name="incomingDamage" type="number" min="0" inputmode="numeric" value="${escapeHtml(draft.incomingDamage)}"></label>
            <label>Профиль последствия
              <select name="consequenceProfile">
                ${option("none", "Не применять урон", draft.consequenceProfile === "none")}
                ${option("failure-full", "Урон только при провале", draft.consequenceProfile === "failure-full")}
                ${option("save-half", "Половина при успехе", draft.consequenceProfile === "save-half")}
              </select>
            </label>
            <label class="character-roll-check"><input name="spellSaveSource" type="checkbox" ${draft.spellSaveSource ? "checked" : ""}> Спасбросок от заклинания (преимущество Юань-ти)</label>
            <label>Причина преимущества (если есть)<input name="advantageReason" value="${escapeHtml(draft.advantageReason)}"></label>
            <label>Причина помехи (если есть)<input name="disadvantageReason" value="${escapeHtml(draft.disadvantageReason)}"></label>
            <p class="hint">Фиксируйте источник каждого преимущества и помехи по решению ведущего. Бросок не тратит действие.</p>
            <p id="characterRollResult" class="character-roll-result" role="status"></p>
            <div id="characterRollAmendments" class="character-roll-actions"></div>
            <p id="characterRollError" class="character-roll-error" role="alert"></p>
            <div class="character-roll-actions">
              <button type="submit" class="btn btn--primary">Записать бросок</button>
              <button type="button" class="btn" data-roll-close>Закрыть</button>
            </div>
          </form>
        ` : `<p role="status">Для этого персонажа панель бросков ещё не подключена.</p>`}
      </div>
    </section>
  `;
  renderResult();
  bindRollPanel(root);
}

function bindRollPanel(root) {
  root.querySelectorAll("[data-roll-close]").forEach((button) => {
    button.addEventListener("click", closeCharacterRollPanel);
  });
  const form = root.querySelector("#characterRollForm");
  if (!form) return;
  form.addEventListener("input", () => {
    draftDirty = true;
    setDraftFromForm(form);
    const second = form.elements.secondD20;
    second.disabled = draft.rollMode === "normal";
  });
  form.addEventListener("change", () => {
    draftDirty = true;
    setDraftFromForm(form);
  });
  form.elements.kind.addEventListener("change", () => {
    draftDirty = true;
    setDraftFromForm(form);
    draft.id = "strength";
    if (draft.kind !== "saving-throw") {
      draft.spellSaveSource = false;
      form.elements.spellSaveSource.checked = false;
    }
    const id = form.elements.id;
    id.innerHTML = renderIdOptions();
    id.value = draft.id;
  });
  form.elements.spellSaveSource.addEventListener("change", () => {
    draftDirty = true;
    setDraftFromForm(form);
    if (draft.spellSaveSource) {
      form.elements.kind.value = "saving-throw";
      draft.kind = "saving-throw";
      draft.id = "strength";
      form.elements.id.innerHTML = renderIdOptions();
      form.elements.id.value = "strength";
      form.elements.rollMode.value = "advantage";
      draft.rollMode = "advantage";
      form.elements.secondD20.disabled = false;
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    setDraftFromForm(form);
    if (unsavedRecord) {
      const error = root.querySelector("#characterRollError");
      if (error) error.textContent = "Сначала повторите сохранение уже применённого броска.";
      return;
    }
    const result = recordCharacterRoll(draft);
    const error = root.querySelector("#characterRollError");
    if (result.status !== "applied") {
      if (error) error.textContent = `Бросок не записан: ${reasonRu(result.reason)}.`;
      return;
    }
    latestResult = result.record;
    unsavedRecord = result.persistence?.ok === false;
    renderResult();
    if (error) error.textContent = result.persistence?.ok === false
      ? "Результат применён в памяти, но не сохранён. Повторите сохранение перед переключением."
      : "";
    draft.firstD20 = "";
    draft.secondD20 = "";
    draftDirty = false;
    form.elements.firstD20.value = "";
    form.elements.secondD20.value = "";
  });
}

export function openCharacterRollPanel(kind = "ability-check", id = "strength") {
  if (isWorkspaceOpen()) return false;
  const root = document.getElementById("characterRollsRoot");
  if (!(root instanceof HTMLElement)) return;
  if (!hasChangedCharacterRollDraft()) {
    if (draft.kind !== kind || draft.id !== id) latestResult = null;
    draft = { ...draft, kind, id };
  }
  root.hidden = false;
  renderCharacterRollPanel({ profile: { id: "sara-velaris" } });
  root.hidden = false;
  root.querySelector('input[name="firstD20"]')?.focus();
}

export function closeCharacterRollPanel() {
  const root = document.getElementById("characterRollsRoot");
  if (root) root.hidden = true;
}

export function hasChangedCharacterRollDraft() {
  return draftDirty || Boolean(draft.firstD20 || draft.secondD20 || draft.dc ||
    draft.advantageReason || draft.disadvantageReason);
}

export function hasUnsavedCharacterRoll() {
  return unsavedRecord;
}

export function clearCharacterRollDraft() {
  draft = {
    kind: "ability-check",
    id: "strength",
    rollMode: "normal",
    firstD20: "",
    secondD20: "",
    dc: "",
    incomingDamage: "",
    consequenceProfile: "none",
    spellSaveSource: false,
    advantageReason: "",
    disadvantageReason: "",
  };
  latestResult = null;
  unsavedRecord = false;
  draftDirty = false;
  closeCharacterRollPanel();
}

export function markCharacterRollSaved() {
  unsavedRecord = false;
  renderResult();
}

export function bindCharacterRollEntryPoints(root = document) {
  root.querySelectorAll("[data-open-character-roll]").forEach((button) => {
    if (button.dataset.rollBound === "true") return;
    button.addEventListener("click", () => openCharacterRollPanel(
      button.dataset.rollKind ?? "ability-check",
      button.dataset.rollId ?? "strength",
    ));
    button.dataset.rollBound = "true";
  });
  root.querySelectorAll("[data-open-character-roll-panel]").forEach((button) => {
    if (button.dataset.rollBound === "true") return;
    button.addEventListener("click", () => openCharacterRollPanel());
    button.dataset.rollBound = "true";
  });
}
