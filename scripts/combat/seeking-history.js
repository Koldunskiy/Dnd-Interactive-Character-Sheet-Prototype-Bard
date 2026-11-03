function conflict(message) {
  const error = new Error(`Seeking history conflict: ${message}`);
  error.code = "seeking-history-conflict";
  throw error;
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validId(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function sameSeekingData(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every((value, index) => sameSeekingData(value, b[index]));
  }
  if (!record(a) || !record(b)) return false;
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  return ak.length === bk.length &&
    ak.every((key, index) => key === bk[index] &&
      sameSeekingData(a[key], b[key]));
}

function normalize(entry, parent) {
  if (!record(entry) || !validId(entry.paidOperationId)) {
    conflict("missing paidOperationId");
  }
  if (entry.id != null && entry.id !== entry.paidOperationId) {
    conflict("entry ID mismatch");
  }
  if (!["awaiting-replacement", "resolved"].includes(entry.status) ||
      !record(entry.original) || entry.kiPaid !== 1) {
    conflict("invalid invocation evidence");
  }
  if (entry.parent != null &&
      (!record(entry.parent) || entry.parent.actionId !== parent.actionId ||
       entry.parent.attackId !== parent.attackId)) {
    conflict("parent mismatch");
  }
  const copy = structuredClone(entry);
  copy.id = copy.paidOperationId;
  copy.parent = { ...parent };
  return copy;
}

function replacementMatches(attack, entry) {
  const replacement = entry.replacement;
  return entry.status === "resolved" &&
    validId(entry.resolutionOperationId) && record(replacement) &&
    Array.isArray(replacement.rawD20Rolls) &&
    sameSeekingData(attack.rawD20Rolls, replacement.rawD20Rolls) &&
    attack.chosenD20 === replacement.chosenD20 &&
    attack.attackTotal === replacement.attackTotal &&
    attack.hitResult === replacement.hitResult &&
    attack.critical === replacement.critical &&
    (replacement.rollMode == null || attack.rollMode === replacement.rollMode) &&
    (replacement.attackBonusSnapshot == null ||
      attack.attackBonusSnapshot === replacement.attackBonusSnapshot);
}

export function readSeekingHistory(attack, parent) {
  if (!record(attack) || !validId(parent?.actionId) ||
      !validId(parent?.attackId) || attack.id !== parent.attackId) {
    conflict("invalid enclosing parent");
  }
  const hasArray = attack.seekingAmendments !== undefined;
  if (hasArray && !Array.isArray(attack.seekingAmendments)) {
    conflict("history is not an array");
  }
  const shadow = attack.seekingAmendment == null
    ? null : normalize(attack.seekingAmendment, parent);
  const history = (hasArray ? attack.seekingAmendments : shadow ? [shadow] : [])
    .map((entry) => normalize(entry, parent));
  const ids = new Set();
  for (const entry of history) {
    if (ids.has(entry.id)) conflict("duplicate invocation ID");
    ids.add(entry.id);
  }
  if (hasArray && shadow) {
    const index = history.findIndex((entry) => entry.id === shadow.id);
    if (index < 0) conflict("compatibility pointer is not in history");
    const entry = history[index];
    if (!sameSeekingData(entry.original, shadow.original) ||
        entry.kiPaid !== shadow.kiPaid) conflict("immutable evidence differs");
    if (entry.status === "awaiting-replacement" && shadow.status === "resolved") {
      if (index !== history.length - 1 || !replacementMatches(attack, shadow)) {
        conflict("cannot prove legacy resolved-pointer repair");
      }
      history[index] = {
        ...entry,
        status: "resolved",
        replacement: structuredClone(shadow.replacement),
        resolutionOperationId: shadow.resolutionOperationId,
        ...(shadow.resolutionRequest === undefined ? {} :
          { resolutionRequest: structuredClone(shadow.resolutionRequest) }),
      };
    } else if (entry.status === "resolved" && shadow.status === "awaiting-replacement") {
      if (!replacementMatches(attack, entry)) {
        conflict("cannot prove authoritative resolved result");
      }
    } else if (entry.status === "resolved" &&
        !sameSeekingData(entry.replacement, shadow.replacement)) {
      conflict("resolved outcomes differ");
    }
  }
  const pending = history.filter((entry) => entry.status === "awaiting-replacement");
  if (pending.length > 1 || (pending.length === 1 &&
      history.at(-1)?.id !== pending[0].id)) {
    conflict("invalid pending invocation order");
  }
  return history;
}

export function writeSeekingHistory(attack, entries, parent) {
  const normalized = readSeekingHistory({
    ...attack,
    seekingAmendments: structuredClone(entries),
    seekingAmendment: null,
  }, parent);
  attack.seekingAmendments = normalized;
  attack.seekingAmendment = normalized.length
    ? structuredClone(normalized.at(-1)) : null;
  return normalized;
}

export function pendingSeeking(history) {
  return history.find((entry) => entry.status === "awaiting-replacement") ?? null;
}
