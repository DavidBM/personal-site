/**
 * Run setup once the broker port is available.
 * Shared by worker entry shells to avoid copy-pasted pubSubReady flags.
 */
export function whenPubSubReady(bus, setup) {
    let ready = false;
    const run = () => {
        if (ready || !bus.hasBrokerPort())
            return;
        ready = true;
        setup();
    };
    if (bus.hasBrokerPort()) {
        run();
    }
    bus.on("setup_broker_port", () => {
        run();
    });
}
//# sourceMappingURL=when-pubsub-ready.js.map