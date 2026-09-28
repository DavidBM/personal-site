import { bindText, setText } from './ui/dom-bindings.js';
export class UIController {
    constructor(bindings) {
        this.fpsElement = null;
        this.texts = {};
        this.setStatsElements(bindings);
    }
    setStatsElements(bindings) {
        const element = (key, id) => bindings?.[key] ?? document.getElementById(id);
        this.fpsElement = element('fps', 'fps');
        this.statsElements = {
            clusters: element('clusters', 'totalClusters'), systems: element('systems', 'totalSystems'),
            gates: element('gates', 'totalGates'), internalLinks: element('internalLinks', 'internalLinks'),
        };
        this.texts = {};
        for (const [key, element] of Object.entries({ fps: this.fpsElement, ...this.statsElements })) {
            if (element)
                this.texts[key] = bindText(element, { height: '18px', lineHeight: '18px' });
        }
    }
    updateFPS(fps) {
        if (this.texts.fps)
            setText(this.texts.fps, String(fps));
    }
    updateStats(stats) {
        if (this.texts.clusters)
            setText(this.texts.clusters, String(stats.clusters));
        if (this.texts.systems)
            setText(this.texts.systems, String(stats.solarSystems));
        if (this.texts.gates)
            setText(this.texts.gates, String(stats.jumpGates));
        if (this.texts.internalLinks)
            setText(this.texts.internalLinks, String(stats.internalConnections));
    }
}
//# sourceMappingURL=ui-controller.js.map