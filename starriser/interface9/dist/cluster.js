import * as THREE from "./vendor/three.js";
/**
 * Visual/Rendering cluster entity. NOT domain logic.
 */
export class Cluster {
    constructor({ id, name, position, color, radius, maxSystemDistance }, galaxy) {
        this._editDragMode = null;
        this._editDragStart = null;
        this._editOrigin = null;
        this._editHandles = null;
        this.id = id;
        this.name = name;
        this.position =
            position instanceof THREE.Vector3
                ? position
                : new THREE.Vector3(position.x, position.y, position.z);
        this.color = color;
        this.radius = radius;
        this.maxSystemDistance = maxSystemDistance ?? 0;
        this.solarSystems = [];
        this.galaxy = galaxy;
    }
    /**
     * When a handle for this cluster receives a pointer event (down/move/up).
     * Forwards to Galaxy, which delegates to the app-injected handler.
     * @param {Object} evt - pointer event info { type, handleId, ... }
     */
    editHandlePointerEvent(evt) {
        // Logic:
        // On pointer down, store drag mode: "xz" by default, "y" if altKey is pressed.
        // On move, send drag intent along that axis.
        // (Pass key_state through evt if available; otherwise default to "xz".)
        if (!this._editDragMode && evt.type === "down") {
            this._editDragMode = "xz";
            this._editDragStart = { screenX: evt.screenX, screenY: evt.screenY };
            this._editOrigin = {
                x: this.position.x,
                y: this.position.y,
                z: this.position.z,
            };
        }
        if (this._editDragMode && (evt.type === "down" || evt.type === "move")) {
            this.galaxy.dispatchClusterEditPointer({
                cluster: this,
                ...evt,
                editDragMode: this._editDragMode,
            });
        }
        if (evt.type === "up") {
            this.galaxy.dispatchClusterEditPointer({
                cluster: this,
                ...evt,
                editDragMode: this._editDragMode ?? "xz",
            });
            this._editDragMode = null;
            this._editDragStart = null;
            this._editOrigin = null;
        }
    }
    /**
     * Add a solar system to this cluster.
     * (Cluster-level state only; global lookup map and renderer are handled by Galaxy)
     * Always call via Galaxy.addSolarSystem for full management!
     * @param {SolarSystem} solarSystem
     */
    addSolarSystem(solarSystem) {
        this.solarSystems.push(solarSystem);
        solarSystem.cluster = this;
    }
    /**
     * Look up a solar system in this cluster by its id.
     * @param {string|number} solarSystemId
     * @returns {SolarSystem|null}
     */
    getSolarSystemById(solarSystemId) {
        return this.solarSystems.find((ss) => ss.id === solarSystemId) || null;
    }
    removeSolarSystem(solarSystem) {
        const idx = this.solarSystems.indexOf(solarSystem);
        if (idx !== -1) {
            this.solarSystems.splice(idx, 1);
            solarSystem.dispose();
        }
    }
    dispose() {
        // Recursively dispose everything
        for (const sys of this.solarSystems)
            sys.dispose();
    }
    /**
     * Show cluster edit handles (for edit mode), rendering via galaxy.renderer.
     * @param {Array} handles
     */
    showEditHandles(handles) {
        this._editHandles = handles;
        this.galaxy.renderer.showEditHandles(this.id, handles);
    }
    /**
     * Hide/clear cluster edit handles.
     */
    hideEditHandles() {
        this._editHandles = null;
        this.galaxy.renderer.hideEditHandles();
    }
}
//# sourceMappingURL=cluster.js.map