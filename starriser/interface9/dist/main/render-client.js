import { createRenderConnection } from "./render-connection.js";
import { readBrowserFrameDebug } from "./browser-frame-debug.js";
/** Main owns the DOM surface and messaging. The worker owns every GPU resource. */
export class RenderClient {
    constructor(canvas, worker, options) {
        this.cleanup = [];
        this.state = null;
        this.lost = false;
        this.canvas = canvas;
        this.connection = createRenderConnection({
            endpoint: worker,
            onState: (snapshot) => {
                this.state = snapshot;
                canvas.style.cursor = snapshot.cursor;
                options.onState(snapshot);
            },
            onError: (error) => { this.lost = true; options.onError(error); },
        });
    }
    static async create(options) {
        if (options.signal?.aborted)
            throw new Error("Render initialization cancelled");
        const canvas = document.createElement("canvas");
        canvas.id = "galaxy-map";
        Object.assign(canvas.style, {
            display: "block", position: "fixed", inset: "0", width: "100%", height: "100%",
            touchAction: "none", zIndex: "0", cursor: "grab",
        });
        options.container.appendChild(canvas);
        let client = null;
        const onAbort = () => { void client?.dispose(); };
        try {
            const worker = new Worker(new URL("../../render-worker.js", import.meta.url), {
                type: "module", name: "galaxy-render",
            });
            client = new RenderClient(canvas, worker, options);
            options.signal?.addEventListener("abort", onAbort, { once: true });
            const offscreen = canvas.transferControlToOffscreen();
            const motion = matchMedia("(prefers-reduced-motion: reduce)");
            const bootstrap = {
                type: "initialize", canvas: offscreen,
                viewport: client.viewport(), reducedMotion: motion.matches,
                frameDebug: readBrowserFrameDebug(),
            };
            worker.postMessage(bootstrap, [offscreen]);
            await client.connection.ready;
            if (options.signal?.aborted)
                throw new Error("Render initialization cancelled");
            client.observeViewport(motion);
            return client;
        }
        catch (error) {
            if (client)
                await client.dispose();
            else
                canvas.remove();
            throw error;
        }
        finally {
            options.signal?.removeEventListener("abort", onAbort);
        }
    }
    viewport() {
        const rect = this.canvas.getBoundingClientRect();
        return { width: Math.max(1, rect.width), height: Math.max(1, rect.height), dpr: window.devicePixelRatio || 1 };
    }
    observeViewport(motion) {
        const resize = () => this.send({ type: "viewport", viewport: this.viewport() });
        const observer = new ResizeObserver(resize);
        observer.observe(this.canvas);
        window.addEventListener("resize", resize);
        const motionChanged = () => this.send({ type: "input", input: { type: "reducedMotion", value: motion.matches } });
        motion.addEventListener("change", motionChanged);
        // A resolution media query catches moving between monitors without CSS resize.
        let resolution;
        const dprChanged = () => { resize(); watchDpr(); };
        const watchDpr = () => {
            resolution?.removeEventListener("change", dprChanged);
            resolution = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
            resolution.addEventListener("change", dprChanged, { once: true });
        };
        watchDpr();
        this.cleanup.push(() => {
            observer.disconnect();
            window.removeEventListener("resize", resize);
            resolution.removeEventListener("change", dprChanged);
            motion.removeEventListener("change", motionChanged);
        });
    }
    snapshot() { return this.state; }
    isDeviceLost() { return this.lost || (this.state?.metrics.deviceLost ?? true); }
    send(command) { this.connection.send(command); }
    query(query, options) { return this.connection.query(query, options); }
    attachProjection(attachment) { return this.connection.attachProjection(attachment); }
    resize(width, height) {
        this.canvas.style.width = `${Math.max(1, width)}px`;
        this.canvas.style.height = `${Math.max(1, height)}px`;
        this.send({ type: "viewport", viewport: { width, height, dpr: window.devicePixelRatio || 1 } });
    }
    async dispose() {
        for (const clean of this.cleanup.splice(0))
            clean();
        await this.connection.dispose();
        this.canvas.remove();
    }
}
//# sourceMappingURL=render-client.js.map