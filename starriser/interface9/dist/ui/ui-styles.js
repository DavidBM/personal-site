const UI_STYLE_ID = "ui-kit-styles";
export function ensureUIStyles() {
    if (document.getElementById(UI_STYLE_ID))
        return;
    const style = document.createElement("style");
    style.id = UI_STYLE_ID;
    style.textContent = `
.ui-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1000;
  --ui-accent: #94cdd5;
  --ui-border: rgba(126, 171, 191, 0.28);
  --ui-muted: #91a7b9;
  color-scheme: dark;
  font-variant-numeric: tabular-nums;
  color: #d8e6ee;
  font-family: "Fira Mono", "Menlo", "Monaco", "Consolas", monospace;
}
.ui-root [hidden] { display:none !important; }
.ui-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.ui-panel {
  contain: layout style; min-width:0; box-sizing:border-box;
  background: linear-gradient(135deg, rgba(23, 48, 63, 0.18), transparent 160px), rgba(5, 13, 22, 0.98);
  border: 1px solid var(--ui-border);
  border-top-color: rgba(144, 201, 213, 0.48);
  border-radius: 3px;
  padding: 10px;
  box-shadow: inset 0 1px rgba(193, 238, 243, 0.025), 0 4px 14px rgba(0, 0, 0, 0.22);
  pointer-events: auto;
}
.ui-panel-title {
  margin: 0 0 8px 0;
  font-size: 11px;
  line-height: 18px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #b6d6df;
  padding-bottom: 5px;
  border-bottom: 1px solid rgba(126, 171, 191, 0.16);
}
.ui-panel-content {
  min-width:0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ui-grid {
  display: grid;
  gap: 6px 10px;
  grid-template-columns: repeat(var(--ui-columns, 1), minmax(0, 1fr));
}
.ui-row {
  min-width:0;
  display: grid;
  gap: 8px;
  align-items: center;
  grid-template-columns: var(--ui-row-columns, minmax(0, 1fr) auto);
}
.ui-row > * {min-width:0;}
.ui-label {
  font-size: 12px;
  color: #9eb2c9;
}
.ui-input,
.ui-select {
  background: #0b1a26;
  border: 1px solid var(--ui-border);
  color: #dce8f6;
  padding: 4px 6px;
  border-radius: 2px;
  font-size: 12px;
}
.ui-button {
  background: #132b3a;
  color: #d8e6ee;
  border: 1px solid var(--ui-border);
  padding: 5px 8px;
  border-radius: 2px;
  cursor: pointer;
  font-size: 12px;
}
.ui-button:hover {
  background: #203d4c;
}
.ui-checkbox {
  accent-color: var(--ui-accent);
}
.ui-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-size: 12px;
  border-radius: 2px;
  background: rgba(26, 61, 102, 0.7);
  color: #ffffff;
}
.ui-sidebar {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: auto;
}
.ui-sidebar button {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(20, 30, 45, 0.8);
  border: 1px solid var(--ui-border);
  color: #dce8f6;
  cursor: pointer;
}
.ui-floating {
  position: absolute;
  pointer-events: auto;
}
.ui-draggable {
  cursor: move;
}
.ui-image {
  max-width: 100%;
  border-radius: 2px;
}
.ui-muted {
  color: var(--ui-muted);
}
/* Static accents only: no blur, animation, or per-value compositing layers. */
.ui-root :where(button, input, select, summary, textarea):focus-visible {
  outline: 1px solid var(--ui-accent); outline-offset: 2px;
}
.ui-root :where(input[type="range"], input[type="checkbox"]) { accent-color: var(--ui-accent); }
.ui-root :where(button, summary) { touch-action: manipulation; }
.ui-root summary { cursor: pointer; color: #adbecd; padding: 4px 0; }
.ui-root details > summary::marker { color: #7ca4b2; }
.ui-root button:disabled { opacity: 0.5; cursor: default; }
.ui-root ::selection { background: #365866; color: #fff; }
.ui-root * { scrollbar-width: thin; scrollbar-color: #385060 #0a1420; }
`;
    document.head.appendChild(style);
}
//# sourceMappingURL=ui-styles.js.map