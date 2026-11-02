function nodeKey(node) {
  if (node.nodeType !== 1) return null;
  for (const name of ["data-sara-key", "data-note-id", "data-item-id", "data-technique-id"]) {
    const value = node.getAttribute(name);
    if (value) return `${name}:${value}`;
  }
  return node.id ? `id:${node.id}` : null;
}

function isSameNodeKind(current, next) {
  return current.nodeType === next.nodeType &&
    (current.nodeType !== 1 || current.tagName === next.tagName);
}

function syncAttributes(current, next, preserveValue) {
  const nextNames = new Set([...next.attributes].map((attribute) => attribute.name));
  for (const attribute of [...current.attributes]) {
    if (!nextNames.has(attribute.name) &&
        !(current.tagName === "DETAILS" && attribute.name === "open") &&
        !(preserveValue && ["data-sara-dirty", "data-sara-edit-start", "data-sara-conflict"].includes(attribute.name))) {
      current.removeAttribute(attribute.name);
    }
  }
  for (const attribute of [...next.attributes]) {
    if (preserveValue && ["value", "checked", "selected"].includes(attribute.name)) continue;
    if (current.tagName === "DETAILS" && attribute.name === "open") continue;
    if (current.getAttribute(attribute.name) !== attribute.value) {
      current.setAttribute(attribute.name, attribute.value);
    }
  }
}

function markFieldConflict(current, next) {
  const field = current.matches?.("input, textarea, select") ? current : null;
  if (!field) return;
  const oldValue = field.dataset.saraEditStart ?? (field.type === "checkbox"
    ? String(field.hasAttribute("checked")) : field.tagName === "TEXTAREA"
      ? field.defaultValue : field.getAttribute("value") ?? field.value);
  const nextValue = next.tagName === "TEXTAREA"
    ? next.textContent : field.type === "checkbox"
      ? String(next.hasAttribute("checked")) : next.getAttribute("value") ?? next.value;
  const currentValue = field.type === "checkbox" ? String(field.checked) : field.value;
  if (!field.dataset.saraDirty || currentValue === nextValue) {
    if (field.type === "checkbox") {
      field.checked = next.checked;
      if (next.checked) field.setAttribute("checked", "");
      else field.removeAttribute("checked");
    } else if (field.tagName === "TEXTAREA") {
      field.defaultValue = nextValue;
      field.value = nextValue;
    } else {
      field.value = nextValue;
      if (next.hasAttribute("value")) field.setAttribute("value", nextValue);
    }
    if (field.dataset.saraConflict === "true") {
      delete field.dataset.saraConflict;
      field.removeAttribute("aria-invalid");
      field.closest("label")?.querySelector(".sara-field-conflict")?.remove();
    }
  } else if (nextValue !== oldValue && currentValue !== nextValue) {
    field.dataset.saraConflict = "true";
    field.setAttribute("aria-invalid", "true");
  } else if (currentValue === nextValue && field.dataset.saraConflict === "true") {
    delete field.dataset.saraConflict;
    field.removeAttribute("aria-invalid");
    field.closest("label")?.querySelector(".sara-field-conflict")?.remove();
  }
}

function reconcileNode(current, next) {
  if (current.nodeType === 3) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return current;
  }
  if (current.nodeType !== 1) return current;
  const focused = current === document.activeElement;
  const preserveValue = current.matches("input, textarea, select") &&
    (focused || current.dataset.saraDirty === "true");
  syncAttributes(current, next, preserveValue);
  if (preserveValue) markFieldConflict(current, next);
  if (current.matches("textarea") && preserveValue) return current;
  if (current.matches("textarea") && !preserveValue) {
    if (current.value !== next.value) current.value = next.value;
    if (current.defaultValue !== next.defaultValue) current.defaultValue = next.defaultValue;
    return current;
  }
  if (current.matches("select") && preserveValue) return current;
  reconcileChildren(current, next);
  if (current.matches("input") && !preserveValue && current.value !== next.value) {
    current.value = next.value;
  }
  if (current.matches("input[type=checkbox]") && !preserveValue &&
      current.checked !== next.checked) current.checked = next.checked;
  return current;
}

export function reconcileChildren(root, desiredRoot) {
  const currentNodes = [...root.childNodes];
  const desiredNodes = [...desiredRoot.childNodes];
  const keyed = new Map(currentNodes.map((node) => [nodeKey(node), node]).filter(([key]) => key));
  const used = new Set();
  let cursor = root.firstChild;

  for (const desired of desiredNodes) {
    const key = nodeKey(desired);
    let match = key ? keyed.get(key) : null;
    if (!match && !key && cursor && !nodeKey(cursor) && isSameNodeKind(cursor, desired)) {
      match = cursor;
    }
    if (match && (!isSameNodeKind(match, desired) || used.has(match))) match = null;
    if (!match) {
      match = desired.cloneNode(true);
      root.insertBefore(match, cursor);
    } else {
      if (match !== cursor) root.insertBefore(match, cursor);
      reconcileNode(match, desired);
    }
    used.add(match);
    cursor = match.nextSibling;
  }

  for (const node of [...root.childNodes]) {
    if (!used.has(node)) root.removeChild(node);
  }
  const conflicts = [
    ...(root.matches?.("[data-sara-conflict]") ? [root] : []),
    ...(root.querySelectorAll?.("[data-sara-conflict]") ?? []),
  ];
  for (const field of conflicts) {
    const label = field.closest?.("label");
    if (!label || label.querySelector(".sara-field-conflict")) continue;
    const message = document.createElement("span");
    message.className = "sara-field-conflict";
    message.setAttribute("role", "status");
    message.textContent = "Значение изменилось в другом обновлении; ваш ввод сохранён.";
    label.append(message);
  }
}

export function setPanelMarkup(root, markup, characterId) {
  if (characterId !== "sara-velaris" || typeof document.createElement !== "function") {
    root.innerHTML = markup;
    return;
  }
  const template = document.createElement("template");
  template.innerHTML = markup;
  reconcileChildren(root, template.content);
}
