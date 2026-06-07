export async function initializeAppWorkers(mainBus) {
    await mainBus.enablePubSub();
    const brokerStatus = await mainBus.getBrokerStatus();
    console.log("📊 Broker system status:", brokerStatus);
    await mainBus.launchWorker("../galaxy/galaxy-worker.js", {
        workerId: "galaxy",
        busOptions: { debug: 1 },
    });
    await mainBus.launchWorker("../business/business-worker.js", {
        workerId: "business",
        busOptions: { debug: 1 },
    });
    await mainBus.launchWorker("../fleets/fleets-worker.js", {
        workerId: "fleets",
        busOptions: { debug: 1 },
    });
    if (!mainBus.isPubSubReady()) {
        console.warn("Pub/sub not available on main bus - broker not ready");
    }
}
//# sourceMappingURL=app-workers.js.map