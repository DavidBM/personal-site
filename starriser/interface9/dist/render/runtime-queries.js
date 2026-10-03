/** Explicit worker observations. Core measurement owns its success/failure lifecycle. */
import { renderSnapshot, sceneDiagnostics, sceneFleetPage } from "./runtime-state.js";
import { pickRuntimeSceneTarget, pickRuntimeFleetHalo } from './scene-picking.js';
export async function queryRenderRuntime(state, query, remote = []) {
    switch (query.type) {
        case 'followDiagnostics': return state.view.followDiagnostics();
        case "qualitySample": return state.view.sampleQualityDiagnostics();
        case "snapshot": return renderSnapshot(state, remote);
        case "measureFrame": return state.view.measureOneFrameEndToEndMs();
        case "measureFrameTimings": return state.view.measureFrameTimings();
        case "pickShip": return state.view.pickRandomShipPose();
        case "fleetSlot": return state.view.readFleetGpuSlot(query.id);
        case "pickSceneTarget": return pickRuntimeSceneTarget(state, remote, query.x, query.y);
        case "fleetShipTypes": {
            const renderId = state.sceneFleetRenderIds.get(query.id) ?? query.id;
            return { id: query.id, types: state.view.sceneShipTypes(renderId) };
        }
        case "pickFleetHalo": return pickRuntimeFleetHalo(state, query.x, query.y);
        case 'battleProbe': return state.view.battleProbe(query.attacker, query.defender);
        case "kernelFleetMap": return state.view.kernelFleetMap?.() ?? [];
        case "sceneFleetPage": return sceneFleetPage(state, remote, query.offset, query.limit);
        case "sceneDiagnostics": return sceneDiagnostics(state);
        case "colorReadback": return captureColor(state);
    }
}
async function captureColor(state) {
    state.view.stopLoop();
    let completed = false;
    try {
        state.view.enableColorReadback();
        // Strict diagnostic rendering propagates encode errors instead of reading an old target.
        await state.view.measureOneFrameEndToEndMs();
        const color = await state.view.readbackColorOnce();
        completed = true;
        return color;
    }
    finally {
        state.view.disableColorReadback();
        if (completed && state.running && !state.view.isDeviceLost())
            state.view.startRenderLoop();
    }
}
//# sourceMappingURL=runtime-queries.js.map