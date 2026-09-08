/** Call once in a feature's contracts.ts; the descriptor never crosses the wire. */
export function defineTopic(name, priority = 1) {
    return { name, priority };
}
export function publishFeatureTopic(transport, topic, payload) {
    transport.publish(topic.name, payload, topic.priority);
}
/** Each subscriber owns its disposer; removing it never removes peer handlers. */
export function subscribeFeatureTopic(transport, topic, handler) {
    transport.subscribe(topic.name, handler);
    let active = true;
    return () => {
        if (!active)
            return;
        active = false;
        transport.unsubscribe(topic.name, handler);
    };
}
//# sourceMappingURL=feature-topics.js.map