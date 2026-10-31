export function parsePhysicalInteger(raw, minimum, maximum, field = "Результат") {
  if ((typeof raw !== "string" && typeof raw !== "number") ||
      (typeof raw === "string" && raw.trim() === "")) {
    return { ok: false, reason: `${field}: введите физический результат.` };
  }
  const value = typeof raw === "number" ? raw : Number(raw.trim());
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { ok: false, reason: `${field}: требуется конечное целое число.` };
  }
  if (value < minimum || value > maximum) {
    return { ok: false, reason: `${field}: допустимый диапазон ${minimum}–${maximum}.` };
  }
  return { ok: true, value };
}
