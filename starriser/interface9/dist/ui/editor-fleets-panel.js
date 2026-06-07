export function buildEditorFleetsPanel(ctx) {
    const fleetsPanel = ctx.panel({
        id: "fleets-panel",
        title: "Fleets",
        width: 280,
    });
    fleetsPanel.element.style.position = "absolute";
    fleetsPanel.element.style.top = "220px";
    fleetsPanel.element.style.right = "12px";
    const fleetList = ctx.container({
        id: "fleets-list",
        parent: fleetsPanel.content,
    });
    fleetList.element.style.display = "flex";
    fleetList.element.style.flexDirection = "column";
    fleetList.element.style.gap = "6px";
    fleetList.element.style.maxHeight = "240px";
    fleetList.element.style.overflowY = "auto";
    const fleetEmpty = ctx.text({
        id: "fleets-empty",
        parent: fleetList.element,
        text: "No fleets active.",
        muted: true,
    }).element;
    const render = (fleets) => {
        while (fleetList.element.firstChild) {
            fleetList.element.removeChild(fleetList.element.firstChild);
        }
        const fleetCount = fleets.size;
        if (fleetCount === 0) {
            fleetList.element.appendChild(fleetEmpty);
            return;
        }
        if (fleetCount > 10) {
            const summary = document.createElement("span");
            summary.textContent = `Active fleets: ${fleetCount}`;
            summary.className = "ui-label";
            fleetList.element.appendChild(summary);
            return;
        }
        const entries = Array.from(fleets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        for (const [id, data] of entries) {
            const row = document.createElement("div");
            row.style.display = "flex";
            row.style.flexDirection = "column";
            row.style.gap = "2px";
            const title = document.createElement("span");
            title.textContent = id;
            title.className = "ui-label";
            const status = document.createElement("span");
            status.textContent = describeFleetStatus(data.state, data.counts);
            status.style.opacity = "0.8";
            row.appendChild(title);
            row.appendChild(status);
            fleetList.element.appendChild(row);
        }
    };
    return {
        panel: fleetsPanel,
        fleets: {
            render,
        },
    };
}
function describeFleetStatus(state, counts) {
    const ships = counts.red + counts.blue + counts.green;
    if (state.state === "jumping") {
        return `Jumping (${ships} ships)`;
    }
    if (state.state === "cooldown") {
        return `Cooling down (${ships} ships)`;
    }
    return `Awaiting (${ships} ships)`;
}
//# sourceMappingURL=editor-fleets-panel.js.map