import { generateGalaxyData } from "./galaxy-data-generator.js";
import { publishTopic, subscribeTopic, Topics, } from "../protocol/topics.js";
/**
 * Galaxy Worker Constructor - called by worker bootstrap
 */
export function busConstructor(bus) {
    let currentGeneration = null;
    let isGenerating = false;
    let pubSubReady = false;
    const handleGenerateGalaxy = (params) => {
        if (isGenerating) {
            publishTopic(bus, Topics.galaxyError, {
                error: "Galaxy generation already in progress",
            });
            return;
        }
        isGenerating = true;
        currentGeneration = Date.now();
        publishTopic(bus, Topics.galaxyGenerationStarted, {
            generationId: currentGeneration,
            params,
            timestamp: Date.now(),
        });
        try {
            generateGalaxyData({
                ...params,
                centerBias: params.centerBias,
                onBatch: (ops) => {
                    publishTopic(bus, Topics.galaxyOps, ops, 2);
                },
            });
            publishTopic(bus, Topics.galaxyComplete, {
                generationId: currentGeneration,
            }, 2);
            publishTopic(bus, Topics.galaxyGenerationComplete, {
                generationId: currentGeneration,
                timestamp: Date.now(),
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            publishTopic(bus, Topics.galaxyError, {
                error: message,
                generationId: currentGeneration,
            });
            publishTopic(bus, Topics.galaxyGenerationError, {
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
            publishTopic(bus, Topics.galaxyCancelled, { generationId });
            publishTopic(bus, Topics.galaxyGenerationCancelled, {
                generationId,
                timestamp: Date.now(),
            });
        }
    };
    const setupPubSubSubscriptions = () => {
        if (pubSubReady || !bus.hasBrokerPort())
            return;
        pubSubReady = true;
        const debugLevel = bus.getDebugLevel();
        if (debugLevel >= 1) {
            console.log("📢 Galaxy worker setting up pub/sub subscriptions");
        }
        subscribeTopic(bus, Topics.generateGalaxy, handleGenerateGalaxy);
        subscribeTopic(bus, Topics.cancelGeneration, handleCancelGeneration);
    };
    if (bus.hasBrokerPort()) {
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