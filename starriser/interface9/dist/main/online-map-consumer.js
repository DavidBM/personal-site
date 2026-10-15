/** One content page owns one renderer replay acknowledgement. Publication is
 * synchronous; the promise only applies backpressure and never publishes late. */
export function createOnlineMapConsumer(options) {
    const observer = options.observer;
    function apply(ops) {
        if (!options.current())
            return Promise.resolve();
        options.apply(ops);
        return options.consumed();
    }
    return {
        reset() { if (options.current())
            options.apply(options.map.resetContent()); observer?.reset(); },
        status(state, loaded, total) { if (options.current())
            observer?.status(state, loaded, total); },
        async atlas(rows, index, total) {
            if (!options.current())
                return;
            const consumed = apply(options.map.acceptAtlas(rows));
            await Promise.all([consumed, observer?.atlas(rows, index, total)]);
        },
        async system(value) {
            if (!options.current())
                return;
            const consumed = apply(value ? options.map.acceptSystem(value) : []);
            await Promise.all([consumed, observer?.system(value)]);
        },
        async previewSystem(value) {
            if (!options.current())
                return;
            await apply(options.map.acceptSystem(value, true));
        },
    };
}
//# sourceMappingURL=online-map-consumer.js.map