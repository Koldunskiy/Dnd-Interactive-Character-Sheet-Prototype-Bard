import { getState, updateState } from "../state.js";
import { validateNoteEntries } from "../lore-notes.js";

const expandedNoteIds = new Set();
const noteStatus = new Map();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInfoCard(key, title, text, fallback = "—") {
  return `
    <details class="info-card profile-responsive-disclosure" data-profile-disclosure="lore-${escapeHtml(key)}" open>
      <summary class="info-card-title">${escapeHtml(title)}</summary>
      <div class="info-card-text">${escapeHtml(text || fallback)}</div>
    </details>
  `;
}

function createNoteCard(note) {
  const card = document.createElement("article");
  card.className = "lore-note-card";
  card.dataset.noteId = note.id;

  const heading = document.createElement("div");
  heading.className = "lore-note-heading";
  const title = document.createElement("h3");
  title.className = "lore-note-title";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "btn btn--utility";
  toggle.dataset.noteToggle = "";
  toggle.setAttribute("aria-expanded", "false");
  toggle.textContent = "Открыть";
  heading.append(title, toggle);

  const preview = document.createElement("p");
  preview.className = "lore-note-preview";
  const editor = document.createElement("div");
  editor.className = "lore-note-editor";
  editor.hidden = true;

  const titleLabel = document.createElement("label");
  titleLabel.className = "field-label";
  titleLabel.append(document.createTextNode("Название"));
  const titleInput = document.createElement("input");
  titleInput.className = "input";
  titleInput.type = "text";
  titleInput.dataset.noteField = "title";
  titleInput.dataset.noteId = note.id;
  titleLabel.append(titleInput);

  const textLabel = document.createElement("label");
  textLabel.className = "field-label";
  textLabel.append(document.createTextNode("Текст"));
  const textInput = document.createElement("textarea");
  textInput.className = "input lore-note-text";
  textInput.rows = 7;
  textInput.dataset.noteField = "text";
  textInput.dataset.noteId = note.id;
  textLabel.append(textInput);

  const status = document.createElement("p");
  status.className = "lore-note-status";
  status.setAttribute("aria-live", "polite");
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "btn btn--utility";
  deleteButton.dataset.noteDelete = "";
  deleteButton.textContent = "Удалить";
  const collapse = document.createElement("button");
  collapse.type = "button";
  collapse.className = "btn btn--utility";
  collapse.dataset.noteCollapse = "";
  collapse.textContent = "Свернуть";

  const actions = document.createElement("div");
  actions.className = "lore-note-actions";
  actions.append(status, deleteButton, collapse);
  editor.append(titleLabel, textLabel, actions);
  card.append(heading, preview, editor);
  return card;
}

function updateNoteCard(card, note) {
  const isExpanded = expandedNoteIds.has(note.id);
  card.querySelector(".lore-note-title").textContent = note.title.trim() || "Без названия";
  const preview = note.text.replace(/\s+/g, " ").trim();
  card.querySelector(".lore-note-preview").textContent =
    preview.length > 180 ? `${preview.slice(0, 180)}…` : preview || "Нет текста.";
  const toggle = card.querySelector("[data-note-toggle]");
  toggle.textContent = isExpanded ? "Свернуть" : "Открыть";
  toggle.setAttribute("aria-expanded", String(isExpanded));
  card.querySelector(".lore-note-editor").hidden = !isExpanded;

  for (const [field, value] of [["title", note.title], ["text", note.text]]) {
    const input = card.querySelector(`[data-note-field="${field}"]`);
    if (input.dataset.composing !== "true" && document.activeElement !== input && input.value !== value) {
      input.value = value;
    }
  }
  const status = card.querySelector(".lore-note-status");
  status.textContent = noteStatus.get(note.id) ?? "Изменения сохраняются автоматически.";
}

function renderNoteCards(root, lore) {
  const issue = lore.notesMigrationIssue || validateNoteEntries(lore.noteEntries);
  const issueNode = root.querySelector(".lore-notes-issue");
  let emptyNode = root.querySelector(".lore-notes-empty");
  if (!emptyNode) {
    emptyNode = document.createElement("p");
    emptyNode.className = "lore-notes-empty";
    emptyNode.setAttribute("role", "status");
    emptyNode.textContent = "Заметок пока нет";
    root.insertBefore(emptyNode, root.querySelector(".lore-note-cards"));
  }
  issueNode.textContent = issue ?? "";
  issueNode.hidden = !issue;
  root.querySelector("[data-note-add]").disabled = Boolean(issue);
  const entries = Array.isArray(lore.noteEntries) ? lore.noteEntries : [];
  emptyNode.hidden = Boolean(issue) || entries.length > 0;
  const cardsRoot = root.querySelector(".lore-note-cards");
  const valid = !issue;
  if (!valid) return;

  const wantedIds = new Set(valid ? entries.map((entry) => entry.id) : []);
  for (const card of cardsRoot.querySelectorAll("[data-note-id]")) {
    if (!wantedIds.has(card.dataset.noteId)) card.remove();
  }

  entries.forEach((note, index) => {
    let card = [...cardsRoot.children].find((entry) => entry.dataset.noteId === note.id);
    if (!card) {
      card = createNoteCard(note);
      cardsRoot.insertBefore(card, cardsRoot.children[index] ?? null);
    } else if (cardsRoot.children[index] !== card) {
      cardsRoot.insertBefore(card, cardsRoot.children[index] ?? null);
    }
    updateNoteCard(card, note);
  });
  for (const id of [...expandedNoteIds]) {
    if (!wantedIds.has(id)) expandedNoteIds.delete(id);
  }
}

export function updateLoreNoteEditView(metadata) {
  if (metadata?.kind !== "lore-note-edit") return;
  const root = document.querySelector("#loreNotesRoot");
  const card = [...(root?.querySelectorAll("[data-note-id]") ?? [])]
    .find((entry) => entry.dataset.noteId === metadata.noteId);
  if (!card) return;
  const state = getState();
  const note = state.lore?.noteEntries?.find((entry) => entry.id === metadata.noteId);
  if (!note) return;
  card.querySelector(".lore-note-title").textContent = note.title.trim() || "Без названия";
  const preview = note.text.replace(/\s+/g, " ").trim();
  card.querySelector(".lore-note-preview").textContent =
    preview.length > 180 ? `${preview.slice(0, 180)}…` : preview || "Нет текста.";
  const saved = metadata.persistenceResult?.ok;
  noteStatus.set(metadata.noteId, saved ? "Сохранено" : "Не удалось сохранить на устройстве");
  card.querySelector(".lore-note-status").textContent = noteStatus.get(metadata.noteId);
}

function renderLoreNotes(lore, root = null) {
  if (!root) {
    root = document.createElement("section");
    root.id = "loreNotesRoot";
    root.className = "lore-notes";
    root.innerHTML = `
      <div class="section-heading-row">
        <h2 class="section-title">Заметки</h2>
        <button type="button" class="btn btn--utility" data-note-add>+ Добавить</button>
      </div>
      <p class="lore-notes-issue" role="status" hidden></p>
      <p class="lore-notes-empty" role="status">Заметок пока нет</p>
      <div class="lore-note-cards"></div>
    `;
  }
  renderNoteCards(root, lore);
  return root;
}

export function renderLorePanel(state) {
  const lorePanel = document.getElementById("lorePanel");
  if (!lorePanel) return;
  const lore = state.lore ?? {};
  const disclosureState = new Map(
    [...lorePanel.querySelectorAll("#loreCardsRoot details[data-profile-disclosure]")]
      .map((details) => [details.dataset.profileDisclosure, details.open]),
  );
  const compact = window.matchMedia("(max-width: 899px)").matches;
  let cardsRoot = lorePanel.querySelector("#loreCardsRoot");
  let notesRoot = lorePanel.querySelector("#loreNotesRoot");
  let mount = lorePanel.querySelector("#loreNotesMount");
  let heading = [...lorePanel.children].find(
    (child) => child.tagName === "H2" && child.textContent.trim() === "Лор",
  );

  if (!heading) {
    heading = document.createElement("h2");
    heading.textContent = "Лор";
  }
  if (!cardsRoot) {
    cardsRoot = document.createElement("div");
    cardsRoot.id = "loreCardsRoot";
    cardsRoot.className = "cards-grid";
  }
  if (!mount) {
    mount = document.createElement("div");
    mount.id = "loreNotesMount";
  }

  if (heading.parentElement !== lorePanel || lorePanel.firstChild !== heading) {
    lorePanel.insertBefore(heading, lorePanel.firstChild);
  }
  if (cardsRoot.parentElement !== lorePanel) lorePanel.append(cardsRoot);
  if (mount.parentElement !== lorePanel) lorePanel.append(mount);
  lorePanel.insertBefore(mount, cardsRoot);

  cardsRoot.innerHTML = [
    renderInfoCard("appearance", "Внешний вид", lore.appearance),
    renderInfoCard("order", "Орден", lore.order),
    renderInfoCard("motivation", "Цель", lore.motivation),
    renderInfoCard("personality", "Характер", lore.personality),
    lore.racePerspective ? renderInfoCard("race-perspective", "Расовая перспектива", lore.racePerspective) : "",
    lore.performerIdentity ? renderInfoCard("performer-identity", "Сценический образ", lore.performerIdentity) : "",
    lore.trauma ? renderInfoCard("trauma", "Травма", lore.trauma) : "",
    lore.gmTriggers ? renderInfoCard("gm-triggers", "Триггеры для мастера", lore.gmTriggers) : "",
  ].join("");
  cardsRoot.querySelectorAll("details[data-profile-disclosure]").forEach((details) => {
    const key = details.dataset.profileDisclosure;
    details.open = disclosureState.has(key) ? disclosureState.get(key) : !compact;
  });

  notesRoot = renderLoreNotes(lore, notesRoot);
  if (notesRoot.parentElement !== mount) mount.append(notesRoot);
}

export function setLoreNoteExpanded(noteId, expanded) {
  if (expanded) expandedNoteIds.add(noteId);
  else expandedNoteIds.delete(noteId);
}

export function clearLoreNoteStatus(noteId) {
  noteStatus.delete(noteId);
}
