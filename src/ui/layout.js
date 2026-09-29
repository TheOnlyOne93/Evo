// Adaptive layout: docked panel, drawer or bottom sheet for the inside view, plus its deck tabs.
(function (Evo) {
  'use strict';
  const { clamp, minBy } = Evo.util;
  const $ = id => document.getElementById(id);

  Evo.setupLayout = function setupLayout(app) {
    const { view, inspector } = app;
    const bodyEl = document.body, labPanel = $('labPanel'), labOpenBtn = $('labOpenBtn'), sheetHandle = $('sheetHandle');
    let currentLayout = null;
    const cssPixels = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    const resizeAll = () => { view.resize(); inspector.resize(); };
    const viewportSize = () => {
      const vv = window.visualViewport;
      return { w: vv ? vv.width : window.innerWidth, h: vv ? vv.height : window.innerHeight };
    };
    const pickLayout = ({ w, h }) => (w >= 1100 && h >= 600 ? 'desktop' : w >= 700 || w > h ? 'drawer' : 'sheet');
    app.labVisible = () => bodyEl.classList.contains('lab-open');
    function setLabState(open, stop) {
      bodyEl.classList.toggle('lab-open', open);
      if (bodyEl.dataset.layout === 'sheet' && open) bodyEl.dataset.sheet = stop || 'half';
      else delete bodyEl.dataset.sheet;
      labPanel.style.height = '';
      labOpenBtn.setAttribute('aria-expanded', String(open));
      requestAnimationFrame(() => inspector.update(true));
    }
    function setDeck(deck) {
      document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.deck === deck)));
      document.querySelectorAll('.deck').forEach(d => d.classList.toggle('hidden', d.id !== `deck-${deck}`));
      inspector.setDeck(deck);
      requestAnimationFrame(() => { resizeAll(); inspector.update(true); });
    }
    app.setDeck = setDeck;
    app.openLab = deck => { if (deck) setDeck(deck); setLabState(true); };
    labPanel.addEventListener('transitionend', e => { if (e.target === labPanel) resizeAll(); });
    const setCardCollapsed = collapsed => {
      $('creatureCard').classList.toggle('collapsed', collapsed);
      $('cardToggle').setAttribute('aria-expanded', String(!collapsed));
    };
    function applyLayout() {
      const size = viewportSize();
      bodyEl.classList.toggle('compact', size.w < 560);
      const layout = pickLayout(size);
      if (layout !== currentLayout) {
        currentLayout = layout;
        bodyEl.dataset.layout = layout;
        setLabState(false);
        setCardCollapsed(layout === 'sheet' || size.h < 560);
      }
      resizeAll();
    }
    labOpenBtn.addEventListener('click', () => setLabState(true));
    $('labCloseBtn').addEventListener('click', () => setLabState(false));
    $('cardToggle').addEventListener('click', () => setCardCollapsed(!$('creatureCard').classList.contains('collapsed')));

    // Bottom sheet: tap the handle to step through its stops, or drag it
    let startY = 0, startH = 0, dragging = false, moved = false;
    const stops = () => {
      const stageH = $('stage').getBoundingClientRect().height;
      return { closed: cssPixels('--peek'), half: stageH * 0.55, full: stageH * 0.92 };
    };
    const cycle = () => {
      const cur = bodyEl.dataset.sheet;
      if (!cur) setLabState(true, 'half'); else if (cur === 'half') setLabState(true, 'full'); else setLabState(false);
    };
    sheetHandle.addEventListener('pointerdown', e => {
      if (currentLayout !== 'sheet') return;
      dragging = true; moved = false; startY = e.clientY; startH = labPanel.getBoundingClientRect().height;
      labPanel.classList.add('dragging'); sheetHandle.setPointerCapture(e.pointerId);
    });
    sheetHandle.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 6) moved = true;
      const st = stops();
      labPanel.style.height = clamp(startH - dy, st.closed, st.full) + 'px';
    });
    const end = () => {
      if (!dragging) return;
      dragging = false; labPanel.classList.remove('dragging');
      if (!moved) return cycle();
      const hNow = labPanel.getBoundingClientRect().height;
      const [nearest] = minBy(Object.entries(stops()), ([, h]) => Math.abs(h - hNow));
      if (nearest === 'closed') setLabState(false); else setLabState(true, nearest);
    };
    sheetHandle.addEventListener('pointerup', end);
    sheetHandle.addEventListener('pointercancel', end);
    sheetHandle.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cycle(); } });

    // Deck tabs
    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
      if (currentLayout === 'sheet' && !app.labVisible()) setLabState(true, 'half');
      setDeck(tab.dataset.deck);
    }));
    $('insideBtn').addEventListener('click', () => setLabState(true));

    window.addEventListener('resize', applyLayout);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', applyLayout);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => resizeAll());
      [$('worldCanvas'), $('brainCanvas')].forEach(el => ro.observe(el));
    }
    applyLayout();
  };
})(globalThis.Evo);
