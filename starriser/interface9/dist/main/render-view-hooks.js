import { renderEditHit } from "./render-picking.js";
import { screenToNdc } from "../gpu/math/ground-pick.js";
function eventPosition(event) {
    const point = "touches" in event ? event.touches[0] ?? event.changedTouches[0] : event;
    return { screenX: point?.clientX ?? 0, screenY: point?.clientY ?? 0 };
}
/** Only UI changes use hooks. Topology crosses once as its original OP batch. */
export function createRenderViewHooks(client, getGalaxy) {
    let edit = null;
    return {
        hooks: {
            onHoveredCluster: (cluster) => client.send({ type: "hover", ring: cluster ? {
                    x: cluster.position.x, z: cluster.position.z, radius: cluster.radius || 400,
                } : null }),
            onSelectedCluster: (cluster) => client.send({ type: "select", ring: cluster ? {
                    x: cluster.position.x, z: cluster.position.z, radius: Math.max(cluster.radius || 400, 200),
                } : null }),
            onShowEditHandles: (clusterId, handles) => {
                edit = { clusterId, handles, radius: getGalaxy().getClusterById(clusterId)?.radius ?? 400 };
                client.send({ type: "showEditHandles", ...edit });
            },
            onHideEditHandles: () => { edit = null; client.send({ type: "hideEditHandles" }); },
        },
        editTarget: {
            hasEditHandles: () => edit != null,
            getEditHandleHit: (ndcX, ndcY) => {
                const snapshot = client.snapshot();
                return snapshot ? renderEditHit({ ...snapshot, edit }, ndcX, ndcY) : null;
            },
            getPointerRayFromEvent: (event) => {
                const { screenX, screenY } = eventPosition(event);
                const rect = client.canvas.getBoundingClientRect();
                const camera = client.snapshot()?.camera;
                const ndc = screenToNdc(screenX - rect.left, screenY - rect.top, camera?.viewportW ?? rect.width, camera?.viewportH ?? rect.height);
                return { ndcX: ndc.x, ndcY: ndc.y, screenX, screenY };
            },
        },
    };
}
//# sourceMappingURL=render-view-hooks.js.map