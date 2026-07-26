/**
 * Node tests for CPU Line2 screen-space expansion reference.
 *
 * Run after `./build.sh`:
 *   node js/vendor/line2/tests/expand-ref.test.mjs
 *   node js/vendor/line2/tests/run-line2-tests.mjs
 *
 * Exports `runExpandRefTests()` so a shared runner can import this module.
 */

import {
  expandLine2CornerScreenSpace,
  mat4Identity16,
  mat4Ortho16,
  nearPlaneEstimate,
  trimSegmentAlpha,
} from "../../../../dist/vendor/line2/line2-expand-ref.js";

/**
 * @param {{ assert?: (cond: boolean, msg: string) => void, log?: (msg: string) => void }} [opts]
 * @returns {{ failed: number, passed: number }}
 */
export function runExpandRefTests(opts = {}) {
  let failed = 0;
  let passed = 0;

  const log = opts.log ?? ((msg) => console.log(msg));
  const assert =
    opts.assert ??
    ((cond, msg) => {
      if (!cond) {
        console.error("FAIL:", msg);
        failed += 1;
      } else {
        log("ok: " + msg);
        passed += 1;
      }
    });

  const approxEq = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;
  const isFiniteClip = (c) =>
    c != null &&
    Number.isFinite(c.x) &&
    Number.isFinite(c.y) &&
    Number.isFinite(c.z) &&
    Number.isFinite(c.w);

  // --- Horizontal segment, identity MV + simple ortho -----------------------
  // View-space horizontal line along +X. Ortho maps x,y linearly; w=1.
  // Lateral offset in clip.xy must be perpendicular (vertical) with magnitude
  // ≈ linewidth / resolution.y * clip.w.
  {
    const modelView = mat4Identity16();
    // Ortho covering a generous box; z near/far straddles view z = -10
    const projection = mat4Ortho16(-100, 100, -100, 100, 0.1, 1000);
    const resolution = [800, 600];
    const linewidth = 4;
    const start = [0, 0, -10];
    const end = [20, 0, -10];

    const baseParams = {
      start,
      end,
      modelView,
      projection,
      resolution,
      linewidth,
    };

    // Body corner at start, side +1 (position.x >= 0 → no flip)
    const right = expandLine2CornerScreenSpace({
      ...baseParams,
      positionX: 1,
      positionY: 0, // start end of segment, body
    });
    const left = expandLine2CornerScreenSpace({
      ...baseParams,
      positionX: -1,
      positionY: 0,
    });

    // Un-offset clip at start (recompute by averaging sides — or project)
    // For horizontal dir, offset is pure ±Y after aspect handling.
    const midY = (left.y + right.y) * 0.5;
    const midX = (left.x + right.x) * 0.5;

    // Perpendicular: delta between sides should be nearly vertical (Δx ≈ 0)
    const dX = right.x - left.x;
    const dY = right.y - left.y;
    assert(
      Math.abs(dX) < 1e-4 * Math.max(1, Math.abs(dY)),
      `horizontal segment: side offset is perpendicular in NDC/clip (Δx=${dX}, Δy=${dY})`,
    );

    // Full thickness = |right - left|; each side offset magnitude = half of that
    // = linewidth / resolution.y * clip.w  (see line2-wgsl screen-space branch)
    const mag = 0.5 * Math.hypot(dX, dY);
    const expectedMag = (linewidth / resolution[1]) * right.w;
    assert(
      approxEq(mag, expectedMag, 1e-5),
      `horizontal segment: offset magnitude ≈ lw/res.y * clip.w ` +
        `(got ${mag}, expected ${expectedMag})`,
    );

    // Same w on both sides; finite
    assert(isFiniteClip(left) && isFiniteClip(right), "horizontal segment: finite clip");
    assert(approxEq(left.w, right.w), "horizontal segment: matching clip.w");
    assert(
      approxEq(midX, right.x - (right.x - left.x) * 0.5, 1e-6),
      `horizontal segment: mid stays on line (midX=${midX})`,
    );
    // mid Y should match un-offset projection (no lateral shift average)
    void midY;
  }

  // --- Zero-length segment → finite non-NaN (all template corners) ----------
  // Template y ∈ {−1,0,1,2}; both sides. Also mid-body y=0.5 for completeness.
  {
    const modelView = mat4Identity16();
    const projection = mat4Ortho16(-10, 10, -10, 10, 0.1, 100);
    const p = [1, 2, -5];
    const corners = [];
    for (const px of [-1, 1]) {
      for (const py of [-1, 0, 0.5, 1, 2]) {
        corners.push([px, py]);
      }
    }
    for (const [px, py] of corners) {
      const clip = expandLine2CornerScreenSpace({
        start: p,
        end: p,
        modelView,
        projection,
        resolution: [640, 480],
        linewidth: 3,
        positionX: px,
        positionY: py,
      });
      assert(
        isFiniteClip(clip),
        `zero-length multi-corner finite (side=${px}, along=${py}) ` +
          `→ (${clip.x},${clip.y},${clip.z},${clip.w})`,
      );
    }
    // Multiple zero-length corners share the same clip.z/w (only lateral offset differs)
    const a = expandLine2CornerScreenSpace({
      start: p,
      end: p,
      modelView,
      projection,
      resolution: [640, 480],
      linewidth: 3,
      positionX: 1,
      positionY: 0,
    });
    const b = expandLine2CornerScreenSpace({
      start: p,
      end: p,
      modelView,
      projection,
      resolution: [640, 480],
      linewidth: 3,
      positionX: -1,
      positionY: 0,
    });
    // Degenerate dir fallback is horizontal → lateral offset is vertical (Δy).
    assert(
      approxEq(a.z, b.z) &&
        approxEq(a.w, b.w) &&
        approxEq(a.x, b.x) &&
        a.y !== b.y,
      "zero-length: opposite sides differ in y (horizontal fallback dir), same x/z/w",
    );
  }

  // --- Endcaps: y<0 and y>1 shift along dir (both sides) --------------------
  {
    const modelView = mat4Identity16();
    const projection = mat4Identity16(); // clip = view, w=1, NDC = xyz
    const resolution = [100, 100]; // aspect = 1 → dir stays unit after aspect undo
    const linewidth = 2;
    const start = [0, 0, -1];
    const end = [10, 0, -1]; // horizontal +X in NDC
    const step = (linewidth / resolution[1]) * 1; // w=1

    for (const side of [1, -1]) {
      const bodyStart = expandLine2CornerScreenSpace({
        start,
        end,
        modelView,
        projection,
        resolution,
        linewidth,
        positionX: side,
        positionY: 0, // body at start
      });
      const capStart = expandLine2CornerScreenSpace({
        start,
        end,
        modelView,
        projection,
        resolution,
        linewidth,
        positionX: side,
        positionY: -1, // endcap past start
      });
      const bodyEnd = expandLine2CornerScreenSpace({
        start,
        end,
        modelView,
        projection,
        resolution,
        linewidth,
        positionX: side,
        positionY: 1, // body at end
      });
      const capEnd = expandLine2CornerScreenSpace({
        start,
        end,
        modelView,
        projection,
        resolution,
        linewidth,
        positionX: side,
        positionY: 2, // endcap past end
      });

      // With aspect=1, unit dir in NDC after normalize+undo = (1,0).
      // Endcap y<0: offset -= dir, then * lw / res.y * w
      const shiftStartX = capStart.x - bodyStart.x;
      const shiftStartY = capStart.y - bodyStart.y;
      const shiftEndX = capEnd.x - bodyEnd.x;
      const shiftEndY = capEnd.y - bodyEnd.y;

      assert(
        approxEq(shiftStartX, -step, 1e-5) && approxEq(shiftStartY, 0, 1e-5),
        `endcap y<0 side=${side} shifts along -dir (Δ=${shiftStartX},${shiftStartY}; step=${step})`,
      );
      assert(
        approxEq(shiftEndX, step, 1e-5) && approxEq(shiftEndY, 0, 1e-5),
        `endcap y>1 side=${side} shifts along +dir (Δ=${shiftEndX},${shiftEndY}; step=${step})`,
      );
      assert(
        bodyEnd.x > bodyStart.x,
        `endcap side=${side}: body end further +X (${bodyStart.x} → ${bodyEnd.x})`,
      );

      // Body corners at y=0 and y=1: lateral offset only (no along-dir endcap term)
      // Opposite sides must be mirrored about the centerline.
      const bodyStartOpp = expandLine2CornerScreenSpace({
        start,
        end,
        modelView,
        projection,
        resolution,
        linewidth,
        positionX: -side,
        positionY: 0,
      });
      const midX = (bodyStart.x + bodyStartOpp.x) * 0.5;
      const midY = (bodyStart.y + bodyStartOpp.y) * 0.5;
      // Centerline at start of segment: clip start ≈ (0, 0) for this setup
      assert(
        approxEq(midX, 0, 1e-4) && approxEq(midY, 0, 1e-4),
        `endcap body y=0 sides mirror about centerline (mid=${midX},${midY}) side=${side}`,
      );
    }

    // y=0.5 selects end clip (posY >= 0.5) but is still body (no endcap ±dir)
    const midBody = expandLine2CornerScreenSpace({
      start,
      end,
      modelView,
      projection,
      resolution,
      linewidth,
      positionX: 1,
      positionY: 0.5,
    });
    const bodyAtEnd = expandLine2CornerScreenSpace({
      start,
      end,
      modelView,
      projection,
      resolution,
      linewidth,
      positionX: 1,
      positionY: 1,
    });
    // Same base clip (end) and same lateral offset (no endcap) → identical
    assert(
      approxEq(midBody.x, bodyAtEnd.x, 1e-5) &&
        approxEq(midBody.y, bodyAtEnd.y, 1e-5),
      `endcap: y=0.5 body matches y=1 body at end clip (${midBody.x} vs ${bodyAtEnd.x})`,
    );

    // Vertical segment: endcaps shift along +Y / −Y
    {
      const vStart = [0, 0, -1];
      const vEnd = [0, 10, -1];
      const vBody0 = expandLine2CornerScreenSpace({
        start: vStart,
        end: vEnd,
        modelView,
        projection,
        resolution,
        linewidth,
        positionX: 1,
        positionY: 0,
      });
      const vCap0 = expandLine2CornerScreenSpace({
        start: vStart,
        end: vEnd,
        modelView,
        projection,
        resolution,
        linewidth,
        positionX: 1,
        positionY: -1,
      });
      const vBody1 = expandLine2CornerScreenSpace({
        start: vStart,
        end: vEnd,
        modelView,
        projection,
        resolution,
        linewidth,
        positionX: 1,
        positionY: 1,
      });
      const vCap1 = expandLine2CornerScreenSpace({
        start: vStart,
        end: vEnd,
        modelView,
        projection,
        resolution,
        linewidth,
        positionX: 1,
        positionY: 2,
      });
      assert(
        approxEq(vCap0.y - vBody0.y, -step, 1e-5) &&
          approxEq(vCap0.x - vBody0.x, 0, 1e-5),
        `vertical endcap y<0 shifts along -dir (Δy=${vCap0.y - vBody0.y})`,
      );
      assert(
        approxEq(vCap1.y - vBody1.y, step, 1e-5) &&
          approxEq(vCap1.x - vBody1.x, 0, 1e-5),
        `vertical endcap y>1 shifts along +dir (Δy=${vCap1.y - vBody1.y})`,
      );
    }

    // endcaps: false — skirt corners collapse to body ends (no along-dir push)
    {
      const body0 = expandLine2CornerScreenSpace({
        start,
        end,
        modelView,
        projection,
        resolution,
        linewidth,
        positionX: 1,
        positionY: 0,
        endcaps: false,
      });
      const skirt0 = expandLine2CornerScreenSpace({
        start,
        end,
        modelView,
        projection,
        resolution,
        linewidth,
        positionX: 1,
        positionY: -1,
        endcaps: false,
      });
      const body1 = expandLine2CornerScreenSpace({
        start,
        end,
        modelView,
        projection,
        resolution,
        linewidth,
        positionX: 1,
        positionY: 1,
        endcaps: false,
      });
      const skirt1 = expandLine2CornerScreenSpace({
        start,
        end,
        modelView,
        projection,
        resolution,
        linewidth,
        positionX: 1,
        positionY: 2,
        endcaps: false,
      });
      assert(
        approxEq(skirt0.x, body0.x, 1e-5) && approxEq(skirt0.y, body0.y, 1e-5),
        `endcaps:false y=-1 matches body y=0 (${skirt0.x},${skirt0.y} vs ${body0.x},${body0.y})`,
      );
      assert(
        approxEq(skirt1.x, body1.x, 1e-5) && approxEq(skirt1.y, body1.y, 1e-5),
        `endcaps:false y=2 matches body y=1 (${skirt1.x},${skirt1.y} vs ${body1.x},${body1.y})`,
      );
    }
  }

  // --- Perspective path still finite on a simple frustum --------------------
  {
    // RH perspective: fovy, aspect, near, far (column-major, matches gpu/math/mat4)
    const fovy = Math.PI / 3;
    const aspect = 16 / 9;
    const near = 0.5;
    const far = 100;
    const f = 1 / Math.tan(fovy / 2);
    const projection = new Float32Array(16);
    projection[0] = f / aspect;
    projection[5] = f;
    projection[10] = far / (near - far);
    projection[11] = -1;
    projection[14] = (far * near) / (near - far);
    const modelView = mat4Identity16();

    const clip = expandLine2CornerScreenSpace({
      start: [-1, 0, -5],
      end: [1, 0, -5],
      modelView,
      projection,
      resolution: [1920, 1080],
      linewidth: 2,
      positionX: 1,
      positionY: 0.5,
    });
    assert(
      isFiniteClip(clip) && clip.w !== 0,
      `perspective horizontal segment finite clip (w=${clip.w})`,
    );
  }

  // --- Aspect resolution: H vs V pixel thickness match (Three res.y path) ----
  // offset is scaled in NDC-aware clip space via aspect + /resolution.y so that
  // full ribbon width maps to `linewidth` CSS/buffer pixels on BOTH axes when
  // resolution is non-square. Golden: pixel Δ between opposite sides = lw.
  {
    const modelView = mat4Identity16();
    const projection = mat4Identity16(); // clip = view, w = 1
    const resolution = [1600, 900]; // aspect = 16/9 ≠ 1
    const aspect = resolution[0] / resolution[1];
    const linewidth = 6;
    const base = {
      modelView,
      projection,
      resolution,
      linewidth,
    };

    const sides = (start, end) => {
      const r = expandLine2CornerScreenSpace({
        ...base,
        start,
        end,
        positionX: 1,
        positionY: 0,
      });
      const l = expandLine2CornerScreenSpace({
        ...base,
        start,
        end,
        positionX: -1,
        positionY: 0,
      });
      return { r, l };
    };

    // Horizontal +X: lateral is pure ±Y; clip Δy_full = 2 * (lw / resY) * w
    {
      const { r, l } = sides([0, 0, -1], [10, 0, -1]);
      const dX = r.x - l.x;
      const dY = r.y - l.y;
      assert(
        Math.abs(dX) < 1e-5 && Math.abs(dY) > 0,
        `aspect H: lateral pure Y (Δx=${dX}, Δy=${dY})`,
      );
      const magClip = Math.hypot(dX, dY); // full thickness in clip/NDC (w=1)
      const pixelThick = magClip * (resolution[1] / 2);
      assert(
        approxEq(pixelThick, linewidth, 1e-4),
        `aspect H: pixel thickness = lw (got ${pixelThick}, lw=${linewidth})`,
      );
      // Clip half-offset magnitude = lw / resY * w
      assert(
        approxEq(0.5 * magClip, (linewidth / resolution[1]) * r.w, 1e-6),
        "aspect H: clip half-offset = lw/res.y * w",
      );
    }

    // Vertical +Y: lateral pure ±X after aspect undo; clip Δx smaller by 1/aspect
    // but pixel map uses resX → same pixel thickness.
    {
      const { r, l } = sides([0, 0, -1], [0, 10, -1]);
      const dX = r.x - l.x;
      const dY = r.y - l.y;
      assert(
        Math.abs(dY) < 1e-5 && Math.abs(dX) > 0,
        `aspect V: lateral pure X (Δx=${dX}, Δy=${dY})`,
      );
      const magClip = Math.hypot(dX, dY);
      const expectedHalfClip = (1 / aspect) * (linewidth / resolution[1]) * r.w;
      assert(
        approxEq(0.5 * magClip, expectedHalfClip, 1e-6),
        `aspect V: clip half-offset = (1/aspect)*lw/res.y*w ` +
          `(got ${0.5 * magClip}, expected ${expectedHalfClip})`,
      );
      const pixelThick = magClip * (resolution[0] / 2);
      assert(
        approxEq(pixelThick, linewidth, 1e-4),
        `aspect V: pixel thickness = lw (got ${pixelThick}, lw=${linewidth})`,
      );
    }

    // Same geometry under square resolution: H and V clip half-mags equal
    {
      const squareRes = [900, 900];
      const expandAt = (start, end, px) =>
        expandLine2CornerScreenSpace({
          modelView,
          projection,
          resolution: squareRes,
          linewidth,
          start,
          end,
          positionX: px,
          positionY: 0,
        });
      const hR = expandAt([0, 0, -1], [10, 0, -1], 1);
      const hL = expandAt([0, 0, -1], [10, 0, -1], -1);
      const vR = expandAt([0, 0, -1], [0, 10, -1], 1);
      const vL = expandAt([0, 0, -1], [0, 10, -1], -1);
      const hMag = 0.5 * Math.hypot(hR.x - hL.x, hR.y - hL.y);
      const vMag = 0.5 * Math.hypot(vR.x - vL.x, vR.y - vL.y);
      assert(
        approxEq(hMag, vMag, 1e-6) &&
          approxEq(hMag, linewidth / squareRes[1], 1e-6),
        `aspect square: H and V clip half-mags equal (${hMag} vs ${vMag})`,
      );
    }

    // resolution as {x,y} object must match tuple form
    {
      const tuple = expandLine2CornerScreenSpace({
        start: [0, 0, -1],
        end: [4, 0, -1],
        modelView,
        projection,
        resolution: [1280, 720],
        linewidth: 3,
        positionX: 1,
        positionY: 0,
      });
      const obj = expandLine2CornerScreenSpace({
        start: [0, 0, -1],
        end: [4, 0, -1],
        modelView,
        projection,
        resolution: { x: 1280, y: 720 },
        linewidth: 3,
        positionX: 1,
        positionY: 0,
      });
      assert(
        approxEq(tuple.x, obj.x) &&
          approxEq(tuple.y, obj.y) &&
          approxEq(tuple.z, obj.z) &&
          approxEq(tuple.w, obj.w),
        "aspect: resolution tuple ≡ {x,y} object",
      );
    }
  }

  // --- Near-plane trim (Three LineMaterial parity, not a local bug) ---------
  // Classic RH perspective: camera looks −Z; points in front have z < 0.
  // Three only trims segments that cross the *camera plane* (z=0), not the
  // near clip plane. nearEstimate is conservative (−0.5·near for default
  // depth) so the stub ends between camera and near. Residual thickness
  // spikes when geom skims near with both ends still in front (R01) are the
  // same offset*=clip.w / ndc=clip/w math as three.js — not a vendor bug.
  {
    const near = 0.5;
    const far = 100;
    const fovy = Math.PI / 3;
    const aspect = 16 / 9;
    const f = 1 / Math.tan(fovy / 2);
    const projection = new Float32Array(16);
    projection[0] = f / aspect;
    projection[5] = f;
    projection[10] = far / (near - far);
    projection[11] = -1;
    projection[14] = (far * near) / (near - far);
    const modelView = mat4Identity16();
    const resolution = [1920, 1080];
    const linewidth = 4;

    // nearEstimate for a < 0: −0.5 * b / a = −0.5 * near
    const ne = nearPlaneEstimate(projection);
    assert(
      approxEq(ne, -0.5 * near, 1e-6),
      `nearPlaneEstimate default depth = -0.5*near (got ${ne}, expected ${-0.5 * near})`,
    );

    // trimSegmentAlpha: start.z → end.z crosses nearEstimate
    const alpha = trimSegmentAlpha(-5, 5, projection);
    // (ne - (-5)) / (5 - (-5)) = (ne + 5) / 10
    assert(
      approxEq(alpha, (ne + 5) / 10, 1e-6),
      `trimSegmentAlpha golden (got ${alpha})`,
    );

    // Cross camera plane: start in front (z=-5), end behind (z=+5)
    // After trim, end clip base must stay finite; body corners finite.
    for (const px of [-1, 1]) {
      for (const py of [-1, 0, 0.5, 1, 2]) {
        const clip = expandLine2CornerScreenSpace({
          start: [0, 0, -5],
          end: [0, 0, 5],
          modelView,
          projection,
          resolution,
          linewidth,
          positionX: px,
          positionY: py,
        });
        assert(
          isFiniteClip(clip),
          `near-trim cross-camera finite (side=${px}, along=${py}) w=${clip.w}`,
        );
      }
    }

    // Trimmed end should sit at nearEstimate in view Z → clip.w ≈ -viewZ
    // for this proj (m[11]=-1). End body (y=1) w should be ~ -ne = 0.25
    // (not the untrimmed behind-camera projection).
    const endBody = expandLine2CornerScreenSpace({
      start: [0, 0, -5],
      end: [0, 0, 5],
      modelView,
      projection,
      resolution,
      linewidth,
      positionX: 1,
      positionY: 1,
    });
    // Untrimmed end at z=+5 would have clip.w = -5 (projection * (0,0,5,1)).
    // After trim end.z → ne ≈ -0.25, clip.w ≈ 0.25.
    assert(
      endBody.w > 0 && endBody.w < near,
      `near-trim: end body clip.w is front-of-camera stub (w=${endBody.w}, near=${near})`,
    );
    assert(
      approxEq(endBody.w, -ne, 1e-4),
      `near-trim: end clip.w ≈ -nearEstimate (got ${endBody.w}, -ne=${-ne})`,
    );

    // Reverse: start behind, end in front → start is trimmed; start body finite
    const startBody = expandLine2CornerScreenSpace({
      start: [0, 0, 5],
      end: [0, 0, -5],
      modelView,
      projection,
      resolution,
      linewidth,
      positionX: 1,
      positionY: 0,
    });
    assert(
      isFiniteClip(startBody) &&
        startBody.w > 0 &&
        startBody.w < near &&
        approxEq(startBody.w, -ne, 1e-4),
      `near-trim reverse: start body stub w=${startBody.w}`,
    );

    // Both ends in front near the near plane (R01 residual class): still
    // finite; thickness still follows lw/res.y * w (Three parity, no local bug).
    {
      const zNearish = -0.05; // in front of camera, closer than |ne| but both z<0 → no trim
      const right = expandLine2CornerScreenSpace({
        start: [-0.2, 0, zNearish],
        end: [0.2, 0, zNearish],
        modelView,
        projection,
        resolution,
        linewidth,
        positionX: 1,
        positionY: 0,
      });
      const left = expandLine2CornerScreenSpace({
        start: [-0.2, 0, zNearish],
        end: [0.2, 0, zNearish],
        modelView,
        projection,
        resolution,
        linewidth,
        positionX: -1,
        positionY: 0,
      });
      assert(
        isFiniteClip(right) && isFiniteClip(left) && right.w > 0,
        `near-skim (both in front): finite clip w=${right.w}`,
      );
      const mag = 0.5 * Math.hypot(right.x - left.x, right.y - left.y);
      const expectedMag = (linewidth / resolution[1]) * right.w;
      assert(
        approxEq(mag, expectedMag, 1e-4),
        `near-skim: offset still lw/res.y*w (Three parity; got ${mag} vs ${expectedMag})`,
      );
    }

    // Ortho projection: perspective flag false → no camera-plane trim
    {
      const ortho = mat4Ortho16(-10, 10, -10, 10, 0.1, 100);
      const clip = expandLine2CornerScreenSpace({
        start: [0, 0, -5],
        end: [0, 0, 5],
        modelView,
        projection: ortho,
        resolution,
        linewidth,
        positionX: 1,
        positionY: 1,
      });
      assert(isFiniteClip(clip), "ortho cross-z=0: finite without perspective trim");
    }
  }

  // --- Zero-length under non-square aspect still finite + horizontal dir ----
  {
    const modelView = mat4Identity16();
    const projection = mat4Identity16();
    const p = [2, -1, -3];
    const a = expandLine2CornerScreenSpace({
      start: p,
      end: p,
      modelView,
      projection,
      resolution: [1920, 1080],
      linewidth: 5,
      positionX: 1,
      positionY: 0,
    });
    const b = expandLine2CornerScreenSpace({
      start: p,
      end: p,
      modelView,
      projection,
      resolution: [1920, 1080],
      linewidth: 5,
      positionX: -1,
      positionY: 0,
    });
    assert(
      isFiniteClip(a) && isFiniteClip(b),
      "zero-length non-square aspect: finite",
    );
    // Fallback dir=(1,0) → after aspect undo offset is pure ±Y (same as square)
    assert(
      approxEq(a.x, b.x) && a.y !== b.y,
      "zero-length non-square: horizontal fallback → lateral ±Y",
    );
    const mag = 0.5 * Math.abs(a.y - b.y);
    assert(
      approxEq(mag, (5 / 1080) * a.w, 1e-6),
      `zero-length non-square: half-offset = lw/res.y*w (got ${mag})`,
    );
  }

  // --- API traps (camera / resolution misuse — pure CPU) --------------------
  // Mirrors WGSL screen-space path. GPU Line2Renderer.setResolution clamps
  // width/height with Math.max(*, 1); expand-ref does NOT clamp (raw formula).
  {
    /** Column-major A × B (4×4). */
    const mat4Mul = (a, b) => {
      const out = new Float32Array(16);
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          let s = 0;
          for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
          out[c * 4 + r] = s;
        }
      }
      return out;
    };

    // RH perspective + non-identity view (translate camera back).
    const near = 0.5;
    const far = 100;
    const fovy = Math.PI / 3;
    const aspect = 16 / 9;
    const f = 1 / Math.tan(fovy / 2);
    const projection = new Float32Array(16);
    projection[0] = f / aspect;
    projection[5] = f;
    projection[10] = far / (near - far);
    projection[11] = -1;
    projection[14] = (far * near) / (near - far);
    const view = mat4Identity16();
    view[14] = -8; // translate world so (0,0,0) is at view z = -8
    const viewProj = mat4Mul(projection, view);
    const identity = mat4Identity16();
    const resolution = [1920, 1080];
    const linewidth = 4;
    const start = [-1, 0, 0];
    const end = [1, 0, 0];

    const halfMag = (mv, proj) => {
      const r = expandLine2CornerScreenSpace({
        start,
        end,
        modelView: mv,
        projection: proj,
        resolution,
        linewidth,
        positionX: 1,
        positionY: 0,
      });
      const l = expandLine2CornerScreenSpace({
        start,
        end,
        modelView: mv,
        projection: proj,
        resolution,
        linewidth,
        positionX: -1,
        positionY: 0,
      });
      return {
        mag: 0.5 * Math.hypot(r.x - l.x, r.y - l.y),
        midX: (r.x + l.x) * 0.5,
        midY: (r.y + l.y) * 0.5,
        w: r.w,
        r,
        l,
      };
    };

    const correct = halfMag(view, projection);
    assert(
      isFiniteClip(correct.r) && isFiniteClip(correct.l) && correct.mag > 0,
      `trap baseline: separate view+proj finite thickness (mag=${correct.mag})`,
    );

    // Trap: double projection — modelView = viewProj AND projection = proj.
    // Integrator reuses a fused mat as modelView while still writing a real proj.
    const doubleP = halfMag(viewProj, projection);
    assert(
      isFiniteClip(doubleP.r),
      "trap double-proj: still finite (silent visual failure, not a crash)",
    );
    assert(
      Math.abs(doubleP.mag - correct.mag) > 1e-4 ||
        Math.abs(doubleP.midX - correct.midX) > 1e-4 ||
        Math.abs(doubleP.w - correct.w) > 1e-4,
      `trap double-proj: thickness/pose diverges from correct ` +
        `(correct mag=${correct.mag} w=${correct.w}; double mag=${doubleP.mag} w=${doubleP.w})`,
    );

    // Trap: fused as modelView, identity projection — endpoint clip can look
    // "almost right" in front of camera, but perspective trim is disabled
    // (identity m[11]=0) and view-space z is wrong for worldUnits / trim.
    {
      // view translates z by -8: world z → view z = worldZ - 8.
      // Segment crosses camera plane in VIEW space: start behind, end front.
      const cStart = [0, 0, 12]; // view z = 4 (behind)
      const cEnd = [0, 0, 4]; // view z = -4 (front)
      // Correct path trims START (behind → near stub); body at start is y=0.
      const goodStart = expandLine2CornerScreenSpace({
        start: cStart,
        end: cEnd,
        modelView: view,
        projection,
        resolution,
        linewidth,
        positionX: 1,
        positionY: 0, // start body after trim
      });
      const fusedStart = expandLine2CornerScreenSpace({
        start: cStart,
        end: cEnd,
        modelView: viewProj,
        projection: identity,
        resolution,
        linewidth,
        positionX: 1,
        positionY: 0,
      });
      assert(
        isFiniteClip(goodStart) && goodStart.w > 0 && goodStart.w < near,
        `trap fused-MV: correct path trims start to front stub (w=${goodStart.w})`,
      );
      // Fused-as-MV + I: no perspective flag → no camera-plane trim.
      // Untrimmed start stays behind-camera (clip.w ≤ 0) or diverges from stub.
      assert(
        Math.abs(fusedStart.w - goodStart.w) > 1e-3 ||
          !isFiniteClip(fusedStart) ||
          fusedStart.w <= 0,
        `trap fused-MV+I: skips view-space trim → w diverges ` +
          `(fused w=${fusedStart.w}, correct w=${goodStart.w})`,
      );
    }

    // Trap: swapped mats (proj as modelView, view as projection).
    // May be non-finite (world z=0 → clip.w=0 under raw proj-as-MV) or finite-but-wrong.
    const swapped = halfMag(projection, view);
    const swappedWrong =
      !isFiniteClip(swapped.r) ||
      !isFiniteClip(swapped.l) ||
      !Number.isFinite(swapped.mag) ||
      Math.abs(swapped.mag - correct.mag) > 1e-4 ||
      Math.abs(swapped.midX - correct.midX) > 1e-4 ||
      Math.abs(swapped.w - correct.w) > 1e-4;
    assert(
      swappedWrong,
      `trap swapped mats: pose/thickness wrong or non-finite ` +
        `(mag ${swapped.mag} vs ${correct.mag}, w ${swapped.w} vs ${correct.w})`,
    );

    // Trap: resolution.y = 0 → divide-by-zero in offset / res.y (raw expand-ref).
    // Renderer clamps via Math.max(height, 1) before uniforms — never hits this.
    {
      const badY = expandLine2CornerScreenSpace({
        start,
        end,
        modelView: view,
        projection,
        resolution: [800, 0],
        linewidth,
        positionX: 1,
        positionY: 0,
      });
      assert(
        !Number.isFinite(badY.x) || !Number.isFinite(badY.y),
        `trap resY=0: expand-ref produces non-finite clip (x=${badY.x}, y=${badY.y})`,
      );
    }

    // Trap: resolution.x = 0 → aspect = 0 / resY = 0 → dir collapse / Inf path.
    {
      const badX = expandLine2CornerScreenSpace({
        start,
        end,
        modelView: view,
        projection,
        resolution: [0, 600],
        linewidth,
        positionX: 1,
        positionY: 0,
      });
      // aspect=0 forces dir.x→0 before normalize; may stay finite OR Inf depending
      // on dir — at least document: not a supported input. With horizontal seg,
      // dir becomes (0, ±1) after aspect, finite lateral X offset after /aspect.
      // Vertical segment + resX=0 is the Inf case (offset.x /= aspect).
      const badXVert = expandLine2CornerScreenSpace({
        start: [0, -1, 0],
        end: [0, 1, 0],
        modelView: view,
        projection,
        resolution: [0, 600],
        linewidth,
        positionX: 1,
        positionY: 0,
      });
      assert(
        !Number.isFinite(badXVert.x) || !Number.isFinite(badXVert.y),
        `trap resX=0 vertical: non-finite lateral (x=${badXVert.x}, y=${badXVert.y})`,
      );
      void badX;
    }

    // Clamped resolution (renderer contract) restores finite thickness.
    {
      const clamped = expandLine2CornerScreenSpace({
        start,
        end,
        modelView: view,
        projection,
        resolution: [Math.max(0, 1), Math.max(0, 1)], // mirrors setResolution(0,0)
        linewidth,
        positionX: 1,
        positionY: 0,
      });
      assert(
        isFiniteClip(clamped),
        "trap res clamp: Math.max(*,1) → finite expand (setResolution contract)",
      );
    }
  }

  return { failed, passed };
}

// Direct execution
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("expand-ref.test.mjs");

if (isMain) {
  const { failed, passed } = runExpandRefTests();
  if (failed > 0) {
    console.error(`\nexpand-ref: ${failed} failed, ${passed} passed`);
    process.exitCode = 1;
  } else {
    console.log(`\nexpand-ref: all ${passed} passed`);
  }
}
