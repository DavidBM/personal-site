/**
 * Ship picker for the model viewer: category tabs (new / old ships), a second
 * row that depends on the category (game class or old asset set), then every
 * option of that choice as a thumbnail card. New-ship classes also show their
 * concept art. A group with methods shows a pipeline selector whose choice
 * (remembered across classes) picks the cards; groups marked `other` are
 * gathered in one collapsed "Other models" section, open when it holds the
 * selected mesh.
 */
import { VIEWER_CATEGORIES, groupEntries, viewerMeshPlace, } from "./viewer-catalog.js";
const CATEGORY_LABELS = { new: "New ships", old: "Old ships" };
function el(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text != null)
        node.textContent = text;
    return node;
}
function thumbImage(src, alt) {
    const frame = el("span", "card-thumb");
    if (!src)
        return frame;
    const img = el("img", "");
    img.alt = alt;
    img.loading = "lazy";
    img.src = src;
    // Untracked art may be missing on another checkout; keep the card as text.
    img.addEventListener("error", () => img.remove(), { once: true });
    frame.append(img);
    return frame;
}
function tabRow(className, items, active, onPick) {
    const row = el("div", className);
    row.setAttribute("role", "tablist");
    for (const item of items) {
        const tab = el("button", "tab", item.label);
        tab.type = "button";
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", String(item.key === active));
        tab.classList.toggle("empty", item.empty === true);
        tab.addEventListener("click", () => onPick(item.key));
        row.append(tab);
    }
    return row;
}
function card(entry, selected, onPick) {
    const button = el("button", "card");
    button.type = "button";
    button.dataset.mesh = entry.id;
    button.setAttribute("aria-pressed", String(selected));
    button.append(thumbImage(entry.thumb, entry.label), el("span", "card-name", entry.label), el("span", "card-detail", entry.detail));
    button.addEventListener("click", () => onPick(entry.id));
    return button;
}
function cardGrid(entries, selected, onPick) {
    const cards = el("div", "cards");
    cards.append(...entries.map((e) => card(e, e.id === selected, onPick)));
    return cards;
}
function conceptBlock(set) {
    if (!set.concept)
        return null;
    const figure = el("figure", "concept");
    figure.append(thumbImage(set.concept, `${set.name} concept`), el("figcaption", "", `${set.name} · approved concept`));
    return figure;
}
export function createShipPicker(root, initial, onSelect) {
    let selected = initial;
    let { category, set } = viewerMeshPlace(initial);
    /** Method choice per group label, shared by every class. */
    const methodChoice = new Map();
    function currentSet() {
        const sets = VIEWER_CATEGORIES[category];
        return sets.find((s) => s.key === set) ?? sets[0];
    }
    function pickCategory(next) {
        category = next;
        const place = viewerMeshPlace(selected);
        set = place.category === category ? place.set : VIEWER_CATEGORIES[category][0].key;
        render();
    }
    function pickSet(next) {
        set = next;
        render();
    }
    function pickMesh(id) {
        selected = id;
        render();
        onSelect(id);
    }
    function methodGroup(group) {
        const methods = group.methods;
        const holding = methods.find((m) => m.entries.some((e) => e.id === selected));
        const key = methodChoice.get(group.label) ?? holding?.key ?? methods[0].key;
        const method = methods.find((m) => m.key === key) ?? methods[0];
        const switcher = tabRow("tabs method-tabs", methods.map((m) => ({ key: m.key, label: m.label })), method.key, (next) => {
            methodChoice.set(group.label, next);
            render();
        });
        return [el("h2", "group-title", group.label), switcher, el("p", "group-note", method.note), cardGrid(method.entries, selected, pickMesh)];
    }
    function plainGroup(group, heading = "h2") {
        const parts = [el(heading, heading === "h2" ? "group-title" : "subgroup-title", group.label)];
        if (group.note)
            parts.push(el("p", "group-note", group.note));
        parts.push(cardGrid(group.entries, selected, pickMesh));
        return parts;
    }
    function otherSection(groups) {
        if (!groups.length)
            return null;
        const details = el("details", "other-models");
        details.open = groups.some((g) => groupEntries(g).some((e) => e.id === selected));
        const count = groups.reduce((n, g) => n + groupEntries(g).length, 0);
        details.append(el("summary", "group-title", `Other models (${count})`));
        for (const group of groups)
            details.append(...plainGroup(group, "h3"));
        return details;
    }
    function options(shipSet) {
        const list = el("div", "options");
        const concept = conceptBlock(shipSet);
        if (concept)
            list.append(concept);
        if (shipSet.groups.length === 0)
            list.append(el("p", "empty-note", "No 3D models for this class yet."));
        for (const group of shipSet.groups.filter((g) => !g.other))
            list.append(...(group.methods ? methodGroup(group) : plainGroup(group)));
        const other = otherSection(shipSet.groups.filter((g) => g.other));
        if (other)
            list.append(other);
        return list;
    }
    function render() {
        const shipSet = currentSet();
        const sets = VIEWER_CATEGORIES[category].map((s) => ({ key: s.key, label: s.name, empty: s.groups.length === 0 }));
        root.replaceChildren(tabRow("tabs category-tabs", ["new", "old"].map((k) => ({ key: k, label: CATEGORY_LABELS[k] })), category, pickCategory), tabRow("tabs set-tabs", sets, shipSet.key, pickSet), options(shipSet));
    }
    render();
    return {
        setSelected(id) {
            selected = id;
            ({ category, set } = viewerMeshPlace(id));
            render();
        },
    };
}
//# sourceMappingURL=ship-picker.js.map