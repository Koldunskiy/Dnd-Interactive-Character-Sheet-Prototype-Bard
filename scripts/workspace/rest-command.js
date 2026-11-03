export function buildRestHitDieCommandId(restId) {
  return `rest-hit-die:${restId}`;
}

export function buildRestReplacementCommandId(stage, restId) {
  if (!["offer", "edit"].includes(stage)) throw new Error("Invalid rest replacement stage");
  return `rest-replacement:${stage}:${restId}`;
}

export function parseRestCommandId(id) {
  if (typeof id !== "string") return null;
  const hitDiePrefix = "rest-hit-die:";
  if (id.startsWith(hitDiePrefix)) {
    const restId = id.slice(hitDiePrefix.length);
    return restId ? { stage: "hit-die", restId } : null;
  }
  const match = /^rest-replacement:(offer|edit):(.+)$/.exec(id);
  return match ? { stage: match[1], restId: match[2] } : null;
}
