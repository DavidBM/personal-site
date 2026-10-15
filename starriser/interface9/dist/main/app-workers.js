import { MOCK_RUNTIME, runtimeForAuthority } from './runtime-profile.js';
export async function initializeAppWorkers(mainBus, runtime = MOCK_RUNTIME) {
    const profile = typeof runtime === 'string' ? runtimeForAuthority(runtime) : runtime;
    await mainBus.enablePubSub();
    const brokerStatus = await mainBus.getBrokerStatus();
    console.log("📊 Broker system status:", brokerStatus);
    for (const worker of profile.workers.startup) {
        await mainBus.launchWorker(worker.module, { workerId: worker.id, busOptions: { debug: 1 } });
    }
    if (!mainBus.isPubSubReady()) {
        console.warn("Pub/sub not available on main bus - broker not ready");
    }
}
//# sourceMappingURL=app-workers.js.map