// Keyboard shortcuts.
(function (Evo) {
  'use strict';

  Evo.setupKeyboard = function setupKeyboard(app) {
    const { world, view } = app;
    window.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;   // Leave browser shortcuts alone, and keys a focused control already handled
      if (e.target.closest && e.target.closest('input, textarea')) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;   // Letters work with caps lock too
      if (e.repeat && (k === ' ' || k === 'f')) { if (k === ' ') e.preventDefault(); return; }   // A held key must not flicker the toggles
      if (k === ' ') { e.preventDefault(); app.paused = !app.paused; app.syncPlayback(); }
      else if (k === '.') { if (app.paused) app.stepOnce(); }   // Repeat is allowed: hold to step on
      else if (['ArrowLeft', 'a', 'ArrowRight', 'd', 'ArrowUp', 'w', 'ArrowDown', 's'].includes(k)) {
        e.preventDefault();
        const dx = k === 'ArrowLeft' || k === 'a' ? 90 : k === 'ArrowRight' || k === 'd' ? -90 : 0;
        const dy = k === 'ArrowUp' || k === 'w' ? 60 : k === 'ArrowDown' || k === 's' ? -60 : 0;
        view.panBy(dx, dy);
        if (app.following) { app.following = false; app.syncFollow(); }
      }
      else if (k === '+' || k === '=') view.zoomAt(1.2, view.w / 2, view.h / 2);
      else if (k === '-' || k === '_') view.zoomAt(1 / 1.2, view.w / 2, view.h / 2);
      else if (k === '0') view.resetZoom();
      else if (k === 'f') app.toggleFollow();
      else if (k === 'Escape') app.setTool('grab');
      else if (k >= '1' && k <= '4') app.setSpeed(app.SPEEDS[+k - 1]);
      else if (k === 'Tab' && world.creatures.length) {
        e.preventDefault();
        const i = world.creatures.indexOf(app.focus);
        app.select(world.creatures[(i + (e.shiftKey ? world.creatures.length - 1 : 1)) % world.creatures.length]);
      }
    });
  };
})(globalThis.Evo);
