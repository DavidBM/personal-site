import { Topics, } from "../protocol/topics.js";
import { applyBusinessOps, clearBusinessWorld, hasCluster, } from "./business-world.js";
import { computeConnectionGradient } from "./connection-graph.js";
import { SelectionStore } from "./selection-store.js";
export function createPointerInteractionController({ world, editMode, publish, }) {
    let isProcessingTap = false;
    const handlePointerEvent = (data) => {
        if (!world.clusters.length)
            return;
        const currentlyEditingClusterId = editMode.getEditingClusterId();
        const isEditMode = currentlyEditingClusterId !== null;
        if (isEditMode && typeof data.clusterId === "number") {
            const cluster = world.clusters.find((c) => c.id === data.clusterId);
            if (!cluster) {
                editMode.resetDrag();
            }
            else {
                const editResult = editMode.handlePointerEvent(data, cluster);
                if (editResult.update) {
                    world.clusterIndex.remove(cluster.id);
                    world.clusterIndex.insert(cluster);
                    publish(Topics.updateCluster, editResult.update, 0);
                }
                if (editResult.commit) {
                    publish(Topics.commitClusterMove, editResult.commit, 0);
                }
                if (editResult.consumed) {
                    return;
                }
            }
        }
        if (data.type === "move" || data.type === "tap") {
            const galaxyPosition = data.galaxy_position;
            if (!galaxyPosition)
                return;
            const hit = world.clusterIndex.query(galaxyPosition.x, galaxyPosition.z);
            const withinHoverThreshold = hit.dist <= 3000;
            const withinSelectThreshold = hit.dist <= 600;
            if (data.type === "move") {
                const hoveredId = withinHoverThreshold && hit.item ? hit.item.id : null;
                SelectionStore.setHovered(hoveredId);
            }
            if (data.type === "tap") {
                if (isProcessingTap) {
                    return;
                }
                isProcessingTap = true;
                const currentState = SelectionStore.getState();
                if (!withinSelectThreshold || !hit.item) {
                    if (currentlyEditingClusterId !== null) {
                        publish(Topics.hideEditHandles, {
                            clusterId: currentlyEditingClusterId,
                        });
                    }
                    editMode.setEditingClusterId(null);
                    editMode.clearUIObjects();
                    SelectionStore.setSelected(null);
                }
                else if (currentlyEditingClusterId === hit.item.id) {
                    publish(Topics.hideEditHandles, {
                        clusterId: currentlyEditingClusterId,
                    });
                    editMode.setEditingClusterId(null);
                    editMode.clearUIObjects();
                    const coloring = computeConnectionGradient(hit.item.id, 10, world.lastConnections);
                    publish(Topics.setConnectionColors, coloring);
                    publish(Topics.editModeChanged, {
                        clusterId: hit.item.id,
                        editMode: false,
                    });
                }
                else if (currentState.selectedId === hit.item.id &&
                    currentlyEditingClusterId === null) {
                    editMode.setEditingClusterId(hit.item.id);
                    const handles = editMode.attachUIObjectsForCluster(hit.item);
                    publish(Topics.showEditHandles, {
                        clusterId: hit.item.id,
                        handles,
                    });
                    publish(Topics.setConnectionColors, {});
                    publish(Topics.editModeChanged, {
                        clusterId: hit.item.id,
                        editMode: true,
                    });
                }
                else {
                    if (currentlyEditingClusterId !== null) {
                        publish(Topics.hideEditHandles, {
                            clusterId: currentlyEditingClusterId,
                        });
                    }
                    editMode.setEditingClusterId(null);
                    editMode.clearUIObjects();
                    SelectionStore.setSelected(hit.item.id);
                }
                isProcessingTap = false;
            }
        }
    };
    const handleSelectionChange = ({ hoveredId, selectedId, }) => {
        publish(Topics.updateUIState, { hoveredId, selectedId });
        publish(Topics.selectionChanged, { hoveredId, selectedId });
        if (selectedId != null) {
            const coloring = computeConnectionGradient(selectedId, 10, world.lastConnections);
            publish(Topics.setConnectionColors, coloring);
            publish(Topics.connectionsColored, { selectedId, coloring });
        }
        else {
            publish(Topics.setConnectionColors, {});
            publish(Topics.connectionsCleared, {});
        }
    };
    const handleOps = (ops) => {
        const { connectionsChanged, clustersChanged } = applyBusinessOps(world, ops);
        if (clustersChanged) {
            const state = SelectionStore.getState();
            const selectedMissing = state.selectedId != null && !hasCluster(world, state.selectedId);
            const hoveredMissing = state.hoveredId != null && !hasCluster(world, state.hoveredId);
            if (selectedMissing) {
                SelectionStore.setSelected(null);
            }
            if (hoveredMissing) {
                SelectionStore.setHovered(null);
            }
        }
        if (connectionsChanged && editMode.getEditingClusterId() === null) {
            const { selectedId } = SelectionStore.getState();
            if (selectedId != null) {
                const coloring = computeConnectionGradient(selectedId, 10, world.lastConnections);
                publish(Topics.setConnectionColors, coloring);
            }
        }
    };
    const handleClearGalaxy = () => {
        clearBusinessWorld(world);
        clearUIObjects();
        editMode.clearAll();
        SelectionStore.clear();
    };
    const destroy = () => {
        clearUIObjects();
        clearBusinessWorld(world);
        editMode.clearAll();
    };
    function clearUIObjects() {
        const currentlyEditingClusterId = editMode.getEditingClusterId();
        if (editMode.hasUIObjects() && currentlyEditingClusterId != null) {
            publish(Topics.hideEditHandles, {
                clusterId: currentlyEditingClusterId,
            });
        }
        editMode.clearUIObjects();
    }
    return {
        handlePointerEvent,
        handleSelectionChange,
        handleOps,
        handleClearGalaxy,
        destroy,
    };
}
//# sourceMappingURL=pointer-interactions.js.map