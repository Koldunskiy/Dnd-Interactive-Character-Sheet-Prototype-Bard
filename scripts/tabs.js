export function initTabs() {
  const tabButtons = document.querySelectorAll("[data-tab]");
  const tabPanels = document.querySelectorAll("[data-panel]");

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tabId = button.dataset.tab;

      tabButtons.forEach((btn) => {
        btn.classList.toggle("is-active", btn === button);
      });

      tabPanels.forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.panel === tabId);
      });
    });
  });
}