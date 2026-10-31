let hostState = null;
let listenersBound = false;
let callbacks = null;

function getDialog() {
  return document.getElementById("actionWorkspaceRoot");
}

function focusHeading() {
  getDialog()?.querySelector("[data-workspace-title]")?.focus({ preventScroll: true });
}

function captureAndLock(invoker) {
  const body = document.body;
  const rect = invoker?.getBoundingClientRect?.();
  hostState = {
    invokerKey: invoker?.dataset?.workspaceInvoker ?? "normal-attack",
    invokerTop: rect?.top ?? null,
    scrollY: window.scrollY,
    styles: {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    },
  };
  body.style.position = "fixed";
  body.style.top = `-${hostState.scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";
}

function restoreBackground(restoreFocus = true) {
  if (!hostState) return;
  const saved = hostState;
  const body = document.body;
  Object.assign(body.style, saved.styles);
  hostState = null;
  window.scrollTo({ top: saved.scrollY, behavior: "auto" });
  if (restoreFocus) {
    let invoker = [...document.querySelectorAll("[data-workspace-invoker]")]
      .find((node) => node.dataset.workspaceInvoker === saved.invokerKey && node.isConnected);
    if (!invoker) invoker = document.querySelector("#battleConsoleTitle") ??
      document.querySelector("[data-panel='melee'] h2");
    if (invoker?.isConnected) {
      const top = invoker.getBoundingClientRect().top;
      if (saved.invokerTop != null && Math.abs(top - saved.invokerTop) > 2) {
        window.scrollBy(0, top - saved.invokerTop);
      }
      invoker.focus?.({ preventScroll: true });
    }
  }
}

function updateVisibleViewport() {
  const viewport = window.visualViewport;
  const dialog = getDialog();
  if (!dialog || !viewport) return;
  dialog.style.setProperty("--workspace-visible-height", `${viewport.height}px`);
  dialog.style.setProperty("--workspace-visible-top", `${viewport.offsetTop}px`);
  dialog.toggleAttribute("data-compact", viewport.height < 500);
}

export function initWorkspaceHost(eventCallbacks) {
  callbacks = eventCallbacks;
  const dialog = getDialog();
  if (!(dialog instanceof HTMLDialogElement) || listenersBound) return Boolean(dialog);
  dialog.addEventListener("click", (event) => {
    const button = event.target.closest("[data-workspace-action]");
    if (button && dialog.contains(button)) callbacks?.onAction?.(button.dataset.workspaceAction, button);
  });
  dialog.addEventListener("input", (event) => {
    const field = event.target.closest("[data-workspace-field]");
    if (field && dialog.contains(field)) callbacks?.onInput?.(field);
  });
  dialog.addEventListener("change", (event) => {
    const field = event.target.closest("[data-workspace-field]");
    if (field && dialog.contains(field)) callbacks?.onInput?.(field);
  });
  dialog.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-workspace-form]");
    if (!form || !dialog.contains(form)) return;
    event.preventDefault();
    callbacks?.onSubmit?.(form);
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    callbacks?.onAction?.("back");
  });
  window.visualViewport?.addEventListener("resize", updateVisibleViewport);
  window.visualViewport?.addEventListener("scroll", updateVisibleViewport);
  window.addEventListener("resize", updateVisibleViewport);
  listenersBound = true;
  return true;
}

export function openWorkspaceHost(invoker) {
  const dialog = getDialog();
  if (!(dialog instanceof HTMLDialogElement)) return false;
  if (dialog.open) return true;
  captureAndLock(invoker);
  try {
    dialog.showModal();
    updateVisibleViewport();
    focusHeading();
    return true;
  } catch (error) {
    restoreBackground();
    throw error;
  }
}

export function renderWorkspaceHost({ header, body, footer, status = "" }) {
  const dialog = getDialog();
  if (!dialog) return;
  const headerNode = dialog.querySelector("[data-workspace-header]");
  const bodyNode = dialog.querySelector("[data-workspace-body]");
  const footerNode = dialog.querySelector("[data-workspace-footer]");
  const statusNode = dialog.querySelector("[data-workspace-status]");
  if (headerNode && headerNode.innerHTML !== header) headerNode.innerHTML = header;
  if (bodyNode && bodyNode.innerHTML !== body) bodyNode.innerHTML = body;
  if (footerNode && footerNode.innerHTML !== footer) footerNode.innerHTML = footer;
  if (statusNode) statusNode.textContent = status;
}

export function updateWorkspaceResources(state, maximumHitPoints = null) {
  const dialog = getDialog();
  if (!dialog) return;
  const hp = dialog.querySelector("[data-workspace-hp]");
  const ki = dialog.querySelector("[data-workspace-ki]");
  if (hp) hp.textContent = maximumHitPoints == null
    ? String(state.combat?.hp?.current ?? "—")
    : `${state.combat?.hp?.current ?? "—"}/${maximumHitPoints}`;
  if (ki) ki.textContent = `${state.combat?.ki?.current ?? "—"}`;
}

export function closeWorkspaceHost({ restoreFocus = true } = {}) {
  const dialog = getDialog();
  if (dialog?.open) dialog.close();
  restoreBackground(restoreFocus);
}

export function minimizeWorkspaceHost() {
  closeWorkspaceHost();
}

export function workspaceHostIsOpen() {
  return Boolean(getDialog()?.open);
}

export function focusWorkspaceHeading() {
  focusHeading();
}

export function scrollWorkspaceBodyTop() {
  const body = getDialog()?.querySelector("[data-workspace-body]");
  if (body) body.scrollTop = 0;
}

export function getWorkspaceHost() {
  return getDialog();
}
