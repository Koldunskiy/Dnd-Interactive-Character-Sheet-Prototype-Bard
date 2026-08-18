const ACTIVE_TAB_STORAGE_KEY = "aurelia-character-sheet:active-tab";

export function initTabs() {
  const tabButtons = document.querySelectorAll("[data-tab]");
  const tabPanels = document.querySelectorAll("[data-panel]");

  const activateTab = (tabId) => {
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

    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tabId);
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
      activateTab(button.dataset.tab);
    });

    button.dataset.bound = "true";
  });
}