import { bindText, setText } from './dom-bindings.js';
import { createFleetCard } from './fleet-card.js';
function createStatLine(ctx, parent, id, label) {
    const row = ctx.row({
        id: `${id}-row`,
        parent,
        template: "minmax(0, 1fr) 12ch",
    });
    // Preserve ctx.row's fixed value track: contained text has no intrinsic width.
    Object.assign(row.element.style, {
        height: "18px", contain: "layout paint", overflow: "hidden", whiteSpace: "nowrap",
    });
    ctx.text({
        id: `${id}-label`,
        parent: row.element,
        text: label,
        className: "ui-label",
    });
    const value = ctx.text({
        id: `${id}-value`,
        parent: row.element,
        text: "0",
        inline: true,
    });
    if (!(value.element instanceof HTMLSpanElement)) {
        throw new Error(`Expected span element for ${id} value`);
    }
    value.element.style.cssText += "overflow:clip;white-space:nowrap;text-align:right;font-size:11px;font-variant-numeric:tabular-nums";
    return value.element;
}
function createSection(ctx, parent, id, title) {
    const wrap = ctx.container({
        id: `${id}-section`,
        parent,
    });
    wrap.element.style.display = "flex";
    wrap.element.style.flexDirection = "column";
    wrap.element.style.gap = "4px";
    wrap.element.style.marginTop = "4px";
    wrap.element.style.paddingTop = "8px";
    wrap.element.style.borderTop = "1px solid rgba(100, 140, 180, 0.2)";
    const heading = ctx.text({
        id: `${id}-heading`,
        parent: wrap.element,
        text: title,
        className: "ui-label",
    });
    heading.element.style.fontSize = "11px";
    heading.element.style.letterSpacing = "0.08em";
    heading.element.style.textTransform = "uppercase";
    heading.element.style.color = "#c9d8ee";
    heading.element.style.marginBottom = "2px";
    return wrap.element;
}
/**
 * Single top-right panel: galaxy map stats + live simulation totals + fleet list.
 * (Previously fleets were a second absolute panel that overlapped Stats.)
 */
export function buildEditorStatsPanel(ctx) {
    const statsPanel = ctx.panel({
        id: "stats-panel",
        title: "Stats",
        width: 300,
    });
    statsPanel.element.style.position = "absolute";
    statsPanel.element.style.top = "12px";
    statsPanel.element.style.right = "12px";
    statsPanel.element.style.maxHeight = "calc(100vh - 24px)";
    statsPanel.element.style.overflowY = "auto";
    // --- Galaxy (map) ---
    const galaxySection = createSection(ctx, statsPanel.content, "galaxy", "Galaxy");
    // First section: no top border (panel title already separates).
    galaxySection.style.borderTop = "none";
    galaxySection.style.paddingTop = "0";
    galaxySection.style.marginTop = "0";
    const totalClusters = createStatLine(ctx, galaxySection, "totalClusters", "Clusters:");
    const totalSystems = createStatLine(ctx, galaxySection, "totalSystems", "Solar Systems:");
    const totalGates = createStatLine(ctx, galaxySection, "totalGates", "Jump Gates:");
    const internalLinks = createStatLine(ctx, galaxySection, "internalLinks", "Internal Links:");
    // --- Simulation (fleets / ships) ---
    const simSection = createSection(ctx, statsPanel.content, "simulation", "Simulation");
    const simFleets = createStatLine(ctx, simSection, "simFleets", "Fleets:");
    const simShips = createStatLine(ctx, simSection, "simShips", "Ships (total):");
    const simRed = createStatLine(ctx, simSection, "simRed", "  Red:");
    const simBlue = createStatLine(ctx, simSection, "simBlue", "  Blue:");
    const simGreen = createStatLine(ctx, simSection, "simGreen", "  Green:");
    const simJumping = createStatLine(ctx, simSection, "simJumping", "Jumping:");
    const simCooldown = createStatLine(ctx, simSection, "simCooldown", "Cooldown:");
    const simAwaiting = createStatLine(ctx, simSection, "simAwaiting", "Awaiting:");
    // --- Fleet list ---
    const fleetsSection = createSection(ctx, statsPanel.content, "fleets", "Fleets");
    const fleetList = ctx.container({
        id: "fleets-list",
        parent: fleetsSection,
    });
    fleetList.element.style.display = "flex";
    fleetList.element.style.flexDirection = "column";
    fleetList.element.style.gap = "6px";
    fleetList.element.style.maxHeight = "200px";
    fleetList.element.style.overflowY = "auto";
    const fleetEmpty = ctx.text({
        id: "fleets-empty",
        parent: fleetList.element,
        text: "No fleets active.",
        muted: true,
    }).element;
    const simTexts = new Map([simFleets, simShips, simRed, simBlue, simGreen, simJumping, simCooldown, simAwaiting]
        .map(element => [element, ctx.root.updates.number(bindText(element, { height: '18px', lineHeight: '18px' }))]));
    const setSimText = (element, n) => simTexts.get(element).queue(n);
    // Throttle O(n) sim totals at mass scale so list rAF does not walk 50k maps
    // every batch during bulk add (fleet count still updates every paint).
    let totShips = 0;
    let totRed = 0;
    let totBlue = 0;
    let totGreen = 0;
    let totJumping = 0;
    let totCooldown = 0;
    let totAwaiting = 0;
    let lastTotalsAt = 0;
    const TOTALS_MIN_MS = 250;
    const recomputeTotals = (fleets) => {
        totShips = totRed = totBlue = totGreen = 0;
        totJumping = totCooldown = totAwaiting = 0;
        for (const data of fleets.values()) {
            totRed += data.counts.red;
            totBlue += data.counts.blue;
            totGreen += data.counts.green;
            totShips += data.counts.red + data.counts.blue + data.counts.green;
            if (data.state.state === "jumping")
                totJumping++;
            else if (data.state.state === "cooldown")
                totCooldown++;
            else
                totAwaiting++;
        }
        lastTotalsAt = performance.now();
    };
    const summary = document.createElement("span");
    summary.className = "ui-label";
    const summaryText = bindText(summary);
    const cards = new Map();
    let listMode = "";
    const render = (fleets) => {
        const now = performance.now();
        // ≤1000: always accurate. Larger: recompute at most every TOTALS_MIN_MS.
        const force = fleets.size === 0 ||
            fleets.size <= 1000 ||
            now - lastTotalsAt >= TOTALS_MIN_MS;
        if (force)
            recomputeTotals(fleets);
        setSimText(simFleets, fleets.size);
        setSimText(simShips, totShips);
        setSimText(simRed, totRed);
        setSimText(simBlue, totBlue);
        setSimText(simGreen, totGreen);
        setSimText(simJumping, totJumping);
        setSimText(simCooldown, totCooldown);
        setSimText(simAwaiting, totAwaiting);
        renderList(fleets);
    };
    function renderList(fleets) {
        const fleetCount = fleets.size;
        const mode = fleetCount === 0 ? "empty" : fleetCount > 10 ? "summary" : "cards";
        if (mode !== listMode) {
            fleetList.element.replaceChildren();
            cards.clear();
            listMode = mode;
            if (mode === "empty")
                fleetList.element.appendChild(fleetEmpty);
            if (mode === "summary")
                fleetList.element.appendChild(summary);
        }
        if (mode === "empty")
            return;
        if (mode === "summary") {
            const text = `${fleetCount} active (list collapsed)`;
            setText(summaryText, text);
            return;
        }
        renderCards(fleets);
    }
    function renderCards(fleets) {
        for (const [id, row] of cards)
            if (!fleets.has(id)) {
                row.element.remove();
                cards.delete(id);
            }
        let cursor = fleetList.element.firstChild;
        const entries = Array.from(fleets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        for (const [id, data] of entries) {
            let row = cards.get(id);
            if (!row) {
                const element = document.createElement('div');
                element.className = 'fleet-card';
                row = createFleetCard(element);
                cards.set(id, row);
            }
            row.update({ id, relationship: data.relationship, shipCount: data.counts.red + data.counts.blue + data.counts.green, state: data.state.state,
                micro: 'Open its system for live visual activity',
                action: data.state.state === 'awaiting' && data.state.localMove ? 'Move order' : undefined });
            if (cursor !== row.element)
                fleetList.element.insertBefore(row.element, cursor);
            cursor = row.element.nextSibling;
        }
    }
    const destroy = statsPanel.destroy;
    statsPanel.destroy = () => {
        for (const binding of simTexts.values())
            binding.dispose();
        cards.clear();
        destroy();
    };
    // Initial zeros for simulation section
    render(new Map());
    return {
        panel: statsPanel,
        stats: {
            container: statsPanel.content,
            clusters: totalClusters,
            systems: totalSystems,
            gates: totalGates,
            internalLinks,
        },
        fleets: {
            render,
        },
    };
}
//# sourceMappingURL=editor-stats-panel.js.map