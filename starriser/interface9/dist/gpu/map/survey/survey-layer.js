import { RELATIONSHIP_COLORS } from '../../../contracts/fleet-relationship.js';
import { MAP_BODY_SAMPLES } from '../../map-msaa.js';
import { SurveyLayout, LABEL_WIDTH, LABEL_HEIGHT } from './layout.js';
import { GalaxyStarField } from './star-field.js';
import { makeSurveyFont } from './pixel-font.js';
import { SURVEY_WGSL } from './survey.wgsl.js';
const EMPTY_MIX = [0, 0, 0, 0];
const WHITE = [1, 1, 1], TEXT = [0.95, 0.95, 0.95], MUTED = [0.72, 0.72, 0.72];
/** Two batched draws: static background stars and bounded screen-space survey geometry. */
export class GalaxySurveyLayer {
    constructor(bootstrap, topology, coordinates, totals, surface) {
        this.layout = new SurveyLayout();
        this.vertices = null;
        this.data = new Float32Array(0);
        this.count = 0;
        this.layoutReady = false;
        this.screen = new Float32Array(4);
        this.textCache = new Map();
        this.revision = -1;
        this.labelKeys = new Set();
        this.surface = surface;
        this.bootstrap = bootstrap;
        this.topology = topology;
        this.coordinates = coordinates;
        this.totals = totals;
        const { device, format } = bootstrap;
        this.stars = new GalaxyStarField(bootstrap);
        const module = device.createShaderModule({ label: 'galaxy-survey', code: SURVEY_WGSL });
        this.pipeline = device.createRenderPipeline({ label: 'galaxy-survey', layout: 'auto', vertex: { module, entryPoint: 'vs', buffers: [{
                        arrayStride: 64, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }, { shaderLocation: 2, offset: 32, format: 'float32x4' }, { shaderLocation: 3, offset: 48, format: 'float32x4' }]
                    }] },
            fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] }, primitive: { topology: 'triangle-list' }, multisample: { count: MAP_BODY_SAMPLES } });
        this.uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.atlas = makeAtlas(device);
        this.bind = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [
                { binding: 0, resource: { buffer: this.uniform } }, { binding: 1, resource: this.atlas.createView() },
                { binding: 2, resource: device.createSampler({ minFilter: 'nearest', magFilter: 'nearest' }) }
            ] });
    }
    /** Run before topology LOD/upload so panel admission and geometry agree this frame. */
    prepareLayout(width, height, tanHalfFov, visible = true) {
        this.layoutReady = true;
        if (!visible) {
            this.layout.panelClusters.clear();
            return;
        }
        this.layout.update(this.topology.clusterLodMeta, this.topology.surveyRevision, this.coordinates.galaxy, width, height, height / (2 * tanHalfFov), this.topology.sceneSystems, this.totals);
    }
    consumeLayout(frame) {
        if (!this.layoutReady)
            this.prepareLayout(frame.cssWidth, frame.cssHeight, frame.tanHalfFov, frame.galaxyFade >= 0.02);
        this.layoutReady = false;
    }
    prepare(frame) {
        this.count = 0;
        this.consumeLayout(frame);
        if (frame.galaxyFade < 0.02)
            return;
        if (this.revision !== this.topology.surveyRevision) {
            this.textCache.clear();
            this.revision = this.topology.surveyRevision;
        }
        this.reserve(this.layout.visible.length + 64 * 84);
        for (const a of this.layout.visible)
            if (!a.label)
                this.ring(a);
        this.labelKeys.clear();
        for (const a of this.layout.visible)
            if (a.label)
                this.label(a);
        this.pruneTextCache();
        this.screen[0] = frame.cssWidth;
        this.screen[1] = frame.cssHeight;
        this.screen[2] = frame.galaxyFade;
        this.screen[3] = (this.surface?.width ?? frame.cssWidth) / frame.cssWidth;
        const { queue } = this.bootstrap.device;
        queue.writeBuffer(this.uniform, 0, this.screen);
        if (this.count)
            queue.writeBuffer(this.vertices, 0, this.data, 0, this.count * 16);
    }
    pruneTextCache() {
        for (const id of this.textCache.keys())
            if (!this.labelKeys.has(id))
                this.textCache.delete(id);
    }
    reserve(count) {
        if (this.data.length >= count * 16)
            return;
        this.data = new Float32Array(Math.max(count * 16, this.data.length * 2, 4096));
        this.vertices?.destroy();
        this.vertices = this.bootstrap.device.createBuffer({ label: 'galaxy-survey-instances', size: this.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    quad(x, y, w, h, rgb, alpha, kind, dots = 0, u = 0, v = 0, mix = EMPTY_MIX) {
        const d = this.data, o = this.count++ * 16;
        d[o] = x;
        d[o + 1] = y;
        d[o + 2] = w;
        d[o + 3] = h;
        d[o + 4] = rgb[0];
        d[o + 5] = rgb[1];
        d[o + 6] = rgb[2];
        d[o + 7] = alpha;
        d[o + 8] = kind;
        d[o + 9] = dots;
        d[o + 10] = u;
        d[o + 11] = v;
        for (let i = 0; i < 4; i++)
            d[o + 12 + i] = mix[i];
    }
    ring(a) {
        const size = (a.radius + 2) * 2;
        const dots = a.radius < 6 ? 8 : a.radius < 9 ? 12 : 20;
        const mix = this.mix(a);
        const fleets = mix[0] + mix[1] + mix[2] + mix[3];
        this.quad(a.x - a.radius - 2, a.y - a.radius - 2, size, size, a.rgb, 0.95, -1, dots, Math.min(fleets, dots), a.radius, mix);
    }
    mix(a) {
        return this.totals.getRelationships(a.systemId ?? a.meta.clusterId, a.systemId !== undefined);
    }
    bar(a) {
        const mix = this.mix(a), total = mix[0] + mix[1] + mix[2] + mix[3];
        let fraction = 0;
        for (let i = 0; i < 4; i++) {
            const next = fraction + mix[i] / Math.max(1, total);
            if (next > fraction)
                this.quad(a.left + 1, a.top + 1 + fraction * (LABEL_HEIGHT - 2), 3, (next - fraction) * (LABEL_HEIGHT - 2), RELATIONSHIP_COLORS[i], 1, -3);
            fraction = next;
        }
    }
    label(a) {
        const meta = a.meta, system = a.systemId;
        const total = system === undefined ? this.totals.get(meta.clusterId) : this.totals.getSystem(system);
        const outbound = 'outbound' in total ? total.outbound : this.totals.getOutbound(meta.clusterId);
        const transit = transitCount(total);
        const cacheId = system === undefined ? `c${meta.clusterId}` : `s${system}`;
        this.labelKeys.add(cacheId);
        const key = `${meta.name}/${meta.systemIds.length}/${total.fleets}/${transit}/${total.inbound}/${outbound}`;
        let cached = this.textCache.get(cacheId);
        if (cached?.key !== key) {
            const lines = system === undefined
                ? [meta.name.toUpperCase().slice(0, 24), `${meta.systemIds.length} SYS  ${total.fleets + transit} FLEETS`, `${transit} TR ${total.inbound} IN ${outbound} OUT`]
                : [meta.name.toUpperCase().slice(0, 24), `${a.isJumpGate ? 'GATE' : 'SYSTEM'}  ${total.fleets} FLEETS`, `${total.inbound} IN  ${transit} OUT`];
            cached = { key, lines };
            this.textCache.set(cacheId, cached);
        }
        this.quad(a.left, a.top, LABEL_WIDTH, LABEL_HEIGHT, WHITE, 1, -2);
        this.bar(a);
        for (let row = 0; row < 3; row++)
            this.text(cached.lines[row], a.left + 8, a.top + 2 + row * 13, row === 0 ? TEXT : MUTED);
    }
    text(text, x, y, rgb) {
        for (let i = 0; i < Math.min(24, text.length); i++) {
            const char = text.charCodeAt(i);
            const code = (char >= 32 && char < 127 ? char : 63) - 32;
            this.quad(x + i * 6, y, 8, 16, rgb, 1, 0, 0, (code % 32) * 8, Math.floor(code / 32) * 16);
        }
    }
    encodeBackground(pass, frame) {
        if (this.topology.clusterLodMeta.size)
            this.stars.encode(pass, frame, this.coordinates, this.layout.bounds);
    }
    encode(pass) {
        if (!this.count || !this.vertices)
            return;
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, this.bind);
        pass.setVertexBuffer(0, this.vertices);
        pass.draw(6, this.count);
    }
    dispose() { this.stars.dispose(); this.vertices?.destroy(); this.uniform.destroy(); this.atlas.destroy(); }
}
/** Upload exact bitmap ink once; nearest sampling preserves single-pixel strokes. */
function makeAtlas(device) {
    const atlas = device.createTexture({ label: 'survey-glyph-atlas', size: [256, 64], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: atlas }, makeSurveyFont(), { bytesPerRow: 256 * 4 }, [256, 64]);
    return atlas;
}
function transitCount(total) {
    return 'transit' in total ? total.transit : total.outbound;
}
//# sourceMappingURL=survey-layer.js.map