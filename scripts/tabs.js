import {
  decideSwipe,
  isClearlyVertical,
  isCurrentScrollRestore,
  isSwipeContextValid,
} from "./tab-gestures.js";

const ACTIVE_TAB_STORAGE_KEY = "aurelia-character-sheet:active-tab";
const controllers = new WeakMap();
const EXCLUDED_GESTURE_TARGETS = [
  "aside.sidebar", "header.topbar", "nav.tabs", "input", "textarea", "select",
  "[contenteditable]:not([contenteditable='false'])", "button", "a", "summary", "label", "video",
  "audio", "[controls]", ".spell-library-filters",
  ".spell-library-selection-filters", "dialog", "[role='dialog']",
  "[data-horizontal-scroll='true']",
].join(",");

function isExcludedTouchTarget(target, root) {
  if (!(target instanceof Element) || !root.contains(target)) return true;
  if (target.closest(EXCLUDED_GESTURE_TARGETS)) return true;
  for (let node = target; node && node !== root; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 1) return true;
  }
  const selection = window.getSelection?.();
  if (selection && !selection.isCollapsed) return true;
  if (document.querySelector("dialog[open], [role='dialog']:not([hidden])")) return true;
  if (document.activeElement?.dataset?.composing === "true") return true;
  return false;
}

function instantScrollTop(offset) {
  const scroller = document.scrollingElement;
  if (!scroller) return;
  const top = Math.max(0, Math.min(offset, scroller.scrollHeight - scroller.clientHeight));
  window.scrollTo({ top, behavior: "instant" });
}

function readLegacySavedTab() {
  try {
    return window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
  } catch (error) {
    console.warn("Не удалось прочитать старую вкладку Аурелии", error);
    return null;
  }
}

export function initTabs(onActivate, options = {}) {
  const allTabButtons = [...document.querySelectorAll("[data-tab]")];
  const allTabPanels = [...document.querySelectorAll("[data-panel]")];
  const appRoot = document.querySelector(".page");
  const swipeRoot = document.querySelector(".tab-panels");

  if (!(appRoot instanceof HTMLElement)) throw new Error("Application root was not found");
  const existing = controllers.get(appRoot);
  if (existing) {
    existing.configure(onActivate, options);
    return existing.activate;
  }

  let tabButtons = [];
  let tabPanels = [];
  let validTabs = [];
  let characterId = options.characterId ?? "aurelia";
  let sessionGeneration = options.sessionGeneration ?? 0;
  let onTabChange = options.onTabChange;
  const scrollOffsets = new Map();
  let generation = 0;
  let activeTab = null;
  let gesture = null;
  let suppressedClick = null;
  let onActivateCallback = onActivate;
  let beforeActivate = options.beforeActivate;

  const controller = {
    onActivate: onActivateCallback,
    beforeActivate,
    activate: null,
    configure: null,
  };
  const panelFor = (tabId) => tabPanels.find((panel) => panel.dataset.panel === tabId);
  const activateForCurrentCharacter = (tabId) => {
    if (characterId === "aurelia") {
      try {
        window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tabId);
      } catch (error) {
        console.warn("Не удалось сохранить вкладку Аурелии", error);
      }
    }
    onTabChange?.(characterId, tabId, sessionGeneration);
  };
  const activateTab = (tabId, notifyActivation = false) => {
    if (appRoot.dataset.screen !== "sheet" ||
        !validTabs.includes(tabId) || !panelFor(tabId) || tabId === activeTab) return false;
    const previousTab = activeTab;
    if (previousTab) {
      controller.beforeActivate?.(previousTab, tabId);
      scrollOffsets.set(`${characterId}:${previousTab}`, document.scrollingElement?.scrollTop ?? 0);
    }

    activeTab = tabId;
    gesture = null;
    generation += 1;
    tabButtons.forEach((button) => {
      const selected = button.dataset.tab === tabId;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    tabPanels.forEach((panel) => {
      const selected = panel.dataset.panel === tabId;
      panel.classList.toggle("is-active", selected);
      panel.hidden = !selected;
    });
    appRoot.dataset.activeTab = tabId;
    activateForCurrentCharacter(tabId);
    if (notifyActivation && typeof controller.onActivate === "function") {
      controller.onActivate(tabId);
    } else if (!notifyActivation && previousTab === null && typeof controller.onActivate === "function") {
      controller.onActivate(tabId);
    }

    const requestedGeneration = generation;
    const requestedCharacter = characterId;
    const requestedSessionGeneration = sessionGeneration;
    requestAnimationFrame(() => {
      if (!isCurrentScrollRestore({
        requestedGeneration,
        currentGeneration: generation,
        requestedTab: tabId,
        activeTab,
      }) || requestedCharacter !== characterId ||
          requestedSessionGeneration !== sessionGeneration) return;
      instantScrollTop(scrollOffsets.get(`${characterId}:${tabId}`) ?? 0);
    });
    return true;
  };
  controller.configure = (nextOnActivate, nextOptions = {}) => {
    onActivateCallback = nextOnActivate;
    controller.onActivate = nextOnActivate;
    controller.beforeActivate = nextOptions.beforeActivate;
    onTabChange = nextOptions.onTabChange;
    if (activeTab) {
      scrollOffsets.set(`${characterId}:${activeTab}`, document.scrollingElement?.scrollTop ?? 0);
    }
    characterId = nextOptions.characterId ?? characterId;
    sessionGeneration = nextOptions.sessionGeneration ?? sessionGeneration;
    const allowed = nextOptions.tabs ? new Set(nextOptions.tabs) : null;
    tabButtons = allTabButtons.filter((button) => !allowed || allowed.has(button.dataset.tab));
    tabPanels = allTabPanels.filter((panel) => !allowed || allowed.has(panel.dataset.panel));
    validTabs = tabButtons.map((button) => button.dataset.tab).filter((tabId) =>
      tabPanels.some((panel) => panel.dataset.panel === tabId));
    appRoot.style.setProperty("--tab-count", String(validTabs.length));
    allTabButtons.forEach((button) => {
      button.hidden = !validTabs.includes(button.dataset.tab);
      button.disabled = button.hidden;
    });
    allTabPanels.forEach((panel) => {
      if (!validTabs.includes(panel.dataset.panel)) {
        panel.hidden = true;
        panel.classList.remove("is-active");
      }
    });
    activeTab = null;
    gesture = null;
    generation += 1;
    const savedTab = nextOptions.initialTab ?? nextOptions.getLastTab?.(characterId);
    const legacyTab = characterId === "aurelia" ? readLegacySavedTab() : null;
    const initialTab = validTabs.includes(savedTab)
      ? savedTab
      : validTabs.includes(legacyTab) ? legacyTab : validTabs[0];
    if (initialTab) activateTab(initialTab);
  };
  controller.activate = activateTab;
  controllers.set(appRoot, controller);

  controller.configure(onActivate, options);

  allTabButtons.forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.addEventListener("click", () => activateTab(button.dataset.tab, true));
    button.dataset.bound = "true";
  });

  const compactQuery = window.matchMedia("(max-width: 899px)");
  const canTouch = "ontouchstart" in window || Number(navigator.maxTouchPoints ?? 0) > 0;
  if (swipeRoot && canTouch) {
    const cancelGesture = () => { gesture = null; };
    swipeRoot.addEventListener("touchstart", (event) => {
      const activePanel = event.target instanceof Element
        ? event.target.closest(".tab-panel")
        : null;
      if (!compactQuery.matches || event.touches.length !== 1 || !activeTab ||
          activePanel?.dataset.panel !== activeTab ||
          !activePanel.classList.contains("is-active") ||
          isExcludedTouchTarget(event.target, swipeRoot)) {
        cancelGesture();
        return;
      }
      const touch = event.touches[0];
      if (touch.clientX < 24 || touch.clientX > window.innerWidth - 24) {
        cancelGesture();
        return;
      }
      gesture = {
        identifier: touch.identifier,
        startX: touch.clientX,
        startY: touch.clientY,
        startedAt: event.timeStamp,
        activeTab,
        target: event.target,
      };
    }, { passive: true });

    swipeRoot.addEventListener("touchmove", (event) => {
      if (!gesture) return;
      if (!isSwipeContextValid({
            contactCount: event.touches.length,
            startTab: gesture.activeTab,
            activeTab,
            compact: compactQuery.matches,
            visible: document.visibilityState !== "hidden",
          }) ||
          event.touches[0].identifier !== gesture.identifier ||
          document.querySelector("dialog[open], [role='dialog']:not([hidden])") ||
          (window.getSelection?.() && !window.getSelection().isCollapsed) ||
          document.activeElement?.dataset?.composing === "true" ||
          document.activeElement?.matches?.("input, textarea, select, [contenteditable]:not([contenteditable='false')]")) {
        cancelGesture();
        return;
      }
      const touch = event.touches[0];
      if (isClearlyVertical(touch.clientX - gesture.startX, touch.clientY - gesture.startY)) {
        cancelGesture();
      }
    }, { passive: true });

    swipeRoot.addEventListener("touchend", (event) => {
      if (!gesture) return;
      const ended = [...event.changedTouches].find((touch) => touch.identifier === gesture.identifier);
      if (!ended || event.changedTouches.length !== 1 || event.touches.length !== 0 ||
          !isSwipeContextValid({
            contactCount: 1,
            startTab: gesture.activeTab,
            activeTab,
            compact: compactQuery.matches,
            visible: document.visibilityState !== "hidden",
          }) ||
          document.querySelector("dialog[open], [role='dialog']:not([hidden])") ||
          (window.getSelection?.() && !window.getSelection().isCollapsed) ||
          document.activeElement?.dataset?.composing === "true" ||
          document.activeElement?.matches?.("input, textarea, select, [contenteditable]:not([contenteditable='false')]")) {
        cancelGesture();
        return;
      }
      const endedGesture = gesture;
      gesture = null;
      const dx = ended.clientX - endedGesture.startX;
      const dy = ended.clientY - endedGesture.startY;
      const targetIndex = decideSwipe({
        dx,
        dy,
        duration: event.timeStamp - endedGesture.startedAt,
        startX: endedGesture.startX,
        viewportWidth: window.innerWidth,
        count: validTabs.length,
        activeIndex: validTabs.indexOf(activeTab),
      });
      if (targetIndex === null) return;
      const clickTarget = document.elementFromPoint?.(ended.clientX, ended.clientY) ?? endedGesture.target;
      suppressedClick = { target: clickTarget, endedAt: event.timeStamp };
      activateTab(validTabs[targetIndex], true);
    }, { passive: true });
    swipeRoot.addEventListener("touchcancel", cancelGesture, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") cancelGesture();
    });
    const onBreakpointChange = () => {
      if (!compactQuery.matches) cancelGesture();
    };
    compactQuery.addEventListener?.("change", onBreakpointChange);
    if (!compactQuery.addEventListener) compactQuery.addListener(onBreakpointChange);
    swipeRoot.addEventListener("click", (event) => {
      if (!suppressedClick) return;
      if (event.detail === 0) {
        suppressedClick = null;
        return;
      }
      if (event.timeStamp - suppressedClick.endedAt > 350) {
        suppressedClick = null;
        return;
      }
      const { target } = suppressedClick;
      const isRelated = event.target === target ||
        target.contains?.(event.target) ||
        event.target.contains?.(target);
      if (!isRelated) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressedClick = null;
    }, true);
  }

  return activateTab;
}
