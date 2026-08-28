/**
 * One FOCUS Hillaire / Bruneton LUT stack.
 *
 * Unreal Sky Atmosphere cannot do N planets — we do not pretend otherwise.
 * Year-1 applies this stack to the Band-C focus body only. Neighbours keep
 * climate-tinted O’Neil (`catalog-atm` + `in_scatter`). RecurseDraw O’Neil
 * while the tables are late (same parent-fallback idea as 1k until 4K).
 *
 * Tables are tiny (256×64 + 32×32). Not a catalog 4K. Bake after submit /
 * on promote via {@link HillaireLutStack.pumpLutBake} — never inside encode.
 *
 * Apply textures bind on group 1 of the FOCUS pipeline (not group-0 slot 9).
 */
import { HILLAIRE_BAKE_UNIFORM_SIZE, HILLAIRE_BAKE_WGSL, } from "./hillaire-lut.wgsl.js";
/** Bruneton transmittance table. */
export const HILLAIRE_TRANSMITTANCE_W = 256;
export const HILLAIRE_TRANSMITTANCE_H = 64;
/** Hillaire isotropic multi-scatter table (square). */
export const HILLAIRE_MULTISCATTER_N = 32;
/** RecurseDraw / not-ready. Runtime value of the oneil-fallback path. */
export const DEFAULT_FOCUS_ATM_MODE = "oneil";
/** Year-1: a single stack. Never an 8-wide per-body array. */
export const HILLAIRE_STACK_COUNT = 1;
export function defaultFocusAtmMode() {
    return DEFAULT_FOCUS_ATM_MODE;
}
/** Stable key so we re-bake on FOCUS catalog-id / climate change, not every rAF. */
export function lutParamFingerprint(catalogId, p) {
    const q = (n) => (Number.isFinite(n) ? n.toFixed(4) : "0");
    return [
        catalogId,
        q(p.rInner),
        q(p.atmThick),
        q(p.extScale),
        q(p.colorR),
        q(p.colorG),
        q(p.colorB),
        q(p.intensity),
        q(p.mieEmit),
    ].join("|");
}
export function hillaireTransmittanceUv(r, mu, rInner, rOuter) {
    const bottom = rInner;
    const top = rOuter;
    const rr = Math.max(r, bottom);
    const H = Math.sqrt(Math.max(top * top - bottom * bottom, 0));
    const rho = Math.sqrt(Math.max(rr * rr - bottom * bottom, 0));
    const disc = rr * rr * (mu * mu - 1) + top * top;
    const d = Math.max(-rr * mu + Math.sqrt(Math.max(disc, 0)), 0);
    const dMin = top - rr;
    const dMax = rho + H;
    const u = (d - dMin) / Math.max(dMax - dMin, 1e-5);
    const v = rho / Math.max(H, 1e-5);
    return {
        u: Math.min(1, Math.max(0, u)),
        v: Math.min(1, Math.max(0, v)),
    };
}
export function hillaireMultiScatterUv(r, muS, rInner, rOuter) {
    const u = Math.min(1, Math.max(0, 0.5 + 0.5 * muS));
    const v = Math.min(1, Math.max(0, (r - rInner) / Math.max(rOuter - rInner, 0.001)));
    return { u, v };
}
const BAKE_FLOATS = HILLAIRE_BAKE_UNIFORM_SIZE / 4;
function packBakeUniforms(p, out) {
    const rInner = p.rInner;
    const rOuter = rInner + Math.max(p.atmThick, 0.001);
    out[0] = rInner;
    out[1] = rOuter;
    out[2] = p.extScale;
    out[3] = p.intensity;
    out[4] = p.colorR;
    out[5] = p.colorG;
    out[6] = p.colorB;
    out[7] = 12 * p.extScale;
    out[8] = p.mieEmit;
    out[9] = 0.05;
    out[10] = 0.02;
    out[11] = 0;
    for (let i = 12; i < BAKE_FLOATS; i++)
        out[i] = 0;
}
export class HillaireLutStack {
    constructor(device) {
        this.tTex = null;
        this.msTex = null;
        this.tView = null;
        this.msView = null;
        this.sampler = null;
        this.bakeBuf = null;
        this.tPipe = null;
        this.msPipe = null;
        this.bakeCpu = new Float32Array(BAKE_FLOATS);
        this.pendingKey = null;
        this.pendingCatalogId = null;
        this.pendingKnobs = null;
        this.readyKey = null;
        this.readyCatalog = null;
        this.baking = false;
        this.ok = false;
        this.device = device;
        this.ok = this.tryInit();
    }
    tryInit() {
        const device = this.device;
        const usage = GPUTextureUsage.STORAGE_BINDING |
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_SRC;
        try {
            this.tTex = device.createTexture({
                label: "hillaire-transmittance",
                size: {
                    width: HILLAIRE_TRANSMITTANCE_W,
                    height: HILLAIRE_TRANSMITTANCE_H,
                },
                format: "rgba16float",
                usage,
            });
            this.msTex = device.createTexture({
                label: "hillaire-multiscatter",
                size: {
                    width: HILLAIRE_MULTISCATTER_N,
                    height: HILLAIRE_MULTISCATTER_N,
                },
                format: "rgba16float",
                usage,
            });
            this.tView = this.tTex.createView();
            this.msView = this.msTex.createView();
            this.sampler = device.createSampler({
                label: "hillaire-lut-samp",
                magFilter: "linear",
                minFilter: "linear",
                addressModeU: "clamp-to-edge",
                addressModeV: "clamp-to-edge",
            });
            this.bakeBuf = device.createBuffer({
                label: "hillaire-bake-ubo",
                size: HILLAIRE_BAKE_UNIFORM_SIZE,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            const mod = device.createShaderModule({
                label: "hillaire-lut-bake",
                code: HILLAIRE_BAKE_WGSL,
            });
            this.tPipe = device.createComputePipeline({
                label: "hillaire-cs-transmittance",
                layout: "auto",
                compute: { module: mod, entryPoint: "cs_transmittance" },
            });
            this.msPipe = device.createComputePipeline({
                label: "hillaire-cs-multiscatter",
                layout: "auto",
                compute: { module: mod, entryPoint: "cs_multiscatter" },
            });
            return true;
        }
        catch {
            this.disposeGpu();
            return false;
        }
    }
    /** Tables exist and match `catalogId` + knobs. */
    isReady() {
        return this.ok && this.readyKey != null && this.readyKey === this.pendingKey;
    }
    isReadyFor(catalogId, knobs) {
        if (!this.ok || !this.readyKey)
            return false;
        return this.readyKey === lutParamFingerprint(catalogId, knobs);
    }
    isBaking() {
        return this.baking;
    }
    readyCatalogId() {
        return this.readyKey ? this.readyCatalog : null;
    }
    /**
     * Mark the FOCUS body for bake. Does **not** submit. Call
     * {@link pumpLutBake} after the frame / on promote.
     */
    requestBake(catalogId, knobs) {
        if (!this.ok || !catalogId)
            return;
        const key = lutParamFingerprint(catalogId, knobs);
        this.pendingKey = key;
        this.pendingCatalogId = catalogId;
        this.pendingKnobs = knobs;
    }
    /**
     * One in-flight compute submit. No-op when already baking or when the
     * pending fingerprint already matches the ready tables.
     */
    pumpLutBake() {
        if (!this.ok || this.baking)
            return;
        const key = this.pendingKey;
        const knobs = this.pendingKnobs;
        const catalogId = this.pendingCatalogId;
        if (!key || !knobs || !catalogId)
            return;
        if (this.readyKey === key)
            return;
        if (!this.tTex ||
            !this.msTex ||
            !this.tView ||
            !this.msView ||
            !this.sampler ||
            !this.bakeBuf ||
            !this.tPipe ||
            !this.msPipe) {
            return;
        }
        this.baking = true;
        packBakeUniforms(knobs, this.bakeCpu);
        this.device.queue.writeBuffer(this.bakeBuf, 0, this.bakeCpu);
        const tBg = this.device.createBindGroup({
            label: "hillaire-bake-T",
            layout: this.tPipe.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.tView },
                { binding: 1, resource: { buffer: this.bakeBuf } },
            ],
        });
        const msBg = this.device.createBindGroup({
            label: "hillaire-bake-MS",
            layout: this.msPipe.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.msView },
                { binding: 1, resource: { buffer: this.bakeBuf } },
                { binding: 2, resource: this.tView },
                { binding: 3, resource: this.sampler },
            ],
        });
        const enc = this.device.createCommandEncoder({ label: "hillaire-lut-bake" });
        {
            const pass = enc.beginComputePass({ label: "hillaire-T" });
            pass.setPipeline(this.tPipe);
            pass.setBindGroup(0, tBg);
            pass.dispatchWorkgroups(Math.ceil(HILLAIRE_TRANSMITTANCE_W / 8), Math.ceil(HILLAIRE_TRANSMITTANCE_H / 8));
            pass.end();
        }
        {
            const pass = enc.beginComputePass({ label: "hillaire-MS" });
            pass.setPipeline(this.msPipe);
            pass.setBindGroup(0, msBg);
            pass.dispatchWorkgroups(Math.ceil(HILLAIRE_MULTISCATTER_N / 8), Math.ceil(HILLAIRE_MULTISCATTER_N / 8));
            pass.end();
        }
        this.device.queue.submit([enc.finish()]);
        // Queue-ordered: a later encode submit sees completed tables.
        this.readyKey = key;
        this.readyCatalog = catalogId;
        this.baking = false;
    }
    createApplyBindGroup(layout) {
        if (!this.ok || !this.tView || !this.msView || !this.sampler)
            return null;
        return this.device.createBindGroup({
            label: "hillaire-apply-g1",
            layout,
            entries: [
                { binding: 0, resource: this.tView },
                { binding: 1, resource: this.msView },
                { binding: 2, resource: this.sampler },
            ],
        });
    }
    dispose() {
        this.disposeGpu();
        this.ok = false;
        this.pendingKey = null;
        this.readyKey = null;
        this.pendingCatalogId = null;
        this.readyCatalog = null;
        this.pendingKnobs = null;
        this.baking = false;
    }
    disposeGpu() {
        this.tTex?.destroy();
        this.msTex?.destroy();
        this.bakeBuf?.destroy();
        this.tTex = null;
        this.msTex = null;
        this.tView = null;
        this.msView = null;
        this.sampler = null;
        this.bakeBuf = null;
        this.tPipe = null;
        this.msPipe = null;
    }
}
export function createHillaireLutStack(device) {
    return new HillaireLutStack(device);
}
//# sourceMappingURL=hillaire-lut.js.map