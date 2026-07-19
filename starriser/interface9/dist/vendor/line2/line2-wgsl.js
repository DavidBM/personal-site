/**
 * WGSL port of three.js `LineMaterial` / `Line2NodeMaterial` fat-line shaders.
 *
 * Source of truth: classic GLSL in examples/jsm/lines/LineMaterial.js (MIT).
 * WebGPU Line2NodeMaterial uses the same expansion / trim / endcap math.
 *
 * Features:
 *  - Screen-space thickness (pixels via resolution) or worldUnits
 *  - Vertex expansion of each segment into a ribbon (triangle-list, instanced)
 *  - Round endcaps: soft fwidth AA or hard discard (Three LineMaterial parity)
 *  - Long-edge quality: MSAA + pipeline alphaToCoverage (not ribbon-skirt fades)
 *  - Optional dashed lines (distance attributes)
 *  - Optional per-endpoint vertex colors
 *
 * Depth/log-depth/fog/clipping planes from Three are intentionally omitted.
 */
export const LINE2_WGSL = /* wgsl */ `
// Uniform layout must match line2-material.ts LINE2_UNIFORM_SIZE / writeMaterialUniforms.
struct Line2Uniforms {
  modelView : mat4x4<f32>,
  projection : mat4x4<f32>,
  color : vec4<f32>,
  resolution : vec2<f32>,
  linewidth : f32,
  dashScale : f32,
  dashSize : f32,
  gapSize : f32,
  dashOffset : f32,
  worldUnits : f32,
  dashed : f32,
  softAA : f32,
  vertexColors : f32,
  _pad0 : f32,
};

@group(0) @binding(0) var<uniform> u : Line2Uniforms;

struct VSIn {
  // Template ribbon: position.x = side (±1), position.y = along (−1…2), uv for AA
  @location(0) position : vec3<f32>,
  @location(1) uv : vec2<f32>,
  // Instance segment endpoints (world / model space)
  @location(2) instanceStart : vec3<f32>,
  @location(3) instanceEnd : vec3<f32>,
  @location(4) instanceColorStart : vec3<f32>,
  @location(5) instanceColorEnd : vec3<f32>,
  @location(6) instanceDistanceStart : f32,
  @location(7) instanceDistanceEnd : f32,
};

struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) vUv : vec2<f32>,
  @location(1) vColor : vec3<f32>,
  @location(2) vLineDistance : f32,
  // View-space quantities for worldUnits fragment path
  @location(3) worldPos : vec4<f32>,
  @location(4) worldStart : vec3<f32>,
  @location(5) worldEnd : vec3<f32>,
};

fn trimSegmentAlpha(start : vec4<f32>, end_ : vec4<f32>) -> f32 {
  // Conservative near-plane estimate from projection (supports reverse-Z).
  let a = u.projection[2][2];
  let b = u.projection[3][2];
  var nearEstimate : f32;
  if (a > 0.0) {
    nearEstimate = -b / (a + 1.0);
  } else {
    nearEstimate = -0.5 * b / a;
  }
  return (nearEstimate - start.z) / (end_.z - start.z);
}

fn closestLineToLine(p1 : vec3<f32>, p2 : vec3<f32>, p3 : vec3<f32>, p4 : vec3<f32>) -> vec2<f32> {
  let p13 = p1 - p3;
  let p43 = p4 - p3;
  let p21 = p2 - p1;
  let d1343 = dot(p13, p43);
  let d4321 = dot(p43, p21);
  let d1321 = dot(p13, p21);
  let d4343 = dot(p43, p43);
  let d2121 = dot(p21, p21);
  let denom = d2121 * d4343 - d4321 * d4321;
  // Parallel / degenerate segments: avoid div-by-zero NaNs
  if (abs(denom) < 1e-12 || abs(d4343) < 1e-12) {
    return vec2<f32>(0.5, 0.0);
  }
  let numer = d1343 * d4321 - d1321 * d4343;
  var mua = numer / denom;
  mua = clamp(mua, 0.0, 1.0);
  var mub = (d1343 + d4321 * mua) / d4343;
  mub = clamp(mub, 0.0, 1.0);
  return vec2<f32>(mua, mub);
}

@vertex
fn vs_main(input : VSIn) -> VSOut {
  var out : VSOut;
  out.vUv = input.uv;
  out.vColor = select(input.instanceColorEnd, input.instanceColorStart, input.position.y < 0.5);
  out.worldPos = vec4<f32>(0.0);
  out.worldStart = vec3<f32>(0.0);
  out.worldEnd = vec3<f32>(0.0);
  out.vLineDistance = 0.0;

  let aspect = u.resolution.x / u.resolution.y;

  // Camera / view space
  var start = u.modelView * vec4<f32>(input.instanceStart, 1.0);
  var end_ = u.modelView * vec4<f32>(input.instanceEnd, 1.0);

  var lineDistanceStart = u.dashScale * input.instanceDistanceStart;
  var lineDistanceEnd = u.dashScale * input.instanceDistanceEnd;

  let useWorld = u.worldUnits > 0.5;
  let useDash = u.dashed > 0.5;

  if (useWorld) {
    out.worldStart = start.xyz;
    out.worldEnd = end_.xyz;
  }

  // Perspective segments that cross the camera plane must be trimmed so NDC math is valid.
  let perspective = abs(u.projection[2][3] + 1.0) < 1e-5;
  if (perspective) {
    if (start.z < 0.0 && end_.z >= 0.0) {
      let alpha = trimSegmentAlpha(start, end_);
      end_ = vec4<f32>(mix(start.xyz, end_.xyz, alpha), end_.w);
      if (useDash) {
        lineDistanceEnd = mix(lineDistanceStart, lineDistanceEnd, alpha);
      }
    } else if (end_.z < 0.0 && start.z >= 0.0) {
      let alpha = trimSegmentAlpha(end_, start);
      start = vec4<f32>(mix(end_.xyz, start.xyz, alpha), start.w);
      if (useDash) {
        lineDistanceStart = mix(lineDistanceEnd, lineDistanceStart, alpha);
      }
    }
  }

  if (useDash) {
    out.vLineDistance = select(lineDistanceEnd, lineDistanceStart, input.position.y < 0.5);
  }

  let clipStart = u.projection * start;
  let clipEnd = u.projection * end_;
  let ndcStart = clipStart.xyz / clipStart.w;
  let ndcEnd = clipEnd.xyz / clipEnd.w;

  var dir = ndcEnd.xy - ndcStart.xy;
  dir.x = dir.x * aspect;
  let dirLen = length(dir);
  // Degenerate (zero-length) segments: arbitrary horizontal offset
  if (dirLen > 1e-8) {
    dir = dir / dirLen;
  } else {
    dir = vec2<f32>(1.0, 0.0);
  }

  var clip : vec4<f32>;

  if (useWorld) {
    // Zero-length segment: stable axis so normalize does not produce NaN
    let seg = end_.xyz - start.xyz;
    let segLen = length(seg);
    var worldDir : vec3<f32>;
    if (segLen < 1e-8) {
      worldDir = vec3<f32>(1.0, 0.0, 0.0);
    } else {
      worldDir = seg / segLen;
    }
    // Midpoint toward camera; guard normalize if start≈end≈origin
    let mid = mix(start.xyz, end_.xyz, 0.5);
    let midLen = length(mid);
    var tmpFwd : vec3<f32>;
    if (midLen < 1e-8) {
      tmpFwd = vec3<f32>(0.0, 0.0, -1.0);
    } else {
      tmpFwd = mid / midLen;
    }
    // Never normalize a near-zero cross product
    var worldUp : vec3<f32>;
    let c1 = cross(worldDir, tmpFwd);
    if (length(c1) >= 1e-6) {
      worldUp = normalize(c1);
    } else {
      let c2 = cross(worldDir, vec3<f32>(0.0, 1.0, 0.0));
      if (length(c2) >= 1e-6) {
        worldUp = normalize(c2);
      } else {
        worldUp = vec3<f32>(1.0, 0.0, 0.0);
      }
    }
    let worldFwd = cross(worldDir, worldUp);
    var worldPos = select(end_, start, input.position.y < 0.5);
    let hw = u.linewidth * 0.5;

    // Height offset (lateral)
    if (input.position.x < 0.0) {
      worldPos = vec4<f32>(worldPos.xyz + hw * worldUp, worldPos.w);
    } else {
      worldPos = vec4<f32>(worldPos.xyz - hw * worldUp, worldPos.w);
    }

    // Endcaps + depth box (skipped for dashes — endcaps discarded in FS)
    if (!useDash) {
      if (input.position.y < 0.5) {
        worldPos = vec4<f32>(worldPos.xyz - hw * worldDir, worldPos.w);
      } else {
        worldPos = vec4<f32>(worldPos.xyz + hw * worldDir, worldPos.w);
      }
      worldPos = vec4<f32>(worldPos.xyz + worldFwd * hw, worldPos.w);
      if (input.position.y > 1.0 || input.position.y < 0.0) {
        worldPos = vec4<f32>(worldPos.xyz - worldFwd * 2.0 * hw, worldPos.w);
      }
    }

    out.worldPos = worldPos;
    clip = u.projection * worldPos;
    let clipPose = select(ndcEnd, ndcStart, input.position.y < 0.5);
    clip.z = clipPose.z * clip.w;
  } else {
    // Screen-space expansion (pixel linewidth)
    var offset = vec2<f32>(dir.y, -dir.x);
    dir.x = dir.x / aspect;
    offset.x = offset.x / aspect;

    if (input.position.x < 0.0) {
      offset = -offset;
    }

    // Endcaps
    if (input.position.y < 0.0) {
      offset = offset - dir;
    } else if (input.position.y > 1.0) {
      offset = offset + dir;
    }

    offset = offset * u.linewidth;
    // clip → screen using resolution.y (Three classic LineMaterial)
    offset = offset / u.resolution.y;

    clip = select(clipEnd, clipStart, input.position.y < 0.5);
    offset = offset * clip.w;
    clip = vec4<f32>(clip.xy + offset, clip.z, clip.w);
  }

  out.clip = clip;
  return out;
}

@fragment
fn fs_main(input : VSOut) -> @location(0) vec4<f32> {
  var alpha = u.color.a;
  var rgb = u.color.rgb;

  if (u.vertexColors > 0.5) {
    rgb = rgb * input.vColor;
  }

  let useWorld = u.worldUnits > 0.5;
  let useDash = u.dashed > 0.5;
  let soft = u.softAA > 0.5;

  if (useDash) {
    // Discard endcaps for dashes (Three parity)
    if (input.vUv.y < -1.0 || input.vUv.y > 1.0) {
      discard;
    }
    let period = u.dashSize + u.gapSize;
    if (period > 0.0) {
      let d = (input.vLineDistance + u.dashOffset) % period;
      // WGSL % can be negative; fold into [0, period)
      let dPos = select(d + period, d, d >= 0.0);
      if (dPos > u.dashSize) {
        discard;
      }
    }
  }

  if (useWorld) {
    let rayEnd = normalize(input.worldPos.xyz) * 1e5;
    let lineDir = input.worldEnd - input.worldStart;
    let params = closestLineToLine(input.worldStart, input.worldEnd, vec3<f32>(0.0), rayEnd);
    let p1 = input.worldStart + lineDir * params.x;
    let p2 = rayEnd * params.y;
    let len = length(p1 - p2);
    let norm = len / max(u.linewidth, 1e-6);

    if (!useDash) {
      if (soft) {
        // Full silhouette AA (sides + ends) via analytic half-width distance.
        let dnorm = fwidth(norm);
        alpha = alpha * (1.0 - smoothstep(0.5 - dnorm, 0.5 + dnorm, norm));
      } else if (norm > 0.5) {
        discard;
      }
    }
  } else {
    // Screen-space — classic three.js LineMaterial: soft endcaps only.
    // Long edges are the geometric ribbon; smooth them with MSAA + alphaToCoverage
    // on the pipeline (not UV/skirt fades — those look like gradient artifacts).
    if (soft) {
      let a = input.vUv.x;
      let b = select(input.vUv.y + 1.0, input.vUv.y - 1.0, input.vUv.y > 0.0);
      let len2 = a * a + b * b;
      let dlen = fwidth(len2);
      if (abs(input.vUv.y) > 1.0) {
        alpha = alpha * (1.0 - smoothstep(1.0 - dlen, 1.0 + dlen, len2));
      }
    } else {
      if (abs(input.vUv.y) > 1.0) {
        let a = input.vUv.x;
        let b = select(input.vUv.y + 1.0, input.vUv.y - 1.0, input.vUv.y > 0.0);
        let len2 = a * a + b * b;
        if (len2 > 1.0) {
          discard;
        }
      }
    }
  }

  return vec4<f32>(rgb, alpha);
}
`;
//# sourceMappingURL=line2-wgsl.js.map