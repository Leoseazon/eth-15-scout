'use strict';
/* Public overview only. No network, tokens, user data, or private API access. */
(() => {
  const controls = Array.from(document.querySelectorAll('[role="tab"][data-step]'));
  const panels = new Map(controls.map(button => [
    button.dataset.step, document.getElementById(button.getAttribute('aria-controls'))
  ]));
  const indicators = Array.from(document.querySelectorAll('.method-pagination span'));
  const keys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

  function activate(button, moveFocus = false) {
    if (!button || !panels.has(button.dataset.step)) return;
    controls.forEach((control, index) => {
      const active = control === button;
      control.classList.toggle('is-active', active);
      control.setAttribute('aria-selected', String(active));
      control.tabIndex = active ? 0 : -1;
      const panel = panels.get(control.dataset.step);
      if (panel) panel.hidden = !active;
      indicators[index]?.classList.toggle('is-on', active);
    });
    if (moveFocus) button.focus();
  }
  controls.forEach((button, i) => {
    button.addEventListener('click', () => activate(button));
    button.addEventListener('keydown', event => {
      if (!keys.has(event.key)) return;
      event.preventDefault();
      let next;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = controls.length - 1;
      else next = (i + ((event.key === 'ArrowRight' || event.key === 'ArrowDown') ? 1 : -1) + controls.length) % controls.length;
      activate(controls[next], true);
    });
  });
})();
