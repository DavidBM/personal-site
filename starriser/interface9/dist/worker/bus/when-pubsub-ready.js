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
        return setup();
    };
    if (bus.hasBrokerPort()) {
        const result = run();
        if (result)
            void result.catch(error => bus._reportFailure({ code: 'HANDLER_ERROR', type: 'setup_broker_port', message: String(error) }));
    }
    bus.on("setup_broker_port", () => {
        return run();
    });
}
//# sourceMappingURL=when-pubsub-ready.js.map