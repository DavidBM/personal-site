import { bindText, setText } from './dom-bindings.js';
/**
 * Compact readout language for editor panels.
 * Labels share a column, values share a column, buttons stay short.
 */
const STYLE_ID = "galaxy-micro-styles";
export function ensureMicroStyles() {
    if (document.getElementById(STYLE_ID))
        return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.micro.ui-panel { padding: 7px 8px 6px; border-radius: 2px; }
.micro > .ui-panel-title {
  margin: 0 0 6px;
  font-size: 10px;
  letter-spacing: 0.14em;
}
.micro > .ui-panel-content { gap: 4px; }
.micro-fields {
  display: grid;
  grid-template-columns: 1fr 76px;
  column-gap: 10px;
  row-gap: 1px;
  align-items: center;
}
.micro-k, .micro-h {
  font-size: 9px;
  line-height: 1.2;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6d8499;
}
.micro-input {
  width: 100%;
  box-sizing: border-box;
  text-align: right;
  font: 11px/1.2 "Fira Mono", ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  color: #e7f2ff;
  background: transparent;
  border: none;
  border-bottom: 1px solid rgba(120, 160, 190, 0.28);
  border-radius: 0;
  padding: 1px 0 1px;
}
.micro-input:focus { outline: none; border-bottom-color: #8fd0ff; }
.micro-actions { display: flex; flex-wrap: wrap; gap: 3px; }
.micro-btn {
  font: 9px/1 "Fira Mono", ui-monospace, monospace;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 4px 6px;
  color: #c5d8ec;
  background: transparent;
  border: 1px solid rgba(130, 170, 200, 0.35);
  border-radius: 0;
  cursor: pointer;
}
.micro-btn:hover { color: #fff; border-color: #8fd0ff; }
.micro-btn-primary { color: #9fd4ff; border-color: rgba(120, 190, 255, 0.6); }
.micro-btn[aria-pressed="true"] {
  color: #9fd4ff;
  border-color: rgba(120, 190, 255, 0.75);
  background: rgba(42, 93, 150, 0.35);
}
.micro-check {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #8ea6bb;
}
.micro-check input { margin: 0; width: 11px; height: 11px; }
.micro-sheet {
  display: grid;
  grid-template-columns: 28px repeat(5, minmax(0, 1fr));
  align-items: center;
  column-gap: 2px;
  row-gap: 1px;
}
.micro-h {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  text-align: right;
  padding: 0 1px 3px 0;
}
.micro-reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  padding: 0;
  border: none;
  background: transparent;
  color: #6d8499;
  cursor: pointer;
}
.micro-reset:hover { color: #e7f2ff; }
.micro-reset-mark {
  width: 11px;
  height: 11px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.3;
  stroke-linecap: square;
  stroke-linejoin: miter;
}
.micro-name {
  font-size: 9px;
  letter-spacing: 0.06em;
  color: #8ea6bb;
}
.micro-drag {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr);
  align-items: center;
  column-gap: 2px;
  min-width: 0;
  padding: 1px 0;
  color: #e7f2ff;
  cursor: ns-resize;
  user-select: none;
  touch-action: none;
}
.micro-drag-mark {
  width: 8px;
  height: 14px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.35;
  stroke-linecap: square;
  stroke-linejoin: miter;
  opacity: 0.85;
}
.micro-drag-value {
  font: 11px/1 "Fira Mono", ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
.micro-drag-editing { cursor: text; }
.micro-drag-edit {
  height:100%; box-sizing:border-box;
  width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  border-bottom: 1px solid #8fd0ff;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: right;
  outline: none;
  user-select: text;
}
`;
    document.head.appendChild(style);
}
/** Signed value change. One slow pixel is `step` (default 0.1). A fast drag multiplies it. */
export function scrubDelta(dyPx, dtMs, step = 0.1) {
    const dt = Math.max(dtMs, 1);
    const speed = Math.abs(dyPx) / dt;
    const gain = Math.min(16, Math.max(1, speed / 0.2));
    return dyPx * step * gain;
}
/** One decimal on the tenth grid. Hundredths, then thousandths, stay visible. */
export function formatScrub(value) {
    const shown = Math.round(value * 1000) / 1000;
    const tenth = Math.round(shown * 10) / 10;
    if (Math.abs(shown - tenth) < 1e-4)
        return tenth.toFixed(1);
    const hundredth = Math.round(shown * 100) / 100;
    if (Math.abs(shown - hundredth) < 1e-4)
        return hundredth.toFixed(2);
    return shown.toFixed(3);
}
export function microButton(label, title, onClick, primary = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = primary ? "micro-btn micro-btn-primary" : "micro-btn";
    button.textContent = label;
    button.title = title;
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });
    return button;
}
export function fieldInput(id, value) {
    const input = document.createElement("input");
    input.id = id;
    input.className = "micro-input";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.value = String(value);
    return input;
}
/** Circular arrow. Column headers use it to restore that field. */
export function resetMark() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 12 12");
    svg.setAttribute("class", "micro-reset-mark");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = `<path d="M9.5 4.2a3.7 3.7 0 1 0 .8 2.6"/><path d="M9.3 1.4 L10 4.4 L7.1 3.9"/>`;
    return svg;
}
export function microIconButton(title, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "micro-reset";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.append(resetMark());
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });
    return button;
}
export function dragMark() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 8 16");
    svg.setAttribute("class", "micro-drag-mark");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = `<path d="M1 6 L4 1.2 L7 6"/><path d="M1 10 L4 14.8 L7 10"/>`;
    return svg;
}
const DRAG_SLOP_PX = 3;
export function mountDragValue(host, options) {
    const step = options.step ?? 0.1;
    const places = step < 0.01 ? 1000 : 100;
    const quantize = (next) => clamp(Math.round(next * places) / places, options.min, options.max);
    let value = quantize(options.value);
    const readout = host.querySelector(".micro-drag-value");
    const readoutText = readout ? bindText(readout, { height: '18px', lineHeight: '18px' }) : null;
    let editing = false;
    const paint = () => {
        if (editing)
            return;
        if (readoutText)
            setText(readoutText, formatScrub(value));
    };
    paint();
    let pointerId = null;
    let originY = 0;
    let originT = 0;
    let lastY = 0;
    let lastT = 0;
    let dragged = false;
    let field = null;
    const clearSelection = () => window.getSelection?.()?.removeAllRanges();
    const commitTyped = (text) => {
        const parsed = Number(text);
        if (!Number.isFinite(parsed))
            return;
        const next = quantize(parsed);
        if (next === value)
            return;
        value = next;
        options.onChange(value);
    };
    const closeEdit = (commit) => {
        if (!editing || !field)
            return;
        const typed = field;
        editing = false;
        field = null;
        host.classList.remove("micro-drag-editing");
        if (commit)
            commitTyped(typed.value);
        typed.remove();
        paint();
    };
    const beginEdit = () => {
        if (!readout || editing)
            return;
        editing = true;
        host.classList.add("micro-drag-editing");
        const input = document.createElement("input");
        input.className = "micro-drag-edit";
        input.inputMode = "decimal";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.value = formatScrub(value);
        field = input;
        if (readoutText)
            setText(readoutText, "");
        readout.append(input);
        input.focus();
        input.select();
        const quiet = (event) => event.stopPropagation();
        input.addEventListener("keydown", (event) => {
            quiet(event);
            if (event.key === "Enter") {
                event.preventDefault();
                closeEdit(true);
            }
            else if (event.key === "Escape") {
                event.preventDefault();
                closeEdit(false);
            }
        });
        input.addEventListener("keyup", quiet);
        input.addEventListener("blur", () => {
            if (editing && field === input)
                closeEdit(true);
        });
    };
    host.addEventListener("pointerdown", (event) => {
        if (event.button !== 0)
            return;
        const onField = editing && event.target === field;
        pointerId = event.pointerId;
        originY = lastY = event.clientY;
        originT = lastT = event.timeStamp;
        dragged = false;
        try {
            host.setPointerCapture(event.pointerId);
        }
        catch { /* capture is optional */ }
        if (onField)
            return;
        event.preventDefault();
        event.stopPropagation();
    });
    host.addEventListener("pointermove", (event) => {
        if (pointerId !== event.pointerId)
            return;
        if (!dragged) {
            if (Math.abs(event.clientY - originY) < DRAG_SLOP_PX)
                return;
            dragged = true;
            clearSelection();
            if (editing)
                closeEdit(false);
            try {
                host.setPointerCapture(event.pointerId);
            }
            catch { /* already captured */ }
            event.preventDefault();
            lastY = originY;
            lastT = originT;
        }
        const dy = lastY - event.clientY;
        const dt = event.timeStamp - lastT;
        lastY = event.clientY;
        lastT = event.timeStamp;
        if (dy === 0)
            return;
        const next = quantize(value + scrubDelta(dy, dt, step));
        if (next === value)
            return;
        value = next;
        paint();
        options.onChange(value);
    });
    const release = (event) => {
        if (pointerId !== event.pointerId)
            return;
        const wasDrag = dragged;
        pointerId = null;
        dragged = false;
        if (!wasDrag && !editing)
            beginEdit();
    };
    host.addEventListener("pointerup", release);
    host.addEventListener("pointercancel", (event) => {
        if (pointerId !== event.pointerId)
            return;
        pointerId = null;
        dragged = false;
    });
    return {
        set(next) {
            value = clamp(next, options.min, options.max);
            if (editing && field)
                field.value = formatScrub(value);
            else
                paint();
        },
    };
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
//# sourceMappingURL=micro.js.map