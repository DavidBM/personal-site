/**
 * GPU side of the hull catalog's engine trails and glows (ship-fx.ts) for the
 * fleet layer: the per-class table read by trail expansion and the draws, the
 * engine list that expansion fills each frame (indirect args and glow ships),
 * the ribbon and glow style texture arrays, and the glow draw
 * (engine-glow.wgsl.ts). Engine ribbons are drawn by the fleet layer's trail
 * pipelines (vs_engine) from the same list.
 *
 * Until a catalog with engines loads, the table is empty (one centre trail per
 * ship, no glows) and both arrays are one transparent texel. A load swaps the
 * textures first and the table last, so expansion never names a layer the
 * bound textures lack.
 */
import { assetUrl } from "../asset-url.js";
import { encodeMips, mipLevelCount } from "./texture-mips.js";
import { readGpuTextureRgba8 } from "../buffer-readback.js";
import { sceneTrailDrawShader, bindSceneCamera } from "../scene-camera.js";
import { ENGINE_GLOW_WGSL } from "../../lib/fleet-sim/gpu/engine-glow.wgsl.js";
import { FLEET_TRAILS_WGSL, TRAIL_TEMPLATE_INDEX_COUNT, TRAIL_UNIFORM_SIZE, writeTrailUniforms } from "../../lib/fleet-sim/gpu/fleet-trails.wgsl.js";
import { glowDrawShips, nextGlowFloorPx, packShipFx, SHIP_ENGINE_GLOW_ARGS_BYTE, SHIP_ENGINE_HEADER_WORDS, SHIP_ENGINE_LIST_BYTES, SHIP_FX_MAX_GLOWS, SHIP_FX_UNIFORM_BYTES, SHIP_GLOW_VERTICES, } from "../../lib/fleet-sim/visual/ship-fx.js";
/** Frames glows and engine copies stay on after the last read that saw them (reads lag 2-3 frames). */
const GLOW_QUIET_FRAMES = 30;
export class EngineFxGpu {
    constructor(device, format, depth, onRibbonsChanged) {
        this.glowsConfigured = false;
        this.probeState = "idle";
        this.frame = 0;
        this.lastGlowFrame = -Infinity;
        this.lastEngineFrame = -Infinity;
        /** Engine copies on: the table's header.y, and the trail passes' engine draws. */
        this.copiesOn = false;
        this.copiesFlag = new Float32Array(1);
        /** Table header.z/w: glow-ship diameter floor and render px of diameter per hull radius over depth. */
        this.glowFloorPx = 0;
        /** Glow ships the direct draw covers (glowDrawShips of the last read demand). */
        this.glowShipsDrawn = glowDrawShips(0);
        this.screenScale = 0;
        this.screenData = new Float32Array(2);
        this.ribbonsConfigured = false;
        this.generation = 0;
        this.uniformData = new Float32Array(TRAIL_UNIFORM_SIZE / 4);
        /** Engine ribbons: the trail template, no instances; glows: six vertices, no instances. */
        this.resetArgs = Uint32Array.from({ length: SHIP_ENGINE_HEADER_WORDS }, (_, i) => (i === 0 ? TRAIL_TEMPLATE_INDEX_COUNT : i === SHIP_ENGINE_GLOW_ARGS_BYTE / 4 ? SHIP_GLOW_VERTICES : 0));
        this.glowPipeline = null;
        this.bind = null;
        this.device = device;
        this.format = format;
        this.depth = depth;
        this.onRibbonsChanged = onRibbonsChanged;
        this.table = device.createBuffer({ label: "ship-fx-table", size: SHIP_FX_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.glowList = device.createBuffer({ label: "engine-list", size: SHIP_ENGINE_LIST_BYTES,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
        this.uniform = device.createBuffer({ label: "engine-glow-uniforms", size: TRAIL_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.probe = device.createBuffer({ label: "engine-list-probe", size: SHIP_ENGINE_HEADER_WORDS * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        this.sampler = device.createSampler({ label: "ship-fx-sampler", magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
        this.ribbons = this.placeholder("ship-fx-ribbons");
        this.glows = this.placeholder("ship-fx-glows");
        device.queue.writeBuffer(this.table, 0, packShipFx(null, 0));
        device.queue.writeBuffer(this.glowList, 0, this.resetArgs);
    }
    /** Trail draw binding 3: the ribbon styles. */
    get ribbonView() { return this.ribbons.view; }
    /** True once a catalog with glows is live. */
    get hasGlows() { return this.glowsConfigured; }
    /** True while engine copies are on (expansion writes them, the trail passes draw them). */
    get hasRibbons() { return this.copiesOn; }
    placeholder(label) {
        const texture = this.device.createTexture({ label, size: [1, 1, 1], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        this.device.queue.writeTexture({ texture }, new Uint8Array(4), { bytesPerRow: 4 }, [1, 1]);
        return { texture, view: texture.createView({ dimension: "2d-array" }) };
    }
    /**
     * One texture array from same-sized images (a mismatched or failed image
     * leaves its layer transparent). The images hold additive light with alpha
     * beside it, so they are decoded without premultiplying: a premultiply and
     * un-premultiply round trip rounds faint pixels' colour to a few levels,
     * which showed as coloured specks along every fade. `mips`: a box-filtered
     * chain (glow sprites are drawn from a few pixels to most of the screen).
     */
    async loadArray(label, base, paths, generation, mips) {
        if (!paths.length)
            return null;
        const bitmaps = await Promise.all(paths.map(async (path) => {
            try {
                const response = await fetch(assetUrl(base + path));
                return response.ok ? await createImageBitmap(await response.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" }) : null;
            }
            catch {
                return null;
            }
        }));
        try {
            const first = bitmaps.find((b) => b);
            if (!first || generation !== this.generation)
                return null;
            const levels = mips ? mipLevelCount(first.width, first.height) : 1;
            const texture = this.device.createTexture({ label, size: [first.width, first.height, paths.length], format: "rgba8unorm", mipLevelCount: levels,
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT });
            bitmaps.forEach((bitmap, layer) => {
                if (bitmap && bitmap.width === first.width && bitmap.height === first.height) {
                    this.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture, origin: [0, 0, layer] }, [bitmap.width, bitmap.height]);
                }
            });
            if (levels > 1)
                encodeMips(this.device, texture, levels, paths.length);
            return { texture, view: texture.createView({ dimension: "2d-array" }) };
        }
        finally {
            for (const bitmap of bitmaps)
                bitmap?.close();
        }
    }
    /**
     * Install a catalog's engines. `base` is the catalog folder URL (ending in
     * "/"); `hullUnit` the world size of hull radius 1 at draw scale 1. A newer
     * call supersedes an older one still loading.
     */
    async load(fx, base, hullUnit) {
        const generation = ++this.generation;
        const [ribbons, glows] = await Promise.all([
            this.loadArray("ship-fx-ribbons", base, fx?.ribbonImages ?? [], generation, false),
            this.loadArray("ship-fx-glows", base, fx?.glowImages ?? [], generation, true),
        ]);
        if (generation !== this.generation) {
            ribbons?.texture.destroy();
            glows?.texture.destroy();
            return;
        }
        this.install(fx, hullUnit, ribbons, glows);
    }
    /** Textures first, then the table that names their layers. */
    install(fx, hullUnit, ribbons, glows) {
        const previous = [this.ribbons.texture, this.glows.texture];
        this.ribbons = ribbons ?? this.placeholder("ship-fx-ribbons");
        this.glows = glows ?? this.placeholder("ship-fx-glows");
        this.bind = null;
        this.onRibbonsChanged();
        this.device.queue.writeBuffer(this.table, 0, packShipFx(fx, hullUnit));
        this.writeScreen(true);
        this.copiesOn = false; // packShipFx leaves header.y = 0; the readback turns copies on
        this.glowsConfigured = glows !== null && (fx?.classes.some((c) => c.glows.length) ?? false);
        this.ribbonsConfigured = ribbons !== null && (fx?.classes.some((c) => c.emitters.length) ?? false);
        // Destroy waits for already-submitted work that still uses the old textures.
        for (const texture of previous)
            texture.destroy();
    }
    /** Before trail expansion each frame: no engine ribbons, no glow ships; map last frame's snapshot. */
    resetFrame() {
        this.frame++;
        this.device.queue.writeBuffer(this.glowList, 0, this.resetArgs);
        if (this.probeState !== "copied")
            return;
        this.probeState = "mapping";
        this.probe.mapAsync(GPUMapMode.READ).then(() => {
            const words = new Uint32Array(this.probe.getMappedRange());
            if (words[SHIP_ENGINE_GLOW_ARGS_BYTE / 4 + 1] > 0)
                this.lastGlowFrame = this.frame;
            if (words[6] > 0)
                this.lastEngineFrame = this.frame;
            this.adjustGlowFloor(words[10]);
            this.glowShipsDrawn = glowDrawShips(words[10]);
            this.probe.unmap();
            this.probeState = "idle";
        }, () => { this.probeState = "idle"; });
        this.updateCopies();
    }
    /** Render px of hull diameter per hull radius over view depth: projection[5] × render height. */
    setScreenScale(pxPerRadiusDepth) {
        this.screenScale = Number.isFinite(pxPerRadiusDepth) ? pxPerRadiusDepth : 0;
        this.writeScreen();
    }
    /** Diagnostics: one style layer (mip level 0) as uploaded, to compare with the baked image. */
    async readbackStyle(kind, layer) {
        const { texture } = kind === "ribbons" ? this.ribbons : this.glows;
        const { width, height, rgba } = await readGpuTextureRgba8(this.device, texture, { layer });
        return { width, height, rgba };
    }
    /** Diagnostics: the glow-ship diameter floor in render px (0 = none). */
    get glowFloor() { return this.glowFloorPx; }
    /** The glow-ship floor follows the read demand (nextGlowFloorPx). */
    adjustGlowFloor(demand) {
        this.glowFloorPx = nextGlowFloorPx(this.glowFloorPx, demand);
        this.writeScreen();
    }
    writeScreen(force = false) {
        const floor = Math.fround(this.glowFloorPx), scale = Math.fround(this.screenScale);
        if (!force && this.screenData[0] === floor && this.screenData[1] === scale)
            return;
        this.screenData[0] = floor;
        this.screenData[1] = scale;
        this.device.queue.writeBuffer(this.table, 8, this.screenData);
    }
    /** Engine copies follow the readback; the table flag and the draw gate change together. */
    updateCopies() {
        const on = this.ribbonsConfigured && this.frame - this.lastEngineFrame <= GLOW_QUIET_FRAMES;
        if (on === this.copiesOn)
            return;
        this.copiesOn = on;
        this.copiesFlag[0] = on ? 1 : 0;
        this.device.queue.writeBuffer(this.table, 4, this.copiesFlag);
    }
    /** After trail expansion (same encoder): snapshot the counts for a later read, one at a time. */
    sampleCounts(encoder) {
        if (!(this.glowsConfigured || this.ribbonsConfigured) || this.probeState !== "idle")
            return;
        encoder.copyBufferToBuffer(this.glowList, 0, this.probe, 0, SHIP_ENGINE_HEADER_WORDS * 4);
        this.probeState = "copied";
    }
    /** Built on first use: only catalogs with glows pay for the shader. */
    pipeline() {
        if (this.glowPipeline)
            return this.glowPipeline;
        const module = this.device.createShaderModule({ label: "engine-glows", code: sceneTrailDrawShader(FLEET_TRAILS_WGSL + ENGINE_GLOW_WGSL) });
        const constants = { glowDepthReversed: Number(this.depth.opaqueCompare === "greater") };
        this.glowPipeline = this.device.createRenderPipeline({
            label: "engine-glows", layout: "auto",
            // Instances come from the engine list (glow ships) and the class table.
            vertex: { module, entryPoint: "vs_glow", constants },
            fragment: { module, entryPoint: "fs_glow", targets: [{ format: this.format, blend: {
                            color: { srcFactor: "one", dstFactor: "one", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one", operation: "add" }
                        } }] },
            // No depth attachment: the shader reads the depth texture instead of testing it.
            primitive: { topology: "triangle-list", cullMode: "none" },
        });
        return this.glowPipeline;
    }
    /**
     * Draw this frame's glows (after expansion; GPU-sized) in a pass without a
     * depth attachment; `depth` is the single-sample scene depth after hulls.
     */
    encodeGlows(pass, view, projection, width, height, depth) {
        if (!this.glowsConfigured || this.frame - this.lastGlowFrame > GLOW_QUIET_FRAMES)
            return;
        const pipeline = this.pipeline();
        if (this.bind?.pipeline !== pipeline || this.bind.depth !== depth || this.bind.glows !== this.glows.view) {
            this.bind = { pipeline, depth, glows: this.glows.view, group: this.device.createBindGroup({ label: "engine-glows", layout: pipeline.getBindGroupLayout(0), entries: [
                        { binding: 0, resource: { buffer: this.uniform } }, { binding: 2, resource: this.sampler },
                        { binding: 4, resource: this.glows.view }, { binding: 5, resource: depth }, { binding: 7, resource: { buffer: this.table } },
                        { binding: 8, resource: { buffer: this.glowList } }
                    ] }) };
        }
        writeTrailUniforms(this.uniformData, view, projection, width, height);
        this.device.queue.writeBuffer(this.uniform, 0, this.uniformData);
        pass.setPipeline(pipeline);
        bindSceneCamera(this.device, pass, pipeline);
        pass.setBindGroup(0, this.bind.group);
        // Direct, not indirect: an indirect draw would add a validation pass here.
        pass.draw(SHIP_GLOW_VERTICES, this.glowShipsDrawn * SHIP_FX_MAX_GLOWS);
    }
    destroy() {
        this.generation++;
        this.ribbons.texture.destroy();
        this.glows.texture.destroy();
        this.table.destroy();
        this.glowList.destroy();
        this.uniform.destroy();
        this.probe.destroy();
    }
}
//# sourceMappingURL=engine-fx-gpu.js.map