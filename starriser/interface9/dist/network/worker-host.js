import { createNetworkSession } from './session.js';
import { createNetworkService } from './service-host.js';
/** One socket session and, in the app, one existing broker registration. The
 * standalone worker fixture uses the same host without a second registry. */
export function createNetworkWorker(bus) {
    const worker = self;
    let session;
    let service;
    let generation = 0;
    let prepared = false;
    let failed = false;
    let disconnectStream;
    const previousError = bus?._options.onError;
    function lifecycle(value) { worker.postMessage(value); }
    function fatal(error) {
        if (failed)
            return;
        failed = true;
        session?.dispose();
        disconnectStream?.();
        if (service)
            void service.dispose().catch(() => { });
        lifecycle({ type: 'networkFatal', generation, message: error instanceof Error ? error.message : String(error) });
    }
    function emit(event) {
        if (failed)
            return;
        if (service) {
            try {
                return service.emit(event);
            }
            catch (error) {
                fatal(error);
                if (event.type === 'pending')
                    return Promise.reject(error);
                return;
            }
        }
        worker.postMessage(event);
    }
    const busError = (error) => fatal(new Error(error.message));
    if (bus)
        bus._options.onError = busError;
    async function prepare(value) {
        if (!bus || service || !Number.isSafeInteger(value.generation) || value.generation < 1)
            throw new Error('Invalid network service bootstrap');
        generation = value.generation;
        service = createNetworkService(bus, value.scope, () => {
            if (!session)
                throw new Error('Network session is not connected');
            return session;
        });
        await service.ready();
        if (failed)
            return;
        prepared = true;
        lifecycle({ type: 'servicesReady', generation });
    }
    function connect(data) {
        if (bus && (!prepared || data.generation !== generation)) {
            data.renderPort.close();
            throw new Error('Network service bootstrap is not ready');
        }
        session?.dispose();
        disconnectStream?.();
        generation = data.generation;
        try {
            session = createNetworkSession({ bootstrap: data, emit });
            disconnectStream = service?.connectStream(generation);
        }
        catch (error) {
            data.renderPort.close();
            throw error;
        }
    }
    function destroy() {
        session?.dispose();
        session = undefined;
        disconnectStream?.();
        if (service)
            void service.dispose().catch(() => { });
        if (bus?._options.onError === busError)
            bus._options.onError = previousError;
        worker.onmessage = null;
        worker.onmessageerror = null;
    }
    function receive(data) {
        if (data.type === 'prepareServices') {
            void prepare(data).catch(fatal);
            return;
        }
        if (data.type === 'connect') {
            connect(data);
            return;
        }
        if (data.type === 'dispose') {
            destroy();
            worker.close();
            return;
        }
        if (!session)
            throw new Error('Network worker has no active session');
        const active = session;
        void active.control(data).catch(error => {
            if (session === active)
                emit({ type: 'error', message: String(error), requestId: 'requestId' in data ? data.requestId : undefined });
        });
    }
    worker.onmessage = ({ data }) => {
        if (data?.b === true || failed)
            return;
        try {
            receive(data);
        }
        catch (error) {
            if (bus)
                fatal(error);
            else
                emit({ type: 'error', message: String(error) });
        }
    };
    worker.onmessageerror = () => { destroy(); worker.close(); };
    return { destroy };
}
//# sourceMappingURL=worker-host.js.map