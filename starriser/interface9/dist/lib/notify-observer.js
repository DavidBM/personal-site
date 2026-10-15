/** Sparse observation fanout: a broken consumer cannot veto another consumer's
 * accepted facts. Commands and request handlers must still propagate failures. */
export function notifyObserver(name, run, report = console.error) {
    const failed = (error) => { try {
        report(`Observer failed: ${name}`, error);
    }
    catch {
        console.error(`Observer diagnostic failed: ${name}`, error);
    } };
    try {
        const pending = run();
        if (pending && typeof pending.then === 'function')
            void pending.catch(failed);
    }
    catch (error) {
        failed(error);
    }
}
//# sourceMappingURL=notify-observer.js.map