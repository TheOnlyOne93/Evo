// Adaptive layout: docked panel, drawer or bottom sheet for the inside view, plus its deck tabs.
(function (Evo) {
  'use strict';
  const { clamp, minBy } = Evo.util;
  const $ = id => document.getElementById(id);
  const { DRAG } = Evo.HandController;  // px the sheet handle must move before a press becomes a drag

  // Layout thresholds (CSS px of the visible viewport)
  const DESKTOP_MIN_W = 1100, DESKTOP_MIN_H = 600;  // At least this big: the lab docks beside the map
  const DRAWER_MIN_W = 700;       // Narrower (and portrait): a bottom sheet instead of a drawer
  const COMPACT_BELOW_W = 560;    // Narrower: the header, toolbar and tabs fold down (.compact)
  const CARD_FOLD_BELOW_H = 560;  // Shorter: the creature card starts folded

  Evo.setupLayout = function setupLayout(app) {
    const { view, inspector } = app;
    const bodyEl = document.body, labPanel = $('labPanel'), labOpenBtn = $('labOpenBtn'), sheetHandle = $('sheetHandle');
    let currentLayout = null;
    // A length or percentage token as its number: '70px' -> 70, '55%' -> 55
    const cssNumber = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    const resizeAll = () => { view.resize(); inspector.resize(); };
    const viewportSize = () => {
      const vv = window.visualViewport;
      return { w: vv ? vv.width : window.innerWidth, h: vv ? vv.height : window.innerHeight };
    };
    const pickLayout = ({ w, h }) => (w >= DESKTOP_MIN_W && h >= DESKTOP_MIN_H ? 'desktop' : w >= DRAWER_MIN_W || w > h ? 'drawer' : 'sheet');
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
      bodyEl.classList.toggle('compact', size.w < COMPACT_BELOW_W);
      const layout = pickLayout(size);
      if (layout !== currentLayout) {
        currentLayout = layout;
        bodyEl.dataset.layout = layout;
        setLabState(false);
        setCardCollapsed(layout === 'sheet' || size.h < CARD_FOLD_BELOW_H);
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
      return { closed: cssNumber('--peek'), half: stageH * (cssNumber('--sheet-half') / 100), full: stageH * (cssNumber('--sheet-full') / 100) };
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
      if (Math.abs(dy) > DRAG) moved = true;
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
