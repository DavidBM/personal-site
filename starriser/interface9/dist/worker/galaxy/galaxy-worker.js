import { opAddCluster, opRemoveCluster, opAddSolarSystem, opConnectClusters, } from "./galaxy-ops.js";
import { generateGalaxyData } from "./galaxy-data-generator.js";
/**
 * Galaxy Worker Constructor - called by worker bootstrap
 */
export function busConstructor(bus) {
    let currentGeneration = null;
    let isGenerating = false;
    let pubSubReady = false;
    const handleGenerateGalaxy = (params) => {
        if (isGenerating) {
            bus.publish("error", { error: "Galaxy generation already in progress" });
            return;
        }
        isGenerating = true;
        currentGeneration = Date.now();
        bus.publish("galaxy_generation_started", {
            generationId: currentGeneration,
            params,
            timestamp: Date.now(),
        });
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
                    bus.publish("ops", ops, 2);
                },
            });
            bus.publish("complete", { generationId: currentGeneration }, 2);
            bus.publish("galaxy_generation_complete", {
                generationId: currentGeneration,
                timestamp: Date.now(),
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            bus.publish("error", {
                error: message,
                generationId: currentGeneration,
            });
            bus.publish("galaxy_generation_error", {
                error: message,
                generationId: currentGeneration,
                timestamp: Date.now(),
            });
        }
        finally {
            isGenerating = false;
        }
    };
    // Handle cancellation requests
    const handleCancelGeneration = ({ generationId, }) => {
        if (currentGeneration === generationId) {
            isGenerating = false;
            currentGeneration = null;
            bus.publish("cancelled", { generationId });
            bus.publish("galaxy_generation_cancelled", {
                generationId,
                timestamp: Date.now(),
            });
        }
    };
    const setupPubSubSubscriptions = () => {
        if (pubSubReady || !bus._brokerPort)
            return;
        pubSubReady = true;
        const debugLevel = bus._options.debug ?? 0;
        if (debugLevel >= 1) {
            console.log("📢 Galaxy worker setting up pub/sub subscriptions");
        }
        bus.subscribe("generateGalaxy", handleGenerateGalaxy);
        bus.subscribe("cancelGeneration", handleCancelGeneration);
        bus.subscribe("request_galaxy_status", () => {
            bus.publish("galaxy_status_response", {
                isGenerating,
                currentGeneration,
                timestamp: Date.now(),
            });
        });
        bus.subscribe("test_message", (data) => {
            if (debugLevel >= 1) {
                console.log("📨 Galaxy worker received test message:", data);
            }
        });
    };
    if (bus._brokerPort) {
        setupPubSubSubscriptions();
    }
    bus.on("setup_broker_port", () => {
        setupPubSubSubscriptions();
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