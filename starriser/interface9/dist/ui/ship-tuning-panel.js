import { SHIP_SPEED_MULTIPLIER } from '../lib/ship-runtime/scene-scale.mjs';
// @ts-expect-error declarations live in class-tuning.mjs.d.ts
import { CLASS_NAMES, defaultClassTuning } from "../lib/ship-runtime/class-tuning.mjs";
import { dragMark, ensureMicroStyles, microButton, microIconButton, mountDragValue } from "./micro.js";
const COLUMNS = [
    { field: "speed", label: "Spd", min: 0.5, max: 40 * SHIP_SPEED_MULTIPLIER, step: 0.01, title: "Cruise speed, sim units per second" },
    { field: "acceleration", label: "Acc", min: 0.5, max: 60, step: 0.01, title: "Acceleration, sim units per second squared" },
    { field: "turn", label: "Trn", min: 0, max: 8, step: 0.01, title: "Turn rate, radians per second" },
    { field: "repel", label: "Rpl", min: 0.005, max: 16, step: 0.005, title: "Repulsion radius, sim units" },
    { field: "visual", label: "Drw", min: 0.2, max: 30, step: 0.01, title: "Hull draw scale on the base mesh" },
];
const SHORT = ["Int", "Ftr", "Bmb", "Frg", "Btl", "Col"];
/**
 * One command per animation frame. The worker writes the GPU table once,
 * at the start of the next sim frame.
 */
export function buildShipTuningPanel(ctx, actions) {
    ensureMicroStyles();
    const panel = ctx.panel({
        id: "ship-tuning-panel",
        title: "Ships",
        width: 320,
        className: "micro",
    });
    const defaults = defaultClassTuning();
    const rows = defaultClassTuning();
    const cells = [];
    const queued = new Map();
    let frame = 0;
    const flush = () => {
        frame = 0;
        const pending = [...queued.entries()];
        queued.clear();
        for (const [index, patch] of pending)
            actions.setShipTuning?.({ index, ...patch });
    };
    const queue = (index, field, value) => {
        const row = rows[index];
        if (!row || row[field] === value)
            return;
        row[field] = value;
        const patch = queued.get(index) ?? {};
        patch[field] = value;
        queued.set(index, patch);
        if (frame)
            return;
        frame = requestAnimationFrame(flush);
    };
    const apply = (index, field, value) => {
        cells[index]?.[field]?.set(value);
        queue(index, field, value);
    };
    const resetField = (field) => {
        defaults.forEach((row, index) => apply(index, field, row[field]));
    };
    const resetAll = () => {
        for (const column of COLUMNS)
            resetField(column.field);
    };
    const bar = document.createElement("div");
    bar.className = "micro-actions";
    bar.append(microButton("Reset", "Restore every class", resetAll));
    panel.content.appendChild(bar);
    const sheet = document.createElement("div");
    sheet.className = "micro-sheet";
    sheet.appendChild(document.createElement("span"));
    for (const column of COLUMNS) {
        const head = document.createElement("span");
        head.className = "micro-h";
        const name = document.createElement("span");
        name.textContent = column.label;
        name.title = column.title;
        head.append(microIconButton(`Reset ${column.label}`, () => resetField(column.field)), name);
        sheet.appendChild(head);
    }
    CLASS_NAMES.forEach((name, index) => {
        const label = document.createElement("span");
        label.className = "micro-name";
        label.textContent = SHORT[index] ?? name.slice(0, 3);
        label.title = name;
        sheet.appendChild(label);
        const row = rows[index];
        const setters = {};
        cells[index] = setters;
        for (const column of COLUMNS) {
            const cell = document.createElement("div");
            cell.className = "micro-drag";
            cell.title = `${name} ${column.title ?? column.field}. Drag up or down to change. Click to type.`;
            const value = document.createElement("span");
            value.className = "micro-drag-value";
            cell.append(dragMark(), value);
            if (row) {
                setters[column.field] = mountDragValue(cell, {
                    updates: ctx.root.updates,
                    value: row[column.field],
                    min: column.min,
                    max: column.max,
                    step: column.step,
                    onChange: (next) => queue(index, column.field, next),
                });
            }
            sheet.appendChild(cell);
        }
    });
    panel.content.appendChild(sheet);
    const destroy = panel.destroy;
    panel.destroy = () => {
        if (frame)
            cancelAnimationFrame(frame);
        queued.clear();
        for (const row of cells)
            for (const column of COLUMNS)
                row[column.field]?.dispose();
        destroy();
    };
    return { panel };
}
//# sourceMappingURL=ship-tuning-panel.js.map