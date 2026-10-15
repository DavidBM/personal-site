/**
 * Slider form for layered texture parameters: each section edits one nested
 * object (by key, by its own `object` getter, or the top level), with an
 * "enabled" checkbox and optional action buttons in its header. Numbers get a
 * slider and a typed box; `{r, g, b}` colours (0–1) get a colour picker. The
 * form mutates the edited objects and calls `changed`; `refresh` re-reads
 * every value after a preset or reset.
 */
const toHex = (c) => `#${[c.r, c.g, c.b].map((v) => Math.round(Math.min(Math.max(v, 0), 1) * 255).toString(16).padStart(2, "0")).join("")}`;
const fromHex = (hex) => {
    const n = parseInt(hex.slice(1, 7), 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
};
export function createParamForm(root, sections, target, changed) {
    const refreshers = [];
    const objectFor = (section) => (section.object?.() ?? (section.key ? target()[section.key] : target()));
    function numberRow(section, field) {
        const row = document.createElement("label");
        row.className = "param-row";
        const name = document.createElement("span");
        name.textContent = field.label;
        const slider = document.createElement("input");
        slider.type = "range";
        const box = document.createElement("input");
        box.type = "number";
        for (const input of [slider, box]) {
            Object.assign(input, { min: String(field.min), max: String(field.max), step: String(field.step) });
            input.addEventListener("input", () => {
                const v = Number(input.value);
                if (!Number.isFinite(v))
                    return;
                objectFor(section)[field.key] = v;
                (input === slider ? box : slider).value = String(v);
                changed();
            });
        }
        refreshers.push(() => { slider.value = box.value = String(objectFor(section)[field.key]); });
        row.append(name, slider, box);
        return row;
    }
    function colorRow(section, field) {
        const row = document.createElement("label");
        row.className = "param-row";
        const name = document.createElement("span");
        name.textContent = field.label;
        const picker = document.createElement("input");
        picker.type = "color";
        picker.addEventListener("input", () => { objectFor(section)[field.key] = fromHex(picker.value); changed(); });
        refreshers.push(() => { picker.value = toHex(objectFor(section)[field.key]); });
        row.append(name, picker);
        return row;
    }
    for (const section of sections) {
        const details = document.createElement("details");
        details.className = "param-section";
        details.open = !!section.open;
        details.addEventListener("toggle", () => section.onToggle?.(details.open));
        const summary = document.createElement("summary");
        const title = document.createElement("span");
        title.className = "param-title";
        title.textContent = section.label;
        summary.append(title);
        for (const action of section.actions ?? []) {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = action.label;
            b.title = action.title;
            b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); action.onClick(); });
            summary.append(b);
        }
        if ("enabled" in objectFor(section)) {
            const toggle = document.createElement("input");
            toggle.type = "checkbox";
            toggle.title = "Layer on/off";
            toggle.addEventListener("click", (e) => e.stopPropagation());
            toggle.addEventListener("change", () => { objectFor(section).enabled = toggle.checked; changed(); });
            refreshers.push(() => { toggle.checked = !!objectFor(section).enabled; });
            summary.prepend(toggle);
        }
        details.append(summary, ...section.fields.map((f) => ("color" in f ? colorRow(section, f) : numberRow(section, f))));
        root.append(details);
    }
    const refresh = () => { for (const r of refreshers)
        r(); };
    refresh();
    return { refresh };
}
//# sourceMappingURL=param-form.js.map