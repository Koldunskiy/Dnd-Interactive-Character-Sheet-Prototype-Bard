export const LEGACY_NOTE_ID = "__legacy_lore_notes__";

export function migrateLoreNotes(lore) {
  if (!lore || typeof lore !== "object" || Array.isArray(lore)) {
    return { lore, issue: "Раздел заметок повреждён; исходные данные сохранены." };
  }
  const next = { ...lore };
  const version = next.notesMigrationVersion;
  if (version === 1) {
    return { lore: next, issue: null };
  }

  if (next.notes !== undefined && next.notes !== null && typeof next.notes !== "string") {
    return { lore: next, issue: "Старые заметки имеют неподдерживаемый формат; данные сохранены." };
  }

  if (next.noteEntries !== undefined && !Array.isArray(next.noteEntries)) {
    return { lore: next, issue: "Коллекция заметок повреждена; исходные данные сохранены." };
  }

  const entries = Array.isArray(next.noteEntries) ? [...next.noteEntries] : [];
  if (entries.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
    return { lore: next, issue: "В коллекции есть повреждённая заметка; операции заблокированы." };
  }
  const ids = entries.map((entry) => entry.id);
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) {
    return { lore: next, issue: "У заметок отсутствуют или повторяются ID; исходные данные сохранены." };
  }
  if (entries.some((entry) =>
    typeof entry.title !== "string" || typeof entry.text !== "string",
  )) {
    return { lore: next, issue: "Формат одной из заметок не распознан; исходные данные сохранены." };
  }

  if (typeof next.notes === "string" && next.notes.trim()) {
    const legacyEntry = entries.find((entry) => entry.id === LEGACY_NOTE_ID);
    if (legacyEntry && legacyEntry.title !== "Прежние заметки") {
      return {
        lore: next,
        issue: "Зарезервированный ID прежних заметок уже занят; данные сохранены и импорт остановлен.",
      };
    }
    if (!legacyEntry) {
      entries.unshift({
        id: LEGACY_NOTE_ID,
        title: "Прежние заметки",
        text: next.notes,
      });
    }
  }

  next.noteEntries = entries;
  next.notesMigrationVersion = 1;
  return { lore: next, issue: null };
}

export function validateNoteEntries(entries) {
  if (!Array.isArray(entries)) return "Коллекция заметок повреждена; операции заблокированы.";
  const ids = entries.map((entry) => entry?.id);
  if (entries.some((entry) => !entry || typeof entry !== "object" ||
      typeof entry.id !== "string" || !entry.id ||
      typeof entry.title !== "string" || typeof entry.text !== "string") ||
      new Set(ids).size !== ids.length) {
    return "У заметок отсутствуют или повторяются ID; операции заблокированы.";
  }
  return null;
}

export function createNoteEntry(entries, note) {
  const issue = validateNoteEntries(entries);
  if (issue) return { entries, issue };
  if (!note || typeof note.id !== "string" || !note.id ||
      typeof note.title !== "string" || typeof note.text !== "string" ||
      entries.some((entry) => entry.id === note.id)) {
    return { entries, issue: "Не удалось создать заметку с корректным уникальным ID." };
  }
  return { entries: [{ ...note }, ...entries], issue: null };
}

export function updateNoteEntry(entries, noteId, field, value) {
  const issue = validateNoteEntries(entries);
  if (issue) return { entries, issue };
  if (!["title", "text"].includes(field) || typeof value !== "string") {
    return { entries, issue: "Некорректное поле заметки." };
  }
  let found = false;
  const updated = entries.map((entry) => {
    if (entry.id !== noteId) return entry;
    found = true;
    return { ...entry, [field]: value };
  });
  return found
    ? { entries: updated, issue: null }
    : { entries, issue: "Заметка не найдена." };
}

export function deleteNoteEntry(entries, noteId) {
  const issue = validateNoteEntries(entries);
  if (issue) return { entries, issue };
  return { entries: entries.filter((entry) => entry.id !== noteId), issue: null };
}
