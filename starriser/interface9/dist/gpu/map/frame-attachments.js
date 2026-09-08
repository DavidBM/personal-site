import { readGpuTextureRgba8 } from "../buffer-readback.js";
import { MAP_MSAA_SAMPLES } from "../map-msaa.js";
/** Owns multisample/depth and optional readback targets; no swapchain copies. */
export class FrameAttachments {
    constructor(bootstrap, canvas, isUnavailable) {
        /**
         * Multisampled color target for the map pass (resolve → swapchain).
         * Size tracks the drawing buffer; recreated on resize.
         */
        this.msaaColor = null;
        this.msaaColorView = null;
        /**
         * Offscreen 1-sample resolve (RENDER_ATTACHMENT | COPY_SRC) used only by
         * {@link readbackColorOnce}. Never the canvas — swapchain COPY_SRC/COPY_DST
         * destroys this Chromium SharedImage.
         */
        this.resolveColor = null;
        this.resolveColorView = null;
        /** When true, this frame resolves MSAA into {@link resolveColor}. */
        this.resolveReadback = false;
        /** MSAA depth for opaque ship models (exterior wins over back faces). */
        this.msaaDepth = null;
        this.msaaDepthView = null;
        this.msaaW = 0;
        this.msaaH = 0;
        /** Last owned resolve color (same texels that were blitted to the swapchain). */
        this.lastResolveW = 0;
        this.lastResolveH = 0;
        this.bootstrap = bootstrap;
        this.canvas = canvas;
        this.isUnavailable = isUnavailable;
    }
    /** Grow/recreate the MSAA color + depth attachments to match the drawing buffer. */
    ensureMsaaColor(width, height) {
        const w = Math.max(1, width | 0);
        const h = Math.max(1, height | 0);
        if (this.msaaColor && this.msaaW === w && this.msaaH === h)
            return;
        this.msaaColor?.destroy();
        this.msaaDepth?.destroy();
        this.msaaColor = this.bootstrap.device.createTexture({
            label: "map-msaa-color",
            size: { width: w, height: h },
            sampleCount: MAP_MSAA_SAMPLES,
            format: this.bootstrap.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.msaaColorView = this.msaaColor.createView();
        this.msaaDepth = this.bootstrap.device.createTexture({
            label: "map-msaa-depth",
            size: { width: w, height: h },
            sampleCount: MAP_MSAA_SAMPLES,
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.msaaDepthView = this.msaaDepth.createView();
        this.msaaW = w;
        this.msaaH = h;
        if (this.resolveColor && (this.lastResolveW !== w || this.lastResolveH !== h)) {
            this.resolveColor.destroy();
            this.resolveColor = null;
            this.resolveColorView = null;
        }
    }
    /** Offscreen COPY_SRC resolve target for {@link readbackColorOnce}. */
    ensureResolveColor(width, height) {
        const w = Math.max(1, width | 0);
        const h = Math.max(1, height | 0);
        if (this.resolveColor && this.lastResolveW === w && this.lastResolveH === h) {
            return;
        }
        this.resolveColor?.destroy();
        this.resolveColor = this.bootstrap.device.createTexture({
            label: "map-resolve-color",
            size: { width: w, height: h },
            format: this.bootstrap.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        this.resolveColorView = this.resolveColor.createView();
        this.lastResolveW = w;
        this.lastResolveH = h;
    }
    /**
     * Resolve the next {@link renderOnce} into an owned COPY_SRC color instead of
     * the swapchain. Call before the boom encode; {@link readbackColorOnce} then
     * MAP_READs that target (no second encode, no canvas copy).
     */
    enableColorReadback() {
        this.resolveReadback = true;
        this.ensureResolveColor(Math.max(1, this.canvas.width | 0), Math.max(1, this.canvas.height | 0));
    }
    /** Resume normal presentation after an explicit diagnostic capture. */
    disableColorReadback() {
        this.resolveReadback = false;
    }
    /**
     * Copy the last owned resolve (full buffer). Same Band C encode as
     * {@link renderOnce} after {@link enableColorReadback}. Uses buffer-readback.
     */
    async readbackColorOnce() {
        if (this.isUnavailable()) {
            throw new Error("readbackColorOnce: device lost or view disposed");
        }
        const src = this.resolveColor;
        if (!src || this.lastResolveW <= 0 || this.lastResolveH <= 0) {
            throw new Error("readbackColorOnce: no resolve target (enableColorReadback + renderOnce first)");
        }
        const device = this.bootstrap.device;
        const texW = this.lastResolveW;
        const texH = this.lastResolveH;
        return readGpuTextureRgba8(device, src, {
            width: texW,
            height: texH,
            format: this.bootstrap.format,
        });
    }
    dispose() {
        this.msaaColor?.destroy();
        this.msaaColor = null;
        this.msaaColorView = null;
        this.msaaDepth?.destroy();
        this.msaaDepth = null;
        this.msaaDepthView = null;
        this.resolveColor?.destroy();
        this.resolveColor = null;
        this.resolveColorView = null;
    }
}
//# sourceMappingURL=frame-attachments.js.map