export async function initializeAppWorkers(mainBus, authority = 'offline') {
    await mainBus.enablePubSub();
    const brokerStatus = await mainBus.getBrokerStatus();
    console.log("📊 Broker system status:", brokerStatus);
    if (authority === 'offline')
        await mainBus.launchWorker("../galaxy/galaxy-worker.js", {
            workerId: "galaxy",
            busOptions: { debug: 1 },
        });
    await mainBus.launchWorker(authority === 'online' ? "../business/online-business-worker.js" : "../business/business-worker.js", {
        workerId: "business",
        busOptions: { debug: 1 },
    });
    if (authority === 'offline')
        await mainBus.launchWorker("../fleets/fleets-worker.js", {
            workerId: "fleets",
            busOptions: { debug: 1 },
        });
    if (!mainBus.isPubSubReady()) {
        console.warn("Pub/sub not available on main bus - broker not ready");
    }
}
//# sourceMappingURL=app-workers.js.map