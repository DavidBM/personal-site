const UI_STYLE_ID = "ui-kit-styles";
function ensureUIStyles() {
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
  color: #e6f1ff;
  font-family: "Fira Mono", "Menlo", "Monaco", "Consolas", monospace;
}
.ui-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.ui-panel {
  background: rgba(0, 0, 0, 0.72);
  border: 1px solid rgba(100, 140, 180, 0.25);
  border-radius: 6px;
  padding: 12px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
}
.ui-panel-title {
  margin: 0 0 8px 0;
  font-size: 13px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #c9d8ee;
}
.ui-panel-content {
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
  display: grid;
  gap: 8px;
  align-items: center;
  grid-template-columns: var(--ui-row-columns, minmax(0, 1fr) auto);
}
.ui-label {
  font-size: 12px;
  color: #9eb2c9;
}
.ui-input,
.ui-select {
  background: #0d1826;
  border: 1px solid rgba(120, 160, 200, 0.4);
  color: #dce8f6;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 12px;
}
.ui-button {
  background: #1a3d66;
  color: #ffffff;
  border: none;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.ui-button:hover {
  background: #2a5d96;
}
.ui-checkbox {
  accent-color: #2a5d96;
}
.ui-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-size: 12px;
  border-radius: 4px;
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
  border: 1px solid rgba(120, 160, 200, 0.4);
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
  border-radius: 4px;
}
.ui-muted {
  color: #7f97b6;
}
`;
    document.head.appendChild(style);
}
function clampColumns(columns) {
    if (!columns)
        return 1;
    if (columns < 1)
        return 1;
    if (columns > 6)
        return 6;
    return Math.floor(columns);
}
function createRootElement(rootId, host) {
    const existing = document.getElementById(rootId);
    if (existing) {
        existing.classList.add("ui-root");
        return existing;
    }
    const root = document.createElement("div");
    root.id = rootId;
    root.className = "ui-root";
    host.appendChild(root);
    return root;
}
function makeDraggable(target, handle) {
    const dragHandle = handle ?? target;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    const onPointerMove = (event) => {
        if (!dragging)
            return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        target.style.left = `${originLeft + dx}px`;
        target.style.top = `${originTop + dy}px`;
    };
    const onPointerUp = () => {
        if (!dragging)
            return;
        dragging = false;
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
    };
    dragHandle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0)
            return;
        const rect = target.getBoundingClientRect();
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        originLeft = rect.left;
        originTop = rect.top;
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
        event.preventDefault();
    });
}
export function createUIRoot(options) {
    ensureUIStyles();
    const host = options?.host ?? document.body;
    const rootId = options?.id ?? "ui-root";
    const root = createRootElement(rootId, host);
    const panelLayer = root.querySelector(".ui-layer.ui-panel-layer") ??
        document.createElement("div");
    panelLayer.className = "ui-layer ui-panel-layer";
    const overlayLayer = root.querySelector(".ui-layer.ui-overlay-layer") ??
        document.createElement("div");
    overlayLayer.className = "ui-layer ui-overlay-layer";
    if (!panelLayer.parentElement)
        root.appendChild(panelLayer);
    if (!overlayLayer.parentElement)
        root.appendChild(overlayLayer);
    const components = [];
    return {
        root,
        panelLayer,
        overlayLayer,
        register(component) {
            components.push(component);
        },
        list() {
            return components.slice();
        },
        clear() {
            while (components.length) {
                const component = components.pop();
                if (component) {
                    component.destroy();
                }
            }
            panelLayer.innerHTML = "";
            overlayLayer.innerHTML = "";
        },
    };
}
function finalizeComponent(root, component, parent) {
    parent.appendChild(component.element);
    root.register(component);
    return component;
}
export function createUIContext(root) {
    return {
        root,
        panel(options) {
            const columns = clampColumns(options.columns);
            const panel = document.createElement("div");
            panel.className = `ui-panel${options.className ? ` ${options.className}` : ""}`;
            if (options.width) {
                panel.style.width = `${options.width}px`;
            }
            if (options.floating) {
                panel.classList.add("ui-floating");
                const pos = options.position ?? {
                    x: window.innerWidth * 0.5 - 120,
                    y: window.innerHeight * 0.5 - 60,
                };
                panel.style.left = `${pos.x}px`;
                panel.style.top = `${pos.y}px`;
            }
            if (options.title) {
                const title = document.createElement("h2");
                title.className = "ui-panel-title";
                title.textContent = options.title;
                panel.appendChild(title);
            }
            const content = document.createElement("div");
            content.className = "ui-panel-content";
            if (columns > 1) {
                content.classList.add("ui-grid");
                content.style.setProperty("--ui-columns", String(columns));
            }
            panel.appendChild(content);
            if (options.draggable) {
                panel.classList.add("ui-draggable");
                makeDraggable(panel, options.title ? (panel.querySelector("h2") ?? panel) : panel);
            }
            const parent = options.parent ??
                (options.floating ? root.overlayLayer : root.panelLayer);
            const component = {
                id: options.id,
                kind: "panel",
                element: panel,
                content,
                destroy: () => {
                    panel.remove();
                },
            };
            return finalizeComponent(root, component, parent);
        },
        container(options) {
            const element = document.createElement("div");
            element.className = options.className ?? "";
            if (options.width) {
                element.style.width = `${options.width}px`;
            }
            if (options.floating) {
                element.classList.add("ui-floating");
                const pos = options.position ?? {
                    x: window.innerWidth * 0.5 - 120,
                    y: window.innerHeight * 0.5 - 60,
                };
                element.style.left = `${pos.x}px`;
                element.style.top = `${pos.y}px`;
            }
            if (options.draggable) {
                element.classList.add("ui-draggable");
                makeDraggable(element);
            }
            const parent = options.parent ??
                (options.floating ? root.overlayLayer : root.panelLayer);
            const component = {
                id: options.id,
                kind: "container",
                element,
                destroy: () => {
                    element.remove();
                },
            };
            return finalizeComponent(root, component, parent);
        },
        row(options) {
            const row = document.createElement("div");
            row.className = `ui-row${options.className ? ` ${options.className}` : ""}`;
            if (options.template) {
                row.style.gridTemplateColumns = options.template;
            }
            else if (options.columns && options.columns > 1) {
                row.style.gridTemplateColumns = `repeat(${clampColumns(options.columns)}, minmax(0, 1fr))`;
            }
            const parent = options.parent ?? root.panelLayer;
            const component = {
                id: options.id,
                kind: "container",
                element: row,
                destroy: () => {
                    row.remove();
                },
            };
            return finalizeComponent(root, component, parent);
        },
        text(options) {
            const element = document.createElement(options.inline ? "span" : "div");
            element.className = options.className ?? "";
            if (options.muted)
                element.classList.add("ui-muted");
            element.textContent = options.text;
            const parent = options.parent ?? root.panelLayer;
            const component = {
                id: options.id,
                kind: "text",
                element,
                destroy: () => {
                    element.remove();
                },
            };
            return finalizeComponent(root, component, parent);
        },
        image(options) {
            const element = document.createElement("img");
            element.className = `ui-image${options.className ? ` ${options.className}` : ""}`;
            element.src = options.src;
            element.alt = options.alt ?? "";
            if (options.width)
                element.width = options.width;
            if (options.height)
                element.height = options.height;
            const parent = options.parent ?? root.panelLayer;
            const component = {
                id: options.id,
                kind: "image",
                element,
                destroy: () => {
                    element.remove();
                },
            };
            return finalizeComponent(root, component, parent);
        },
        icon(options) {
            const element = document.createElement("span");
            element.className = `ui-icon${options.className ? ` ${options.className}` : ""}`;
            element.textContent = options.text;
            const parent = options.parent ?? root.panelLayer;
            const component = {
                id: options.id,
                kind: "icon",
                element,
                destroy: () => {
                    element.remove();
                },
            };
            return finalizeComponent(root, component, parent);
        },
        button(options) {
            const element = document.createElement("button");
            element.type = "button";
            element.className = `ui-button${options.className ? ` ${options.className}` : ""}`;
            element.textContent = options.text;
            if (options.title)
                element.title = options.title;
            if (options.onClick) {
                element.addEventListener("click", options.onClick);
            }
            const parent = options.parent ?? root.panelLayer;
            const component = {
                id: options.id,
                kind: "button",
                element,
                destroy: () => {
                    element.remove();
                },
            };
            return finalizeComponent(root, component, parent);
        },
        checkbox(options) {
            const element = document.createElement("input");
            element.type = "checkbox";
            element.className = `ui-checkbox${options.className ? ` ${options.className}` : ""}`;
            element.checked = options.checked;
            if (options.onChange) {
                element.addEventListener("change", () => {
                    options.onChange?.(element.checked);
                });
            }
            const parent = options.parent ?? root.panelLayer;
            const component = {
                id: options.id,
                kind: "checkbox",
                element,
                destroy: () => {
                    element.remove();
                },
            };
            return finalizeComponent(root, component, parent);
        },
        inputNumber(options) {
            const element = document.createElement("input");
            element.className = `ui-input${options.className ? ` ${options.className}` : ""}`;
            element.type = "text";
            element.inputMode = options.allowFloat === false ? "numeric" : "decimal";
            element.value = String(options.value);
            if (typeof options.min === "number")
                element.min = String(options.min);
            if (typeof options.max === "number")
                element.max = String(options.max);
            if (typeof options.step === "number")
                element.step = String(options.step);
            const allowFloat = options.allowFloat !== false;
            let lastValue = element.value;
            element.addEventListener("input", () => {
                const next = element.value.trim();
                const pattern = allowFloat ? /^-?\d*\.?\d*$/ : /^-?\d*$/;
                if (!pattern.test(next)) {
                    element.value = lastValue;
                    return;
                }
                lastValue = next;
                if (options.onInput)
                    options.onInput(next);
            });
            const parent = options.parent ?? root.panelLayer;
            const component = {
                id: options.id,
                kind: "input",
                element,
                destroy: () => {
                    element.remove();
                },
            };
            return finalizeComponent(root, component, parent);
        },
        select(options) {
            const element = document.createElement("select");
            element.className = `ui-select${options.className ? ` ${options.className}` : ""}`;
            for (const option of options.options) {
                const opt = document.createElement("option");
                opt.value = option.value;
                opt.textContent = option.label;
                element.appendChild(opt);
            }
            if (options.value)
                element.value = options.value;
            if (options.onChange) {
                element.addEventListener("change", () => {
                    options.onChange?.(element.value);
                });
            }
            let parent = options.parent ?? root.panelLayer;
            let wrapper = null;
            if (options.floating) {
                wrapper = document.createElement("div");
                wrapper.className = "ui-panel ui-floating";
                wrapper.appendChild(element);
                const pos = options.position ?? {
                    x: window.innerWidth * 0.5 - 100,
                    y: window.innerHeight * 0.5 - 40,
                };
                wrapper.style.left = `${pos.x}px`;
                wrapper.style.top = `${pos.y}px`;
                parent = root.overlayLayer;
                if (options.draggable) {
                    wrapper.classList.add("ui-draggable");
                    makeDraggable(wrapper);
                }
            }
            const component = {
                id: options.id,
                kind: "select",
                element: wrapper ?? element,
                destroy: () => {
                    (wrapper ?? element).remove();
                },
            };
            finalizeComponent(root, component, parent);
            return component;
        },
        sidebar(options) {
            const element = document.createElement("div");
            element.className = `ui-sidebar${options.className ? ` ${options.className}` : ""}`;
            for (const item of options.items) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.title = item.title ?? "";
                btn.textContent = item.icon;
                if (item.onClick)
                    btn.addEventListener("click", item.onClick);
                element.appendChild(btn);
            }
            const parent = options.parent ?? root.panelLayer;
            const component = {
                id: options.id,
                kind: "sidebar",
                element,
                destroy: () => {
                    element.remove();
                },
            };
            return finalizeComponent(root, component, parent);
        },
    };
}
//# sourceMappingURL=ui-kit.js.map