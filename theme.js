(() => {
  const storageKey = 'ayo-feedback-theme';
  const themeIds = new Set(['dark', 'light', 'grey', 'aero']);
  const root = document.documentElement;
  const normalize = (theme) => themeIds.has(theme) ? theme : 'dark';

  try {
    root.dataset.theme = normalize(localStorage.getItem(storageKey));
  } catch {
    root.dataset.theme = 'dark';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const pickers = document.querySelectorAll('[data-theme-picker]');
    for (const picker of pickers) {
      picker.value = root.dataset.theme;
      picker.addEventListener('change', () => {
        const theme = normalize(picker.value);
        root.dataset.theme = theme;
        for (const control of pickers) control.value = theme;
        try {
          localStorage.setItem(storageKey, theme);
        } catch {
          // The current tab can still use the theme when storage is unavailable.
        }
      });
    }
  });
})();
