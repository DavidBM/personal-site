export class UIController {
    constructor(app, bindings) {
        this.app = app;
        this.fpsElement =
            bindings?.fps ?? document.getElementById("fps");
        this.statsElements = {
            clusters: bindings?.clusters ??
                document.getElementById("totalClusters"),
            systems: bindings?.systems ??
                document.getElementById("totalSystems"),
            gates: bindings?.gates ??
                document.getElementById("totalGates"),
            internalLinks: bindings?.internalLinks ??
                document.getElementById("internalLinks"),
        };
    }
    setStatsElements(bindings) {
        this.fpsElement =
            bindings?.fps ?? document.getElementById("fps");
        this.statsElements = {
            clusters: bindings?.clusters ??
                document.getElementById("totalClusters"),
            systems: bindings?.systems ??
                document.getElementById("totalSystems"),
            gates: bindings?.gates ??
                document.getElementById("totalGates"),
            internalLinks: bindings?.internalLinks ??
                document.getElementById("internalLinks"),
        };
    }
    updateFPS(fps) {
        if (this.fpsElement) {
            this.fpsElement.textContent = String(fps);
        }
    }
    updateStats(stats) {
        if (this.statsElements.clusters) {
            this.statsElements.clusters.textContent = String(stats.clusters);
        }
        if (this.statsElements.systems) {
            this.statsElements.systems.textContent = String(stats.solarSystems);
        }
        if (this.statsElements.gates) {
            this.statsElements.gates.textContent = String(stats.jumpGates);
        }
        if (this.statsElements.internalLinks) {
            this.statsElements.internalLinks.textContent = String(stats.internalConnections);
        }
    }
}
//# sourceMappingURL=ui-controller.js.map