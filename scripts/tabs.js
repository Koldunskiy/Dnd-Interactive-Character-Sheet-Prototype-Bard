const ACTIVE_TAB_STORAGE_KEY = "aurelia-character-sheet:active-tab";

export function initTabs(onActivate) {
  const tabButtons = document.querySelectorAll("[data-tab]");
  const tabPanels = document.querySelectorAll("[data-panel]");
  const appRoot = document.querySelector(".page");

  if (!(appRoot instanceof HTMLElement)) {
    throw new Error("Application root was not found");
  }

  const activateTab = (tabId, notifyActivation = false) => {
    tabButtons.forEach((button) => {
      const isActive = button.dataset.tab === tabId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });

    tabPanels.forEach((panel) => {
      const isActive = panel.dataset.panel === tabId;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    });

    appRoot.dataset.activeTab = tabId;
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tabId);

    if (notifyActivation && typeof onActivate === "function") {
      onActivate(tabId);
    }
  };

  const savedTab = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
  const initialTab = [...tabButtons].some(
    (button) => button.dataset.tab === savedTab,
  )
    ? savedTab
    : tabButtons[0]?.dataset.tab;

  if (initialTab) {
    activateTab(initialTab);
  }

  tabButtons.forEach((button) => {
    if (button.dataset.bound === "true") {
      return;
    }

    button.addEventListener("click", () => {
      activateTab(button.dataset.tab, true);
    });

    button.dataset.bound = "true";
  });
}