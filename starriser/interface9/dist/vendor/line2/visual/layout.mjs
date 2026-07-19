/**
 * Grid layout for visual tiles on a single canvas.
 */

/**
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {number} count
 * @param {{ cols?: number, pad?: number, headerPx?: number }} [opts]
 * @returns {Array<{ index: number, x: number, y: number, w: number, h: number, col: number, row: number }>}
 */
export function computeTileRects(canvasW, canvasH, count, opts = {}) {
  const pad = opts.pad ?? 4;
  const headerPx = opts.headerPx ?? 0;
  const usableH = Math.max(1, canvasH - headerPx);
  const cols = opts.cols ?? Math.max(1, Math.ceil(Math.sqrt(count * (canvasW / usableH))));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cellW = (canvasW - pad * (cols + 1)) / cols;
  const cellH = (usableH - pad * (rows + 1)) / rows;
  const rects = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = Math.floor(pad + col * (cellW + pad));
    const y = Math.floor(headerPx + pad + row * (cellH + pad));
    const w = Math.max(1, Math.floor(cellW));
    const h = Math.max(1, Math.floor(cellH));
    // WebGPU: setViewport / setScissorRect origin is top-left of the attachment.
    rects.push({ index: i, x, y, w, h, col, row });
  }
  return { rects, cols, rows, cellW, cellH };
}

/**
 * HTML overlay positions matching canvas tiles (CSS pixels).
 * @param {HTMLElement} container
 * @param {Array<{ x: number, y: number, w: number, h: number }>} rects
 * @param {number} cssScaleX  canvasBackingStore / cssWidth
 * @param {number} cssScaleY
 */
export function placeCaptionElements(container, rects, cases, cssScaleX, cssScaleY) {
  container.replaceChildren();
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const c = cases[i];
    const el = document.createElement("div");
    el.className = `caption badge-${c.kind}`;
    el.style.left = `${r.x / cssScaleX}px`;
    el.style.top = `${r.y / cssScaleY}px`;
    el.style.width = `${r.w / cssScaleX}px`;
    // Residual tradeoff hints are longer; allow a taller strip when tile allows.
    const maxCap = c.kind === "residual" || c.multiWidth ? 88 : 72;
    el.style.height = `${Math.min(maxCap, r.h / cssScaleY)}px`;
    el.innerHTML =
      `<span class="kind-tag">${c.kind}</span>` +
      `<strong>${c.id}</strong> ${escapeHtml(c.title)}` +
      `<br/><span class="hint">${escapeHtml(c.hint)}</span>`;
    container.appendChild(el);
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
