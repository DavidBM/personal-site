import { PlanetMarkers } from './planet-markers.js';
import { MapLayerSignals } from './map-layers.js';
import { drawFleetPin, projectFleetPin } from './fleet-pin.js';
import { SystemSurveyDock } from './system-dock.js';
import { incomingScreen } from './incoming-markers.js';
import { SurveySignals } from './signals.js';
import { MAP_BODY_SAMPLES } from '../../map-msaa.js';
import { SurveyLayout } from './layout.js';
import { GalaxyStarField } from './star-field.js';
import { makeSurveyFont } from './pixel-font.js';
import { SURVEY_WGSL } from './survey.wgsl.js';
import { RibbonHits } from './ribbon-hits.js';
import { clusterMarkerDetail, drawClusterMarker, markerPulse } from './cluster-marker.js';
const INCOMING_BLUE = [.22, .66, 1];
const EMPTY_MIX = [0, 0, 0, 0];
/** Batched stars, map survey geometry and a final screen-space HUD. */
export class GalaxySurveyLayer {
    set mapOptions(value) { this.mapLayers.options = value; }
    setColonies(rows, reset = true) { this.mapLayers.set(rows, reset); }
    pickSelectedPin(x, y) {
        const hit = this.pinHit;
        return this.pinVisible && x >= hit.left && x <= hit.right && y >= hit.top && y <= hit.bottom ? { kind: 'fleet', id: hit.id } : null;
    }
    constructor(bootstrap, topology, coordinates, totals, surface) {
        this.planetMarkers = new PlanetMarkers();
        this.planetBodies = () => undefined;
        this.layout = new SurveyLayout();
        this.mapLayers = new MapLayerSignals();
        this.hits = new RibbonHits();
        this.incomingSystem = null;
        this.incoming = [];
        this.incomingBody = () => undefined;
        this.hoveredFleetRenderId = null;
        this.planetFleets = () => [];
        this.pinVisible = false;
        this.pinHit = { id: '', left: 0, right: 0, top: 0, bottom: 0 };
        this.selectedPin = () => undefined;
        this.pinPoint = { x: 0, y: 0, edge: false };
        this.incomingPoint = { x: 0, y: 0 };
        this.reducedMotion = false;
        this.dock = new SystemSurveyDock();
        this.mapCount = 0;
        this.inkAlpha = 1;
        this.vertices = null;
        this.data = new Float32Array(0);
        this.count = 0;
        this.layoutReady = false;
        this.screen = new Float32Array(4);
        this.markerInk = {
            icon: (x, y, r, color, alpha, symbol) => this.quad(x - r - 2, y - r - 2, (r + 2) * 2, (r + 2) * 2, color, alpha, -4, symbol, 0, r),
            dot: (x, y, r, color, alpha, outline = 0) => {
                const extent = r + outline + 2;
                this.quad(x - extent, y - extent, extent * 2, extent * 2, color, alpha, -5, outline, 0, r);
            },
            faceTriangle: (x, y, nx, ny, color, alpha) => {
                // One analytic instance, centered outside the populated hex face.
                this.quad(x + nx * 5.5 - 8, y + ny * 5.5 - 8, 16, 16, color, alpha, -8, 0, nx, ny);
            },
            text: (text, x, y, color, alpha) => this.text(text, x, y, color, alpha),
            ribbon: (x, y, w, h, side, inset, slope, color, alpha, id, section, systemId, owned) => {
                this.quad(x, y, w, h, color, alpha, owned ? -9 : -6, side, inset, slope);
                this.hits.add(x, y, w, h, side, inset, slope, alpha * this.inkAlpha, id, section, systemId, owned);
            },
            edge: (ax, ay, bx, by, color, alpha, thickness) => {
                if (alpha <= 0)
                    return;
                const x = Math.min(ax, bx) - 3, y = Math.min(ay, by) - 3;
                this.quad(x, y, Math.abs(bx - ax) + 6, Math.abs(by - ay) + 6, color, alpha, -7, thickness);
                const o = (this.count - 1) * 16 + 12;
                this.data[o] = ax - x;
                this.data[o + 1] = ay - y;
                this.data[o + 2] = bx - x;
                this.data[o + 3] = by - y;
            },
            alertHit: (x, y, r, alpha, id, systemId) => this.hits.add(x - r, y - r, r * 2, r * 2, 2, r, 0, alpha * this.inkAlpha, id, 'battles', systemId),
        };
        this.planetInk = { ...this.markerInk, plate: (x, y, w, h, color) => this.quad(x, y, w, h, color, 1, -9) };
        this.pinInk = { ...this.markerInk, plate: (x, y, w, h, color) => this.quad(x, y, w, h, color, 1, -6) };
        this.surface = surface;
        this.bootstrap = bootstrap;
        this.topology = topology;
        this.signals = new SurveySignals(topology);
        this.coordinates = coordinates;
        this.totals = totals;
        const { device, format } = bootstrap;
        this.stars = new GalaxyStarField(bootstrap);
        const module = device.createShaderModule({ label: 'galaxy-survey', code: SURVEY_WGSL });
        const bindings = device.createBindGroupLayout({ entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
            ] });
        const descriptor = { label: 'galaxy-survey', layout: device.createPipelineLayout({ bindGroupLayouts: [bindings] }), vertex: { module, entryPoint: 'vs', buffers: [{
                        arrayStride: 64, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }, { shaderLocation: 2, offset: 32, format: 'float32x4' }, { shaderLocation: 3, offset: 48, format: 'float32x4' }]
                    }] },
            fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] }, primitive: { topology: 'triangle-list' }, multisample: { count: MAP_BODY_SAMPLES } };
        this.pipeline = device.createRenderPipeline(descriptor);
        this.hudPipeline = MAP_BODY_SAMPLES === 1 ? this.pipeline : device.createRenderPipeline({ ...descriptor,
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.pipeline.getBindGroupLayout(0)] }), multisample: { count: 1 } });
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
            this.layout.collapsedClusters.clear();
            return;
        }
        this.layout.update(this.topology.clusterLodMeta, this.topology.surveyRevision, this.coordinates.galaxy, width, height, height / (2 * tanHalfFov), this.topology.sceneSystems, this.totals);
    }
    consumeLayout(frame) {
        if (!this.layoutReady)
            this.prepareLayout(frame.cssWidth, frame.cssHeight, frame.tanHalfFov, frame.strategicVisible && frame.galaxyFade >= 0.02);
        this.layoutReady = false;
    }
    prepare(frame) {
        this.count = 0;
        this.hits.clear();
        this.planetMarkers.clearHits();
        this.pinVisible = false;
        this.mapCount = 0;
        this.screen[2] = 1;
        this.consumeLayout(frame);
        // Development owns the foreground UI. Clear ink and hit targets without
        // changing the player's map-layer preferences or rebuilding hidden labels.
        if (frame.sceneLabelsVisible === false) {
            this.selectedPinRenderId = undefined;
            return;
        }
        const dock = this.dock.update(frame, this.topology, this.coordinates, this.layout.visible, this.reducedMotion);
        this.reserve(this.layout.visible.length * 28 + 64 * 180 + 64 * 100 + 256 + this.incoming.length * 32);
        const pulse = markerPulse(frame.timeSec, this.reducedMotion);
        this.inkAlpha = frame.galaxyFade;
        if (frame.strategicVisible && frame.galaxyFade >= 0.02)
            this.drawMarkers(clusterMarkerDetail(frame.eyeY), pulse, dock?.systemId);
        this.mapCount = this.count;
        this.inkAlpha = 1;
        this.framePin = this.selectedPin();
        this.selectedPinRenderId = this.framePin?.renderId;
        this.drawIncoming(frame);
        this.drawPlanets(frame);
        if (dock)
            drawClusterMarker(dock, this.totals, this.markerInk, 1, this.signals, pulse);
        this.drawSelectedPin(frame);
        this.drawOwnedPins(frame, dock?.systemId);
        this.screen[0] = frame.cssWidth;
        this.screen[1] = frame.cssHeight;
        this.screen[3] = (this.surface?.width ?? frame.cssWidth) / frame.cssWidth;
        const { queue } = this.bootstrap.device;
        queue.writeBuffer(this.uniform, 0, this.screen);
        if (this.count)
            queue.writeBuffer(this.vertices, 0, this.data, 0, this.count * 16);
    }
    drawOwnedPins(frame, dockedId) {
        // Final HUD ink and hits share priority above clusters and scene effects.
        this.inkAlpha = frame.galaxyFade;
        if (!frame.strategicVisible || frame.galaxyFade < 0.02)
            return;
        const detail = clusterMarkerDetail(frame.eyeY);
        this.mapLayers.drawVisible(this.layout.visible, this.totals, this.markerInk, detail, frame.cssWidth, dockedId);
    }
    drawPlanets(frame) {
        if (!frame.sceneOpen)
            return;
        const bodies = this.planetBodies(), options = this.mapLayers.options.system;
        if (!bodies || !(options.planetOwners || options.ownPlanets))
            return;
        this.planetMarkers.draw(bodies.system, bodies.ids, bodies.mock, this.coordinates.system.viewProj, this.incomingBody, frame.cssWidth, frame.cssHeight, this.planetInk, options.planetOwners, options.ownPlanets, this.planetFleets(), this.framePin, this.hoveredFleetRenderId);
    }
    drawSelectedPin(frame) {
        const pin = this.framePin;
        if (!pin)
            return;
        if (this.hideSelectedPin(pin, frame))
            return;
        this.projectSelectedPin(pin, frame);
        this.pinHit.id = pin.id;
        this.pinVisible = !!this.pinHit.id;
        drawFleetPin(this.pinPoint, pin.state, pin.ships, this.pinInk, frame.cssWidth, pin.renderId === this.hoveredFleetRenderId, this.pinHit);
    }
    projectSelectedPin(pin, frame) {
        let x = pin.x, y = pin.y, z = pin.z;
        const scene = pin.exact && pin.systemId === frame.systemId && frame.sceneOpen;
        if (!scene && pin.systemId !== null && this.layout.collapsedClusters.has(pin.clusterId)) {
            const cluster = this.topology.clusterLodMeta.get(pin.clusterId);
            if (cluster) {
                x = cluster.x;
                y = 0;
                z = cluster.z;
            }
        }
        const origin = scene ? this.coordinates.system.anchor : this.coordinates.galaxy.origin;
        const matrix = scene ? this.coordinates.system.viewProj : this.coordinates.galaxy.viewProj;
        projectFleetPin(matrix, x - origin.x, y - origin.y, z - origin.z, frame.cssWidth, frame.cssHeight, this.pinPoint);
    }
    hideSelectedPin(pin, frame) {
        if (pin.renderId && this.planetMarkers.mergedFleetIds.has(pin.renderId))
            return true;
        // A strategic roster locates a system, not a fleet inside it. Wait for
        // an authorized local path/pose instead of placing a pin on the sun.
        return frame.sceneOpen && pin.systemId === frame.systemId && !pin.exact;
    }
    cluster(id) { return this.topology.clusterLodMeta.get(id); }
    drawIncoming(frame) {
        if (!frame.sceneOpen || frame.systemId !== this.incomingSystem)
            return;
        const color = INCOMING_BLUE, p = this.incomingPoint;
        for (const row of this.incoming) {
            const position = row.orbitBody == null ? row.position : this.incomingBody(row.orbitBody);
            if (!position || !incomingScreen(this.coordinates.system.viewProj, position, frame.cssWidth, frame.cssHeight, p))
                continue;
            this.markerInk.dot(p.x, p.y, 4, color, 1, 1.5);
            this.markerInk.edge(p.x, p.y - 6, p.x, p.y - 24, color, .85, 1.5);
            this.markerInk.edge(p.x - 5, p.y - 12, p.x, p.y - 6, color, 1, 1.5);
            this.markerInk.edge(p.x + 5, p.y - 12, p.x, p.y - 6, color, 1, 1.5);
            const width = Math.min(24, row.label.length) * 6 + 12;
            this.quad(p.x - width / 2, p.y - 44, width, 20, color, .95, -6);
            this.text(row.label, p.x - width / 2 + 5, p.y - 42, color);
        }
    }
    system(id) { return this.topology.sceneSystems.get(id); }
    fleetTotals() { return this.totals; }
    drawMarkers(detail, pulse, dockedId) {
        for (const a of this.layout.visible) {
            if (dockedId !== undefined && a.systemId === dockedId)
                continue;
            drawClusterMarker(a, this.totals, this.markerInk, detail, this.signals, pulse, this.mapLayers.color(a, this.totals));
        }
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
        d[o + 7] = alpha * this.inkAlpha;
        d[o + 8] = kind;
        d[o + 9] = dots;
        d[o + 10] = u;
        d[o + 11] = v;
        for (let i = 0; i < 4; i++)
            d[o + 12 + i] = mix[i];
    }
    text(text, x, y, rgb, alpha = 1) {
        for (let i = 0; i < Math.min(24, text.length); i++) {
            const char = text.charCodeAt(i);
            const code = (char >= 32 && char < 127 ? char : 63) - 32;
            this.quad(x + i * 6, y, 8, 16, rgb, alpha, 0, 0, (code % 32) * 8, Math.floor(code / 32) * 16);
        }
    }
    encodeBackground(pass, frame) {
        if (this.topology.clusterLodMeta.size)
            this.stars.encode(pass, frame, this.coordinates, this.layout.bounds);
    }
    encodeHud(encoder, target) {
        if (this.count === this.mapCount)
            return;
        const pass = encoder.beginRenderPass({ label: 'system-survey-hud', colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }] });
        this.encode(pass, true);
        pass.end();
    }
    encode(pass, hud = false) {
        const first = hud ? this.mapCount : 0, count = hud ? this.count - this.mapCount : this.mapCount;
        if (!count || !this.vertices)
            return;
        pass.setPipeline(hud ? this.hudPipeline : this.pipeline);
        pass.setBindGroup(0, this.bind);
        pass.setVertexBuffer(0, this.vertices);
        pass.draw(6, count, 0, first);
    }
    dispose() { this.stars.dispose(); this.vertices?.destroy(); this.uniform.destroy(); this.atlas.destroy(); }
}
/** Upload exact bitmap ink once; nearest sampling preserves single-pixel strokes. */
function makeAtlas(device) {
    const atlas = device.createTexture({ label: 'survey-glyph-atlas', size: [256, 64], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: atlas }, makeSurveyFont(), { bytesPerRow: 256 * 4 }, [256, 64]);
    return atlas;
}
//# sourceMappingURL=survey-layer.js.map