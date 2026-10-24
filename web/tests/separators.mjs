// Shared by layout suites: horizontal structural borders with no rendered
// text, control or image between them.
export function emptySeparators() {
  const visible = (el) =>
    el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true });
  const name = (e) =>
    e.id
      ? `#${e.id}`
      : `${e.tagName.toLowerCase()}.${[...e.classList].join(".")}`;
  const rect = (r) => ({
    x: r.x,
    y: r.y + scrollY,
    right: r.right,
    bottom: r.bottom + scrollY,
  });
  const content = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (
      !n.textContent.trim() ||
      !visible(n.parentElement) ||
      n.parentElement.closest("script,style,dialog:not([open])")
    )
      continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects())
      if (r.width && r.height) content.push(rect(r));
  }
  for (const e of document.querySelectorAll(
    "img,input,button,select,textarea,svg,canvas",
  ))
    if (visible(e)) content.push(rect(e.getBoundingClientRect()));
  const lines = [];
  for (const e of document.querySelectorAll("main,main *,footer,footer *")) {
    if (
      !visible(e) ||
      e.closest(
        "button,input,select,textarea,fieldset,pre,blockquote,dialog,.code-block,.hour-tooltip",
      )
    )
      continue;
    const s = getComputedStyle(e),
      r = rect(e.getBoundingClientRect());
    if (
      r.right - r.x < 100 ||
      parseFloat(s.borderLeftWidth) ||
      parseFloat(s.borderRightWidth)
    )
      continue;
    for (const [side, y] of [
      ["Top", r.y],
      ["Bottom", r.bottom],
    ])
      if (
        parseFloat(s[`border${side}Width`]) > 0 &&
        s[`border${side}Style`] !== "none"
      )
        lines.push({ ...r, y, name: name(e) + ":" + side });
  }
  lines.sort((a, b) => a.y - b.y);
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    const next = lines
      .slice(i + 1)
      .find(
        (b) =>
          b.y > a.y + 1 &&
          Math.min(a.right, b.right) - Math.max(a.x, b.x) >=
            Math.min(a.right - a.x, b.right - b.x) * 0.8,
      );
    if (!next) continue;
    const left = Math.max(a.x, next.x),
      right = Math.min(a.right, next.right);
    const between = content.some(
      (r) =>
        r.right > left &&
        r.x < right &&
        (r.y + r.bottom) / 2 > a.y &&
        (r.y + r.bottom) / 2 < next.y,
    );
    if (!between) bad.push({ from: a.name, to: next.name, y: [a.y, next.y] });
  }
  return bad;
}
