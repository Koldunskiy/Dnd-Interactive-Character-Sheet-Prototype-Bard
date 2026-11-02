let hostState = null;
let callbacks = null;
let activeHost = null;
let viewportListenersBound = false;
let hostResizeObserver = null;
const boundHosts = new WeakSet();
let viewportFrame = 0;
let blurFrame = 0;

function getDialog() {
  return document.getElementById("actionWorkspaceRoot");
}

function getEmbeddedHost() {
  const panel = document.querySelector('[data-panel="melee"].is-active');
  return panel?.querySelector("[data-combat-workspace-root]") ?? null;
}

function isEmbeddedHost(host) {
  return Boolean(host && host.matches?.("[data-combat-workspace-root]"));
}

function focusHeading() {
  activeHost?.querySelector("[data-workspace-title]")?.focus({ preventScroll: true });
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
  if (!activeHost) return;
  const visibleHeight = viewport?.height ?? window.innerHeight;
  const visibleOffsetTop = viewport?.offsetTop ?? 0;
  const embedded = isEmbeddedHost(activeHost);
  if (embedded) {
    // Both values are viewport coordinates; getBoundingClientRect().top uses the same space.
    const visibleBottom = visibleOffsetTop + visibleHeight;
    const taskTop = activeHost.getBoundingClientRect?.().top ?? visibleOffsetTop;
    const availableHeight = Math.max(0, visibleBottom - taskTop);
    activeHost.style.setProperty("--workspace-available-height", `${availableHeight}px`);
    activeHost.dataset.visibleHeight = String(Math.round(visibleHeight));
    activeHost.dataset.visibleOffsetTop = String(Math.round(visibleOffsetTop));
  } else {
    activeHost.style.setProperty("--workspace-visible-height", `${visibleHeight}px`);
    activeHost.style.setProperty("--workspace-visible-top", `${visibleOffsetTop}px`);
  }
  const numericEntry = activeHost.querySelector?.('[data-workspace-field][type="number"]:focus');
  if (embedded && numericEntry) activateEntryPresentation(activeHost, visibleOffsetTop, visibleHeight);
  const availableHeight = embedded
    ? Number(activeHost.style.getPropertyValue("--workspace-available-height").replace("px", ""))
    : visibleHeight;
  activeHost.toggleAttribute("data-compact-height", availableHeight < 460);
}

function activateEntryPresentation(host, top, height) {
  document.documentElement?.setAttribute?.("data-combat-entry-active", "true");
  host.dataset.entryActive = "true";
  host.style.setProperty("--workspace-entry-top", `${top}px`);
  host.style.setProperty("--workspace-entry-height", `${height}px`);
}

function releaseEntryPresentation(host = activeHost) {
  document.documentElement?.removeAttribute?.("data-combat-entry-active");
  if (!host) return;
  delete host.dataset.entryActive;
  host.style.removeProperty?.("--workspace-entry-top");
  host.style.removeProperty?.("--workspace-entry-height");
}

function scheduleViewportUpdate() {
  if (viewportFrame) return;
  viewportFrame = requestAnimationFrame(() => {
    viewportFrame = 0;
    updateVisibleViewport();
  });
}

function observeActiveHost() {
  hostResizeObserver?.disconnect();
  hostResizeObserver = null;
  if (typeof ResizeObserver !== "function" || !isEmbeddedHost(activeHost)) return;
  hostResizeObserver = new ResizeObserver(scheduleViewportUpdate);
  hostResizeObserver.observe(activeHost);
  if (activeHost.parentElement) hostResizeObserver.observe(activeHost.parentElement);
}

function bindHost(host) {
  if (!host || boundHosts.has(host)) return;
  host.addEventListener("click", (event) => {
    const button = event.target.closest("[data-workspace-action]");
    if (!button || !host.contains(button)) return;
    callbacks?.onAction?.(button.dataset.workspaceAction, button);
    if (!host.querySelector('[data-workspace-form="attack"] input[type="number"], [data-workspace-form="damage"] input[type="number"]')) {
      releaseEntryPresentation(host);
    }
  });
  const updateField = (event) => {
    const field = event.target.closest("[data-workspace-field]");
    if (field && host.contains(field)) callbacks?.onInput?.(field);
  };
  host.addEventListener("input", updateField);
  host.addEventListener("change", updateField);
  host.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-workspace-form]");
    if (!form || !host.contains(form)) return;
    event.preventDefault();
    callbacks?.onSubmit?.(form);
  });
  host.addEventListener("focusin", (event) => {
    const field = event.target.closest("[data-workspace-field]");
    host.dataset.editing = field ? "true" : "false";
    host.dataset.focusedFieldKey = field?.name ?? "";
    if (field?.matches('input[type="number"]') && isEmbeddedHost(host)) {
      const viewport = window.visualViewport;
      activateEntryPresentation(host, viewport?.offsetTop ?? 0, viewport?.height ?? window.innerHeight);
    }
    scheduleViewportUpdate();
  });
  host.addEventListener("focusout", () => {
    if (blurFrame) cancelAnimationFrame(blurFrame);
    blurFrame = requestAnimationFrame(() => {
      blurFrame = 0;
      if (!host.contains(document.activeElement)) {
        host.dataset.editing = "false";
        host.dataset.focusedFieldKey = "";
        if (!document.activeElement?.matches?.('[data-workspace-field][type="number"], [data-workspace-action]')) {
          releaseEntryPresentation(host);
        }
      }
    });
  });
  if (host instanceof HTMLDialogElement) {
    host.addEventListener("cancel", (event) => {
      event.preventDefault();
      callbacks?.onAction?.("back");
    });
  }
  boundHosts.add(host);
}

export function initWorkspaceHost(eventCallbacks) {
  callbacks = eventCallbacks;
  const dialog = getDialog();
  const embedded = getEmbeddedHost();
  if (!(dialog instanceof HTMLDialogElement)) return false;
  bindHost(dialog);
  bindHost(embedded);
  activeHost = embedded ?? dialog;
  if (!viewportListenersBound) {
    window.visualViewport?.addEventListener("resize", scheduleViewportUpdate);
    window.visualViewport?.addEventListener("scroll", scheduleViewportUpdate);
    window.addEventListener("resize", scheduleViewportUpdate);
    viewportListenersBound = true;
  }
  return Boolean(activeHost);
}

export function openWorkspaceHost(invoker) {
  const dialog = getDialog();
  if (!(dialog instanceof HTMLDialogElement)) return false;
  activeHost = getEmbeddedHost() ?? dialog;
  bindHost(activeHost);
  if (isEmbeddedHost(activeHost)) {
    activeHost.hidden = false;
    observeActiveHost();
    updateVisibleViewport();
    document.dispatchEvent(new CustomEvent("action-workspace-visibility-changed"));
    focusHeading();
    return true;
  }
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

export function renderWorkspaceHost({ header, body, footer, status = "", error = "", forceBody = false }) {
  const host = activeHost ?? getDialog();
  if (!host) return;
  const headerNode = host.querySelector("[data-workspace-header]");
  const bodyNode = host.querySelector("[data-workspace-body]");
  const footerNode = host.querySelector("[data-workspace-footer]");
  const statusNode = host.querySelector("[data-workspace-status]");
  const errorNode = host.querySelector("[data-workspace-error]");
  let keepFocusedForm = false;
  if (headerNode && headerNode.innerHTML !== header) headerNode.innerHTML = header;
  if (bodyNode && bodyNode.innerHTML !== body) {
    const activeElement = document.activeElement;
    const currentForm = bodyNode.querySelector?.("[data-workspace-form]");
    const nextFormKind = body.match(/data-workspace-form="([^"]+)"/)?.[1] ?? null;
    keepFocusedForm = !forceBody && currentForm && nextFormKind &&
      currentForm.dataset.workspaceForm === nextFormKind &&
      currentForm.contains(activeElement);
    if (!keepFocusedForm) bodyNode.innerHTML = body;
  }
  if (footerNode && footerNode.innerHTML !== footer) footerNode.innerHTML = footer;
  if (errorNode) {
    errorNode.textContent = keepFocusedForm ? error : "";
    errorNode.hidden = !keepFocusedForm || !error;
  }
  if (statusNode) statusNode.textContent = status;
}

export function updateWorkspaceResources(state, maximumHitPoints = null) {
  const host = activeHost ?? getDialog();
  if (!host) return;
  const hp = host.querySelector("[data-workspace-hp]");
  const ki = host.querySelector("[data-workspace-ki]");
  if (hp) hp.textContent = maximumHitPoints == null
    ? String(state.combat?.hp?.current ?? "—")
    : `${state.combat?.hp?.current ?? "—"}/${maximumHitPoints}`;
  if (ki) ki.textContent = `${state.combat?.ki?.current ?? "—"}`;
}

export function closeWorkspaceHost({ restoreFocus = true, discardEmbedded = false } = {}) {
  if (isEmbeddedHost(activeHost)) {
    const closedHost = activeHost;
    activeHost.hidden = true;
    activeHost.dataset.editing = "false";
    activeHost.dataset.focusedFieldKey = "";
    releaseEntryPresentation(closedHost);
    hostResizeObserver?.disconnect();
    hostResizeObserver = null;
    if (discardEmbedded) {
      for (const selector of [
        "[data-workspace-header]",
        "[data-workspace-body]",
        "[data-workspace-footer]",
        "[data-workspace-status]",
        "[data-workspace-error]",
      ]) {
        const node = closedHost.querySelector(selector);
        if (node) node.textContent = "";
      }
      activeHost = getDialog();
    }
    return;
  }
  if (activeHost?.open) activeHost.close();
  releaseEntryPresentation();
  restoreBackground(restoreFocus);
}

export function minimizeWorkspaceHost() {
  closeWorkspaceHost();
}

export function workspaceHostIsOpen() {
  return isEmbeddedHost(activeHost)
    ? Boolean(activeHost.isConnected && !activeHost.hidden)
    : Boolean(getDialog()?.open);
}

export function workspaceHostIsEmbedded() {
  return isEmbeddedHost(activeHost);
}

export function focusWorkspaceHeading() {
  focusHeading();
}

export function scrollWorkspaceBodyTop() {
  const body = getDialog()?.querySelector("[data-workspace-body]");
  if (body) body.scrollTop = 0;
}

export function getWorkspaceHost() {
  if (activeHost?.isConnected) return activeHost;
  return getDialog();
}
