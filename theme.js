(() => {
  const storageKey = 'ayo-feedback-theme';
  const themes = [
    { id: 'dark', name: 'Nebula', description: 'Purple midnight' },
    { id: 'light', name: 'Pearl', description: 'Soft lavender' },
    { id: 'grey', name: 'Grey', description: 'Neutral graphite' },
    { id: 'aero', name: 'Frutiger Aero', description: 'Blue sky and green hills' },
    { id: 'horizon', name: 'Horizon', description: 'Warm sunset' },
    { id: 'frost', name: 'Frost', description: 'Icy daylight' },
  ];
  const root = document.documentElement;
  const themeFor = (id) => themes.find((theme) => theme.id === id) ?? themes[0];

  try {
    root.dataset.theme = themeFor(localStorage.getItem(storageKey)).id;
  } catch {
    root.dataset.theme = themes[0].id;
  }

  function option(theme, group) {
    const label = document.createElement('label');
    label.className = 'theme-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = group;
    input.value = theme.id;
    const preview = document.createElement('span');
    preview.className = 'theme-preview';
    preview.dataset.palette = theme.id;
    preview.setAttribute('aria-hidden', 'true');
    const rail = document.createElement('span');
    const panel = document.createElement('span');
    preview.append(rail, panel);
    const name = document.createElement('strong');
    name.textContent = theme.name;
    const description = document.createElement('small');
    description.textContent = theme.description;
    label.append(input, preview, name, description);
    return label;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const pickers = [...document.querySelectorAll('[data-theme-picker]')];
    const apply = (id) => {
      const theme = themeFor(id);
      root.dataset.theme = theme.id;
      for (const picker of pickers) {
        picker.querySelector('[data-theme-name]').textContent = theme.name;
        for (const option of picker.querySelectorAll('input')) option.checked = option.value === theme.id;
      }
    };

    pickers.forEach((picker, index) => {
      picker.querySelector('[data-theme-options]').append(...themes.map((theme) => option(theme, 'theme-' + index)));
      picker.addEventListener('change', ({ target }) => {
        apply(target.value);
        try {
          localStorage.setItem(storageKey, root.dataset.theme);
        } catch {
          // Theme changes still apply in this tab when storage is unavailable.
        }
      });
    });
    apply(root.dataset.theme);

    document.addEventListener('click', ({ target }) => {
      for (const picker of pickers) {
        if (picker.open && !picker.contains(target)) picker.open = false;
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const picker = pickers.find((element) => element.open);
      if (!picker) return;
      picker.open = false;
      picker.querySelector('summary').focus();
      event.preventDefault();
    });
  });
})();
