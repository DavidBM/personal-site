import { generateGalaxyBatches } from "./galaxy-data-generator.js";
import { createGenerationDelivery } from "./generation-delivery.js";
import { whenPubSubReady } from "../bus/when-pubsub-ready.js";
import { publishTopic, subscribeTopic, Topics, } from "../protocol/topics.js";
/**
 * Galaxy Worker Constructor - called by worker bootstrap.
 * Generation advances only after all consumer projections release the batch.
 */
export function busConstructor(bus) {
    let currentGeneration = null;
    let active;
    let generationCounter = 0;
    const handleGenerateGalaxy = async (params) => {
        if (active && !active.signal.aborted) {
            publishTopic(bus, Topics.galaxyError, {
                error: "Galaxy generation already in progress",
            });
            return;
        }
        const lifetime = new AbortController();
        active = lifetime;
        const generationId = ++generationCounter;
        currentGeneration = generationId;
        const delivery = createGenerationDelivery(bus, generationId, lifetime.signal);
        publishTopic(bus, Topics.galaxyGenerationStarted, {
            generationId,
            params,
            timestamp: Date.now(),
        });
        try {
            // Amortize the all-mirror admission/application round trip. The producer
            // still holds only one batch, and the Bus enforces its byte reservation.
            for (const ops of generateGalaxyBatches({ ...params, batchSize: params.batchSize ?? 1000 })) {
                lifetime.signal.throwIfAborted();
                await delivery.send(ops);
            }
            lifetime.signal.throwIfAborted();
            // Single completion event (no parallel galaxyGenerationComplete).
            publishTopic(bus, Topics.galaxyComplete, {
                generationId,
            }, 2);
        }
        catch (err) {
            if (lifetime.signal.aborted)
                return;
            const message = err instanceof Error ? err.message : String(err);
            publishTopic(bus, Topics.galaxyError, {
                error: message,
                generationId,
            });
        }
        finally {
            delivery.dispose();
            if (active === lifetime)
                active = undefined;
        }
    };
    const handleCancelGeneration = ({ generationId, }) => {
        if (currentGeneration === generationId) {
            active?.abort();
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
        subscribeTopic(bus, Topics.clearGalaxy, () => { active?.abort(); });
    });
    bus.send("worker_ready", { role: "galaxy" });
    return {
        isGenerating: () => !!active && !active.signal.aborted,
        getCurrentGeneration: () => currentGeneration,
        destroy: () => {
            active?.abort();
            currentGeneration = null;
        },
    };
}
//# sourceMappingURL=galaxy-worker.js.map