// Keeps the Fact Check hive on screen while a request moves through its phases. iOS Safari has no
// CSS scroll anchoring, and Chrome anchors on the copy above the canvas, so every phase that adds or
// removes copy above the hive (oracle question, quorum meter, the explanation beside the canvas)
// pushed the hive out of view. The hive the reader is looking at now keeps its place instead.
const ART = '.fact-check-view[data-presentation="progress"] .fc-artwork';
const NARROW = '(max-width: 760px)';
const TAKEOVER = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
const states = new WeakMap();

/** Share of an element's height inside the visible bounds. */
export function visibleShare(rect, bounds) {
  if (!(rect.height > 0)) return 0;
  return Math.max(0, Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top)) / rect.height;
}

/** Scroll that returns the hive to where it was seen. Scrolling done since then is kept. */
export function anchorShift(anchor, top, position) {
  return top - anchor.top + position - anchor.position;
}

export function installHiveAnchor(win = globalThis.window) {
  if (!win?.document?.body || states.has(win)) return;
  const doc = win.document;
  const state = { anchor: null, follow: 0 };
  states.set(win, state);
  const scroller = el => el.closest('dialog');
  const position = dialog => dialog ? dialog.scrollTop : win.scrollY;
  const bounds = dialog => dialog ? dialog.getBoundingClientRect() : { top: 0, bottom: win.innerHeight };
  const scrollBy = (dialog, dy) => dialog ? dialog.scrollTop += dy : win.scrollBy(0, dy);
  const keyOf = el => el.closest('.fact-check-view')?.getAttribute('data-request-key');
  const seen = el => ({ el, dialog: scroller(el), key: keyOf(el), top: el.getBoundingClientRect().top, position: position(scroller(el)) });
  // The open progress dialog covers the page; otherwise only hives on the page count.
  const arts = () => {
    const open = doc.querySelector('dialog.fc-progress-dialog[open]');
    return [...(open || doc).querySelectorAll(ART)].filter(el => open || !scroller(el));
  };
  // A phase change can replace the whole view; the new hive is the one with the same request, or the nearest.
  const successor = anchor => {
    const all = arts().filter(el => scroller(el) === anchor.dialog);
    const distance = el => Math.abs(el.getBoundingClientRect().top - anchor.top);
    return all.find(el => keyOf(el) === anchor.key) || all.sort((a, b) => distance(a) - distance(b))[0];
  };
  function keep() {
    const anchor = state.anchor;
    if (!anchor) return;
    const el = anchor.el.isConnected ? anchor.el : successor(anchor);
    if (!el) return;
    const shift = anchorShift(anchor, el.getBoundingClientRect().top, position(anchor.dialog));
    if (Math.abs(shift) >= 1) scrollBy(anchor.dialog, shift);
    state.anchor = seen(el);
  }
  // After a request on a phone, bring its hive into view once the Fact Check page renders it.
  function reveal() {
    if (!state.follow) return;
    if (Date.now() > state.follow) { state.follow = 0; return; }
    const el = arts().find(el => !scroller(el));
    const rect = el?.getBoundingClientRect();
    if (rect && (rect.top < 0 || rect.bottom > win.innerHeight)) win.scrollBy(0, rect.top + rect.height / 2 - win.innerHeight / 2);
  }
  function record() {
    let best = null, share = 0.5;
    for (const el of arts()) {
      const visible = visibleShare(el.getBoundingClientRect(), bounds(scroller(el)));
      if (visible >= share) { best = el; share = visible; }
    }
    state.anchor = best && seen(best);
  }
  const update = () => { keep(); reveal(); record(); };
  doc.addEventListener('scroll', update, { capture: true, passive: true });
  win.addEventListener('resize', update, { passive: true });
  for (const type of TAKEOVER) doc.addEventListener(type, () => { state.follow = 0; }, { capture: true, passive: true });
  new win.MutationObserver(update).observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'open', 'hidden', 'style'] });
  if (win.ResizeObserver) new win.ResizeObserver(update).observe(doc.documentElement);
}

/** Called when a request transaction is sent and the site opens Fact Check. Ends when the reader takes over. */
export function followHive(win = globalThis.window, ms = 8000) {
  installHiveAnchor(win);
  const state = states.get(win);
  if (state && win.matchMedia?.(NARROW).matches) state.follow = Date.now() + ms;
}
