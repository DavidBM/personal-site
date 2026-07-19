import { generateGalaxyData } from "./galaxy-data-generator.js";
import { whenPubSubReady } from "../bus/when-pubsub-ready.js";
import { publishTopic, subscribeTopic, Topics, } from "../protocol/topics.js";
/**
 * Galaxy Worker Constructor - called by worker bootstrap.
 * Generation is currently synchronous; cancelGeneration only applies if a
 * future chunked path re-checks flags between batches.
 */
export function busConstructor(bus) {
    let currentGeneration = null;
    let isGenerating = false;
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
            // Single completion event (no parallel galaxyGenerationComplete).
            publishTopic(bus, Topics.galaxyComplete, {
                generationId: currentGeneration,
            }, 2);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            publishTopic(bus, Topics.galaxyError, {
                error: message,
                generationId: currentGeneration,
            });
        }
        finally {
            isGenerating = false;
        }
    };
    const handleCancelGeneration = ({ generationId, }) => {
        // Reserved: generation runs synchronously today, so cancel cannot
        // interrupt mid-run. When batching becomes async, re-check isGenerating
        // between onBatch calls.
        if (currentGeneration === generationId) {
            isGenerating = false;
            currentGeneration = null;
            publishTopic(bus, Topics.galaxyCancelled, { generationId });
        }
    };
    whenPubSubReady(bus, () => {
        if (bus.getDebugLevel() >= 1) {
            console.log("📢 Galaxy worker setting up pub/sub subscriptions");
        }
        subscribeTopic(bus, Topics.generateGalaxy, handleGenerateGalaxy);
        subscribeTopic(bus, Topics.cancelGeneration, handleCancelGeneration);
    });
    bus.send("worker_ready", { role: "galaxy" });
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