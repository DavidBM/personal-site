import { opAddCluster, opRemoveCluster, opAddSolarSystem, opConnectClusters, } from "./galaxy-ops.js";
import { generateGalaxyData } from "./galaxy-data-generator.js";
/**
 * Galaxy Worker Constructor - called by worker bootstrap
 */
export function busConstructor(bus) {
    let currentGeneration = null;
    let isGenerating = false;
    // Handle galaxy generation commands
    bus.on("generateGalaxy", (params) => {
        if (isGenerating) {
            bus.send("error", { error: "Galaxy generation already in progress" });
            return;
        }
        isGenerating = true;
        currentGeneration = Date.now();
        if (bus._brokerPort && bus.publish) {
            bus.publish("galaxy_generation_started", {
                generationId: currentGeneration,
                params,
                timestamp: Date.now(),
            });
        }
        try {
            generateGalaxyData({
                ...params,
                centerBias: params.centerBias,
                opBuilders: {
                    opAddCluster,
                    opRemoveCluster,
                    opAddSolarSystem,
                    opConnectClusters,
                },
                onBatch: (ops) => {
                    bus.send_background("ops", ops);
                },
            });
            bus.send_background("complete", { generationId: currentGeneration });
            if (bus._brokerPort && bus.publish) {
                bus.publish("galaxy_generation_complete", {
                    generationId: currentGeneration,
                    timestamp: Date.now(),
                });
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            bus.send("error", {
                error: message,
                generationId: currentGeneration,
            });
            if (bus._brokerPort && bus.publish) {
                bus.publish("galaxy_generation_error", {
                    error: message,
                    generationId: currentGeneration,
                    timestamp: Date.now(),
                });
            }
        }
        finally {
            isGenerating = false;
        }
    });
    // Handle cancellation requests
    bus.on("cancelGeneration", ({ generationId }) => {
        if (currentGeneration === generationId) {
            isGenerating = false;
            currentGeneration = null;
            bus.send("cancelled", { generationId });
            if (bus._brokerPort && bus.publish) {
                bus.publish("galaxy_generation_cancelled", {
                    generationId,
                    timestamp: Date.now(),
                });
            }
        }
    });
    // Set up pub/sub subscriptions once broker port is available
    bus.on("setup_broker_port", () => {
        const debugLevel = bus._options.debug ?? 0;
        if (debugLevel >= 1) {
            console.log("📢 Galaxy worker setting up pub/sub subscriptions");
        }
        setTimeout(() => {
            if (bus._brokerPort && bus.subscribe) {
                bus.subscribe("request_galaxy_status", () => {
                    if (bus._brokerPort && bus.publish) {
                        bus.publish("galaxy_status_response", {
                            isGenerating,
                            currentGeneration,
                            timestamp: Date.now(),
                        });
                    }
                });
                bus.subscribe("test_message", (data) => {
                    if (debugLevel >= 1) {
                        console.log("📨 Galaxy worker received test message:", data);
                    }
                });
            }
        }, 100);
    });
    // Return worker instance
    return {
        isGenerating: () => isGenerating,
        getCurrentGeneration: () => currentGeneration,
        destroy: () => {
            isGenerating = false;
            currentGeneration = null;
        },
    };
}
//# sourceMappingURL=galaxy-worker.js.map