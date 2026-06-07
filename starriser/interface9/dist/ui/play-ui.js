export function buildPlayUIPanels(ctx) {
    ctx.sidebar({
        id: "play-sidebar",
        items: [
            { id: "nav", icon: "N", title: "Navigation" },
            { id: "fleet", icon: "F", title: "Fleet" },
            { id: "intel", icon: "I", title: "Intel" },
            { id: "market", icon: "M", title: "Market" },
        ],
    });
    const statusPanel = ctx.panel({
        id: "play-status",
        title: "Command Feed",
        width: 280,
    });
    statusPanel.element.style.position = "absolute";
    statusPanel.element.style.right = "16px";
    statusPanel.element.style.bottom = "16px";
    ctx.text({
        id: "play-status-line-1",
        parent: statusPanel.content,
        text: "Awaiting orders...",
        muted: true,
    });
    ctx.text({
        id: "play-status-line-2",
        parent: statusPanel.content,
        text: "No fleet activity detected.",
        muted: true,
    });
    return {
        panels: {
            status: statusPanel,
        },
    };
}
//# sourceMappingURL=play-ui.js.map