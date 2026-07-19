/**
 * Duck-typed finalize/clear/fleets surface for App (WebGPU-only).
 * Delegates map work + M4 edit overlays to WebGpuMapView.
 */
import { screenToNdc } from "./math/ground-pick.js";
/**
 * App-facing finalize/clear/fleets surface for workers + fleets.
 * Camera: use WebGpuCameraController (not this shim).
 * Edit handles / rings: delegated to map view (M4).
 */
export class WebGpuRendererShim {
    constructor(view) {
        this.view = view;
        this.renderer = { domElement: view.canvas };
    }
    setStatsPanels(panels) {
        this.view.setStatsPanels(panels ?? null);
    }
    setStats(_stats) {
        // Animate path uses statsPanels via setStatsPanels / map view.
    }
    setCameraController(_c) { }
    setFleetPositionProvider(provider) {
        this.view.setFleetPositionProvider(provider);
    }
    addFleet(id, counts, state) {
        this.view.addFleet(id, counts, state);
    }
    updateFleetState(id, state) {
        this.view.updateFleetState(id, state);
    }
    removeFleet(id) {
        this.view.removeFleet(id);
    }
    clearFleets() {
        this.view.clearFleets();
    }
    setBulkShipBudgetHint(n) {
        this.view.setBulkShipBudgetHint(n);
    }
    reserveFleetCapacity(fleetCount, shipsPerFleet) {
        this.view.reserveFleetCapacity(fleetCount, shipsPerFleet);
    }
    getFleetCount() {
        return this.view.getFleetCount();
    }
    getShipHighWater() {
        return this.view.getShipHighWater();
    }
    getBulkShipBudgetHint() {
        return this.view.getBulkShipBudgetHint();
    }
    finalizeBuffers(galaxy) {
        this.view.finalizeBuffers(galaxy);
    }
    setConnectionColors(colors) {
        if (!colors)
            return;
        this.view.setConnectionColors(colors);
    }
    clear() {
        this.view.clear();
    }
    updateEditOverlayPosition(id, pos) {
        this.view.updateEditOverlayPosition(id, pos);
    }
    refreshConnectionOverlays() { }
    showEditHandles(clusterId, handles, radius) {
        this.view.showEditHandles(clusterId, handles, radius);
    }
    hideEditHandles() {
        this.view.hideEditHandles();
    }
    hasEditHandles() {
        return this.view.hasEditHandles();
    }
    getEditHandleHit(ndcX, ndcY) {
        return this.view.getEditHandleHit(ndcX, ndcY);
    }
    setHoverRing(ring) {
        this.view.setHoverRing(ring);
    }
    setSelectRing(ring) {
        this.view.setSelectRing(ring);
    }
    /** Screen/NDC from the event (matches canvas CSS viewport). */
    getPointerRayFromEvent(event) {
        let x;
        let y;
        if ("touches" in event && event.touches.length > 0) {
            x = event.touches[0].clientX;
            y = event.touches[0].clientY;
        }
        else if ("changedTouches" in event &&
            event.changedTouches.length > 0) {
            const t = event.changedTouches[0];
            x = t.clientX;
            y = t.clientY;
        }
        else {
            const mouseEvent = event;
            x = mouseEvent.clientX;
            y = mouseEvent.clientY;
        }
        const cam = this.view.getCameraState();
        const w = cam.viewportW || window.innerWidth || this.view.canvas.clientWidth || 1;
        const h = cam.viewportH || window.innerHeight || this.view.canvas.clientHeight || 1;
        const ndc = screenToNdc(x, y, w, h);
        return { ndcX: ndc.x, ndcY: ndc.y, screenX: x, screenY: y };
    }
}
/**
 * Placeholder until async WebGpuMapView is ready.
 * Implements PointerCamera so App field typing stays uniform.
 */
export class WebGpuCameraStub {
    constructor() {
        this.isDragging = false;
    }
    onMouseDown(_event) { }
    onMouseMove(_event) { }
    onMouseUp(_event) { }
    getGroundPointFromScreenPosition(_x, _y) {
        return null;
    }
    getPointerRayFromScreenPosition(_x, _y) {
        return {
            origin: { x: 0, y: 0, z: 0 },
            direction: { x: 0, y: -1, z: 0 },
        };
    }
    update(_dtMs) {
        return false;
    }
    getZoomLevel() {
        return null;
    }
    setZoomTarget(_height) { }
    focusOnPoint(_x, _z, _height) { }
}
//# sourceMappingURL=webgpu-renderer-shim.js.map