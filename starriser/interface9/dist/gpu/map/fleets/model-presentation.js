/** Jewel hull vs triangle: fleet flags + a zoom constant. CPU does not pack ship lists. */
import { sceneHullsOn } from "./directed-present.wgsl.js";
export class FleetModelPresentation {
    constructor(ports) { this.ports = ports; }
    bindLiveBuffers() {
        const sim = this.ports.ships.getShipSimBuffer();
        const fleets = this.ports.ships.getFleetGpuBuffer();
        this.bindLayer(this.ports.models, sim, fleets);
        this.bindLayer(this.ports.modelsLow, sim, fleets);
    }
    /** Bind live sim/fleet buffers and switch exclusive zoom band. No ship index lists. */
    update(sceneOpen, distance, meshesReady = true) {
        this.bindLiveBuffers();
        const hulls = sceneOpen && meshesReady && sceneHullsOn(distance);
        this.applyBand(hulls);
        return hulls;
    }
    applyBand(hulls) {
        const { models, modelsLow, ships } = this.ports;
        ships.setModelLodActive(hulls);
        models.setHullBand(hulls);
        models.setActive(hulls && models.isReady());
        if (modelsLow) {
            modelsLow.setHullBand(hulls);
            modelsLow.setActive(hulls && modelsLow.isReady());
        }
    }
    bindLayer(layer, sim, fleets) {
        if (!layer)
            return;
        if (sim)
            layer.setShipSimBuffer(sim);
        if (fleets)
            layer.setFleetGpuBuffer(fleets);
    }
}
//# sourceMappingURL=model-presentation.js.map