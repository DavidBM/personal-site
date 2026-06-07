const CONTEXT_PICK_MAX_DISTANCE = 600;
export class ClusterContextMenuController {
    constructor(options) {
        this.clusterId = null;
        this.bindings = options.bindings;
        this.getClusters = options.getClusters;
        this.getGroundPoint = options.getGroundPoint;
    }
    getClusterId() {
        return this.clusterId;
    }
    resetAction() {
        this.bindings.select.value = "inspect";
    }
    hide() {
        this.bindings.panel.element.style.display = "none";
        this.clusterId = null;
    }
    show(clusterId, screenX, screenY) {
        const panel = this.bindings.panel.element;
        this.resetAction();
        panel.style.display = "block";
        const rect = panel.getBoundingClientRect();
        const width = rect.width || 180;
        const height = rect.height || 80;
        const maxX = window.innerWidth - width - 12;
        const maxY = window.innerHeight - height - 12;
        const x = Math.max(12, Math.min(screenX, maxX));
        const y = Math.max(12, Math.min(screenY, maxY));
        panel.style.left = `${x}px`;
        panel.style.top = `${y}px`;
        this.clusterId = clusterId;
    }
    pick(screenX, screenY) {
        const ground = this.getGroundPoint(screenX, screenY);
        if (!ground)
            return null;
        let closest = null;
        let closestDist = Infinity;
        for (const cluster of this.getClusters()) {
            const dx = cluster.position.x - ground.x;
            const dz = cluster.position.z - ground.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < closestDist) {
                closestDist = dist;
                closest = cluster;
            }
        }
        if (!closest || closestDist > CONTEXT_PICK_MAX_DISTANCE)
            return null;
        return {
            cluster: closest,
            ground: { x: ground.x, y: ground.y, z: ground.z },
        };
    }
    pickAndShow(screenX, screenY) {
        const pick = this.pick(screenX, screenY);
        if (!pick) {
            this.hide();
            return null;
        }
        this.show(pick.cluster.id, screenX, screenY);
        return pick;
    }
}
//# sourceMappingURL=cluster-context-menu-controller.js.map