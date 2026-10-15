import { projectAnchor } from './layout.js';
import { clusterMarkerRadius } from './cluster-marker.js';
export const SYSTEM_DOCK_DURATION_MS = 200;
/** One moving marker owns both ink and hit geometry, on the unpaused presentation clock. */
export class SystemSurveyDock {
    constructor() {
        this.id = null;
        this.anchor = null;
        this.target = false;
        this.fade = 1;
        this.from = 0;
        this.started = 0;
        this.progress = 0;
    }
    update(frame, topology, coordinates, visible, reducedMotion) {
        this.advance(frame, reducedMotion);
        if (this.id === null || (!this.target && this.progress === 0 && frame.galaxyFade >= 1)) {
            this.id = null;
            return null;
        }
        const rec = topology.sceneSystems?.get(this.id), meta = rec && topology.clusterLodMeta.get(rec.clusterId);
        if (!rec || !meta) {
            this.id = null;
            this.progress = this.from = 0;
            this.target = false;
            return null;
        }
        this.anchor ?? (this.anchor = { meta: { ...meta, systemIds: [] }, x: 0, y: 0, radius: 24, span: 300, depth: 0, label: true, left: 0, top: 0, rgb: [0.65, 0.83, 0.94] });
        const a = this.anchor;
        a.systemId = this.id;
        a.meta.clusterId = rec.clusterId;
        a.meta.name = rec.name;
        a.meta.x = rec.x;
        a.meta.z = rec.z;
        a.meta.radius = meta.radius / Math.sqrt(Math.max(1, meta.systemIds.length));
        this.project(a, frame, coordinates, visible);
        return a;
    }
    advance(frame, reducedMotion) {
        const now = frame.presentationMs;
        this.sample(now);
        // Fade direction expresses enter/exit, including wheel entry and interrupted camera flights.
        // Equal samples retain intent; changing focus inside the system keeps its dock fixed.
        let target = this.target;
        if (frame.systemId === null || frame.galaxyFade > this.fade)
            target = false;
        else if (frame.galaxyFade === 0 || frame.galaxyFade < this.fade)
            target = true;
        this.fade = frame.galaxyFade;
        if (target !== this.target) {
            this.from = this.progress;
            this.started = now;
            this.target = target;
        }
        if (reducedMotion)
            this.progress = target ? 1 : 0;
        if (target)
            this.id = frame.systemId;
    }
    project(a, frame, coordinates, visible) {
        const source = visible.find(value => value.systemId === this.id);
        if (!projectAnchor(a, coordinates.galaxy, frame.cssWidth, frame.cssHeight, frame.cssHeight / (2 * frame.tanHalfFov))) {
            a.x = frame.cssWidth / 2;
            a.y = frame.cssHeight / 2;
        }
        const radius = source?.label ? Math.max(22, source.radius) : clusterMarkerRadius(a.span);
        const t = this.progress;
        a.x += (Math.max(158, frame.cssWidth / 2) - a.x) * t;
        a.y += (Math.max(82, frame.cssHeight - 100) - a.y) * t;
        a.radius = radius + (24 - radius) * t;
        a.span += (300 - a.span) * t;
        a.label = t > 0 || (source?.label ?? true);
    }
    sample(now) {
        const t = Math.max(0, Math.min(1, (now - this.started) / SYSTEM_DOCK_DURATION_MS));
        this.progress = this.from + ((this.target ? 1 : 0) - this.from) * t * t * (3 - 2 * t);
    }
}
//# sourceMappingURL=system-dock.js.map