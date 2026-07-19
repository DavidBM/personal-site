/**
 * Latency-sensitive edit-handle hit-test + bus publish.
 * Path: pointer → renderer hit → pack → bus (no Galaxy/Cluster hop).
 */
import { packEditHandlePointer, } from "./cluster-edit-pointer.js";
/**
 * Create an edit-handle pointer session for the main-thread input router.
 */
export function createEditHandlePointerController(options) {
    const { target, camera, getFallbackClusterId, publish } = options;
    let activeClusterId = null;
    let downHandle = null;
    let downHandleKind = null;
    const resolveClusterId = (hitClusterId) => hitClusterId ?? activeClusterId ?? getFallbackClusterId();
    const publishHandle = (type, screenX, screenY, ndcX, ndcY, handleId, handleKind, clusterId) => {
        publish(packEditHandlePointer({
            type,
            clusterId,
            handleId: handleId ?? undefined,
            handleKind: handleKind ?? undefined,
            screenX,
            screenY,
            ndcX,
            ndcY,
            // Business owns drag math; main only tags default XZ mode.
            editDragMode: "xz",
        }, camera));
    };
    return {
        setActiveClusterId(clusterId) {
            activeClusterId = clusterId;
        },
        handleDown(event) {
            if (!target.hasEditHandles())
                return false;
            const { ndcX, ndcY, screenX, screenY } = target.getPointerRayFromEvent(event);
            const hit = target.getEditHandleHit(ndcX, ndcY);
            if (!hit)
                return false;
            const clusterId = resolveClusterId(hit.clusterId);
            if (clusterId == null)
                return false;
            activeClusterId = clusterId;
            downHandle =
                hit.handleId ?? `edit_cluster_${clusterId}`;
            downHandleKind = hit.handleKind ?? null;
            publishHandle("down", screenX, screenY, ndcX, ndcY, hit.handleId, hit.handleKind, clusterId);
            return true;
        },
        handleMove(event) {
            if (downHandle == null)
                return false;
            const { ndcX, ndcY, screenX, screenY } = target.getPointerRayFromEvent(event);
            const clusterId = resolveClusterId();
            if (clusterId == null)
                return true;
            publishHandle("move", screenX, screenY, ndcX, ndcY, downHandle, downHandleKind ?? undefined, clusterId);
            return true;
        },
        handleUp(event) {
            if (downHandle == null)
                return false;
            const { ndcX, ndcY, screenX, screenY } = target.getPointerRayFromEvent(event);
            const clusterId = resolveClusterId();
            if (clusterId != null) {
                publishHandle("up", screenX, screenY, ndcX, ndcY, downHandle, downHandleKind ?? undefined, clusterId);
            }
            downHandle = null;
            downHandleKind = null;
            return true;
        },
    };
}
//# sourceMappingURL=edit-handle-pointer.js.map