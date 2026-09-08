/** Lifecycle handshake only. Application commands use the registered service handles. */
export function prepareNetworkServices(worker, value, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('Network services did not become ready')), 10000);
        function finish(error) {
            clearTimeout(timer);
            worker.removeEventListener('message', message);
            worker.removeEventListener('error', failed);
            signal.removeEventListener('abort', aborted);
            if (error)
                reject(error);
            else
                resolve();
        }
        function message(event) {
            if (event.data.generation !== value.generation)
                return;
            if (event.data.type === 'servicesReady')
                finish();
            if (event.data.type === 'networkFatal')
                finish(new Error(event.data.message));
        }
        function failed() { finish(new Error('Network worker failed during service bootstrap')); }
        function aborted() { finish(new Error('Network service bootstrap canceled')); }
        worker.addEventListener('message', message);
        worker.addEventListener('error', failed);
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) {
            aborted();
            return;
        }
        try {
            worker.postMessage(value);
        }
        catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)));
        }
    });
}
//# sourceMappingURL=network-service-bootstrap.js.map