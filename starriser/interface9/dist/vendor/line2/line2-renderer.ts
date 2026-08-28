/**
 * Long-lived fat-line helper: GPU buffers, bind groups, upload, encode.
 *
 * Usage sketch:
 *   const lines = new Line2Renderer(device, { format });
 *   lines.setResolution(w, h);
 *   lines.setMaterial({ color: [1,0,0,1], linewidth: 3 });
 *   lines.setPositions(segmentOrPolylineFloats, { polyline: true });
 *   // each frame:
 *   lines.writeCamera({ modelView: view, projection: proj });
 *   lines.encode(pass);
 */

import {
  assertHasPositionsForColors,
  assertPackedColorLength,
  assertPackedDistanceLength,
  clearGeometryFlags,
  distanceUploadMode,
  growInstanceCapacity,
} from "./line2-attr-state.js";
import {
  buildTemplateInterleaved,
  computeLineDistances,
  LINE2_COLOR_FLOATS,
  LINE2_DIST_FLOATS,
  LINE2_POS_FLOATS,
  LINE2_TEMPLATE_INDEX_COUNT,
  LINE2_TEMPLATE_INDICES,
  packSegmentColors,
  packSegmentPositions,
  polylineColorsToSegments,
  polylineToSegments,
} from "./line-geometry.js";
import {
  applyMaterialParams,
  createDefaultMaterialState,
  LINE2_UNIFORM_FLOATS,
  LINE2_UNIFORM_SIZE,
  type Line2MaterialState,
  writeMaterialUniforms,
  writeMat4,
  writeOriginUniforms,
} from "./line2-material.js";
import {
  createLine2Pipeline,
  type Line2PipelineBundle,
} from "./line2-pipeline.js";
import type {
  Line2CameraUniforms,
  Line2MaterialParams,
  Line2RendererOptions,
} from "./types.js";

/** Re-export capacity helper (also on `line2-attr-state` / package index). */
export { ensureSize } from "./line2-attr-state.js";

const IDENTITY16 = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

function createFilledBuffer(
  device: GPUDevice,
  label: string,
  data: Float32Array | Uint16Array,
  usage: GPUBufferUsageFlags,
): GPUBuffer {
  const buf = device.createBuffer({
    label,
    size: data.byteLength,
    usage,
    mappedAtCreation: true,
  });
  const dst = new Uint8Array(buf.getMappedRange());
  dst.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  buf.unmap();
  return buf;
}

export class Line2Renderer {
  readonly device: GPUDevice;
  private readonly material: Line2MaterialState;
  private readonly uniformData = new Float32Array(LINE2_UNIFORM_FLOATS);

  private pipelineBundle: Line2PipelineBundle | null = null;
  private pipelineDepthWrite: boolean;
  private pipelineDepthTest: boolean;
  private readonly pipelineOpts: Line2RendererOptions;

  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;

  private templateVertexBuffer: GPUBuffer | null = null;
  private templateIndexBuffer: GPUBuffer | null = null;

  private instancePosBuffer: GPUBuffer | null = null;
  private instanceColorBuffer: GPUBuffer | null = null;
  private instanceDistBuffer: GPUBuffer | null = null;
  private posCapacity = 0; // segments
  private colorCapacity = 0;
  private distCapacity = 0;

  private segmentCount = 0;
  private hasColors = false;
  private hasDistances = false;

  private disposed = false;
  private uniformsDirty = true;
  private originX = 0;
  private originY = 0;
  private originZ = 0;

  constructor(device: GPUDevice, options: Line2RendererOptions) {
    this.device = device;
    this.pipelineOpts = options;
    this.material = createDefaultMaterialState(options.material);
    this.pipelineDepthWrite = this.material.depthWrite;
    this.pipelineDepthTest = this.material.depthTest;
    this.initGpu();
  }

  private initGpu(): void {
    const device = this.device;
    this.pipelineBundle = createLine2Pipeline(device, {
      format: this.pipelineOpts.format,
      sampleCount: this.pipelineOpts.sampleCount,
      alphaToCoverage: this.pipelineOpts.alphaToCoverage,
      // undefined → pipeline default null (no depthStencil; Galaxy color-only).
      depthFormat: this.pipelineOpts.depthFormat,
      depthWrite: this.material.depthWrite,
      depthCompare: this.material.depthTest ? "less" : "always",
    });

    this.uniformBuffer = device.createBuffer({
      label: "line2-uniforms",
      size: LINE2_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = device.createBindGroup({
      label: "line2-bind",
      layout: this.pipelineBundle.bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    const template = buildTemplateInterleaved();
    this.templateVertexBuffer = createFilledBuffer(
      device,
      "line2-template-verts",
      template,
      GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    );
    this.templateIndexBuffer = createFilledBuffer(
      device,
      "line2-template-indices",
      LINE2_TEMPLATE_INDICES,
      GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    );

    // Default identity camera so a first encode before writeCamera is safe.
    writeMat4(this.uniformData, 0, IDENTITY16);
    writeMat4(this.uniformData, 16, IDENTITY16);
    writeMaterialUniforms(this.uniformData, this.material);
    writeOriginUniforms(this.uniformData, 0, 0, 0);

    // Seed empty instance buffers (1 dummy segment) so layout always binds.
    // ensureInstanceBuffers → seedColorsOnly / seedDistancesOnly (hasDistances).
    this.ensureInstanceBuffers(1);
  }

  /**
   * Recreate pipeline when depth flags change (rare).
   * Material color/width/dash flags are uniform-only and need no rebuild.
   */
  private maybeRebuildPipeline(): void {
    if (
      this.pipelineDepthWrite === this.material.depthWrite &&
      this.pipelineDepthTest === this.material.depthTest
    ) {
      return;
    }
    this.pipelineDepthWrite = this.material.depthWrite;
    this.pipelineDepthTest = this.material.depthTest;
    this.pipelineBundle = createLine2Pipeline(this.device, {
      format: this.pipelineOpts.format,
      sampleCount: this.pipelineOpts.sampleCount,
      alphaToCoverage: this.pipelineOpts.alphaToCoverage,
      depthFormat: this.pipelineOpts.depthFormat,
      depthWrite: this.material.depthWrite,
      depthCompare: this.material.depthTest ? "less" : "always",
    });
    this.bindGroup = this.device.createBindGroup({
      label: "line2-bind",
      layout: this.pipelineBundle.bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer! } }],
    });
  }

  private ensureInstanceBuffers(segmentCap: number): void {
    const device = this.device;
    const need = Math.max(segmentCap, 1);

    if (need > this.posCapacity || !this.instancePosBuffer) {
      const cap = growInstanceCapacity(need, this.posCapacity);
      this.instancePosBuffer?.destroy();
      this.instancePosBuffer = device.createBuffer({
        label: "line2-instance-pos",
        size: cap * LINE2_POS_FLOATS * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.posCapacity = cap;
    }
    if (need > this.colorCapacity || !this.instanceColorBuffer) {
      const cap = growInstanceCapacity(need, this.colorCapacity);
      this.instanceColorBuffer?.destroy();
      this.instanceColorBuffer = device.createBuffer({
        label: "line2-instance-color",
        size: cap * LINE2_COLOR_FLOATS * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.colorCapacity = cap;
      // Grow invalidates prior color upload — default white until setColors.
      // hasColors=false; material.vertexColors is left alone if it was true
      // (e.g. after grow while vertexColors was enabled) — setColors must
      // re-run after grow to restore per-vertex color data on the new buffer.
      // Contract: invalidateColorsOnGrow (unit-tested pure helper).
      this.hasColors = false;
      this.seedColorsOnly(cap);
    }
    if (need > this.distCapacity || !this.instanceDistBuffer) {
      const cap = growInstanceCapacity(need, this.distCapacity);
      this.instanceDistBuffer?.destroy();
      this.instanceDistBuffer = device.createBuffer({
        label: "line2-instance-dist",
        size: cap * LINE2_DIST_FLOATS * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
      this.distCapacity = cap;
      // seedDistancesOnly sets hasDistances=true so solid setPositions does
      // not re-upload zero distances every subsequent frame.
      this.seedDistancesOnly(cap);
    }
  }

  /** Default white instance colors only — never touches distances. */
  private seedColorsOnly(segmentCount: number): void {
    const n = Math.max(segmentCount, 1);
    const colors = new Float32Array(n * LINE2_COLOR_FLOATS);
    colors.fill(1);
    this.device.queue.writeBuffer(this.instanceColorBuffer!, 0, colors);
  }

  /**
   * Zero dash distances only — never rewrites colors.
   * Marks hasDistances so solid setPositions will not re-upload every frame.
   */
  private seedDistancesOnly(segmentCount: number): void {
    const n = Math.max(segmentCount, 1);
    const dists = new Float32Array(n * LINE2_DIST_FLOATS);
    this.device.queue.writeBuffer(this.instanceDistBuffer!, 0, dists);
    this.hasDistances = true;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Canvas / drawing-buffer size in CSS or device pixels (must match the pass). */
  setResolution(width: number, height: number): void {
    this.assertLive();
    this.material.resolutionX = Math.max(width, 1);
    this.material.resolutionY = Math.max(height, 1);
    this.uniformsDirty = true;
  }

  /** Partial material update. */
  setMaterial(params: Line2MaterialParams): void {
    this.assertLive();
    applyMaterialParams(this.material, params);
    this.uniformsDirty = true;
    this.maybeRebuildPipeline();
  }

  /** Read-only snapshot of material state (for debugging). */
  getMaterial(): Readonly<Line2MaterialState> {
    return this.material;
  }

  /**
   * Upload segment positions.
   * @param positions Flat floats — segment pairs (xyz xyz) or polyline if `polyline`.
   */
  setPositions(
    positions: Float32Array | ArrayLike<number>,
    options?: {
      polyline?: boolean;
      /** Auto-run {@link computeLineDistances} after upload. Default: material.dashed. */
      computeDistances?: boolean;
    },
  ): void {
    this.assertLive();
    const packed = options?.polyline
      ? polylineToSegments(positions)
      : packSegmentPositions(positions);
    const segmentCount = packed.length / LINE2_POS_FLOATS;
    this.ensureInstanceBuffers(Math.max(segmentCount, 1));
    if (segmentCount > 0) {
      this.device.queue.writeBuffer(this.instancePosBuffer!, 0, packed);
    }
    this.segmentCount = segmentCount;

    const wantDist =
      options?.computeDistances ?? this.material.dashed;
    const distMode = distanceUploadMode(
      this.hasDistances,
      wantDist,
      segmentCount,
    );
    if (distMode === "compute") {
      const dist = computeLineDistances(packed);
      this.device.queue.writeBuffer(this.instanceDistBuffer!, 0, dist);
      this.hasDistances = true;
    } else if (distMode === "seed") {
      // Solid path: seed zero distances only — never wipe colors.
      this.seedDistancesOnly(Math.max(segmentCount, 1));
    }
    // distMode === "skip": solid + hasDistances already (P05 churn)
  }

  /**
   * Upload per-endpoint RGB colors (same topology as last `setPositions`).
   * Enables material `vertexColors` unless you pass `{ enable: false }`.
   */
  setColors(
    colors: Float32Array | ArrayLike<number>,
    options?: { polyline?: boolean; enable?: boolean },
  ): void {
    this.assertLive();
    assertHasPositionsForColors(this.segmentCount);
    const packed = options?.polyline
      ? polylineColorsToSegments(colors)
      : packSegmentColors(colors, this.segmentCount);
    // Polyline expand alone does not know position segmentCount — enforce match.
    assertPackedColorLength(packed.length, this.segmentCount, {
      polyline: options?.polyline,
    });
    this.ensureInstanceBuffers(this.segmentCount);
    this.device.queue.writeBuffer(this.instanceColorBuffer!, 0, packed);
    this.hasColors = true;
    if (options?.enable !== false) {
      this.material.vertexColors = true;
      this.uniformsDirty = true;
    }
  }

  /**
   * Upload precomputed dash distances (2 floats/segment).
   * Prefer `setPositions(..., { computeDistances: true })` for polylines.
   */
  setDistances(distances: Float32Array | ArrayLike<number>): void {
    this.assertLive();
    const src =
      distances instanceof Float32Array
        ? distances
        : Float32Array.from(distances as ArrayLike<number>);
    assertPackedDistanceLength(src.length, this.segmentCount);
    this.ensureInstanceBuffers(Math.max(this.segmentCount, 1));
    this.device.queue.writeBuffer(this.instanceDistBuffer!, 0, src);
    this.hasDistances = true;
  }

  /**
   * Clear geometry (draw becomes a no-op until setPositions).
   * GPU instance buffers are kept; only segmentCount / attr flags reset.
   */
  clearGeometry(): void {
    this.assertLive();
    const bag = {
      segmentCount: this.segmentCount,
      hasColors: this.hasColors,
      hasDistances: this.hasDistances,
    };
    clearGeometryFlags(bag);
    this.segmentCount = bag.segmentCount;
    this.hasColors = bag.hasColors;
    this.hasDistances = bag.hasDistances;
  }

  /**
   * Floating origin subtracted in the VS (`instanceStart/End − origin`).
   * GPU instance positions stay absolute. Default (0,0,0).
   */
  setOrigin(x: number, y: number, z: number): void {
    this.assertLive();
    if (this.originX === x && this.originY === y && this.originZ === z) return;
    this.originX = x;
    this.originY = y;
    this.originZ = z;
    this.uniformsDirty = true;
  }

  /** Last origin written via {@link setOrigin} / {@link writeCamera}. */
  getOrigin(): { x: number; y: number; z: number } {
    return { x: this.originX, y: this.originY, z: this.originZ };
  }

  /**
   * Write model-view + projection matrices (column-major).
   * Call once per frame before `encode` (or whenever the camera moves).
   */
  writeCamera(camera: Line2CameraUniforms): void {
    this.assertLive();
    writeMat4(this.uniformData, 0, camera.modelView);
    writeMat4(this.uniformData, 16, camera.projection);
    if (camera.origin) {
      this.originX = camera.origin.x;
      this.originY = camera.origin.y;
      this.originZ = camera.origin.z;
    }
    this.uniformsDirty = true;
  }

  /**
   * Convenience: model is identity, `view` is camera view matrix.
   * Equivalent to `writeCamera({ modelView: view, projection })`.
   */
  writeViewProjection(
    view: ArrayLike<number>,
    projection: ArrayLike<number>,
    origin?: { readonly x: number; readonly y: number; readonly z: number },
  ): void {
    this.assertLive();
    this.writeCamera({
      modelView: view as Float32Array,
      projection: projection as Float32Array,
      origin,
    });
  }

  /**
   * Upload uniforms if dirty and issue the draw.
   * No-op when segmentCount is 0. Avoids allocations on the hot path.
   */
  encode(pass: GPURenderPassEncoder): void {
    this.assertLive();
    if (this.segmentCount === 0 || !this.pipelineBundle) return;

    if (this.uniformsDirty) {
      writeMaterialUniforms(this.uniformData, this.material);
      writeOriginUniforms(
        this.uniformData,
        this.originX,
        this.originY,
        this.originZ,
      );
      this.device.queue.writeBuffer(
        this.uniformBuffer!,
        0,
        this.uniformData.buffer,
        this.uniformData.byteOffset,
        LINE2_UNIFORM_SIZE,
      );
      this.uniformsDirty = false;
    }

    pass.setPipeline(this.pipelineBundle.pipeline);
    pass.setBindGroup(0, this.bindGroup!);
    pass.setVertexBuffer(0, this.templateVertexBuffer!);
    pass.setVertexBuffer(1, this.instancePosBuffer!);
    pass.setVertexBuffer(2, this.instanceColorBuffer!);
    pass.setVertexBuffer(3, this.instanceDistBuffer!);
    pass.setIndexBuffer(this.templateIndexBuffer!, "uint16");
    pass.drawIndexed(LINE2_TEMPLATE_INDEX_COUNT, this.segmentCount, 0, 0, 0);
  }

  /** Current segment count (0 if empty). */
  getSegmentCount(): number {
    return this.segmentCount;
  }

  /** Release all GPU resources. Renderer is unusable after this. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.uniformBuffer?.destroy();
    this.templateVertexBuffer?.destroy();
    this.templateIndexBuffer?.destroy();
    this.instancePosBuffer?.destroy();
    this.instanceColorBuffer?.destroy();
    this.instanceDistBuffer?.destroy();
    this.uniformBuffer = null;
    this.templateVertexBuffer = null;
    this.templateIndexBuffer = null;
    this.instancePosBuffer = null;
    this.instanceColorBuffer = null;
    this.instanceDistBuffer = null;
    this.bindGroup = null;
    this.pipelineBundle = null;
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("Line2Renderer: disposed");
  }
}
