/**
 * Real-time disc impostor: 3D fractal jittered Voronoi land (sfKSDw).
 *
 * Must match fractal-voronoi.ts (pcg3d, site, nearest, root, warp, fill hash).
 */
export const LAND_DISC_MARKERS = [
    "FRACTAL_JITTERED_VORONOI",
    "sfKSDw",
    "nearest_sites",
    "root_cell",
    "isCont",
    "isIsland",
    "isLake",
    "override_class",
];
export const LAND_DISC_WGSL = /* wgsl */ `
const FRACTAL_JITTERED_VORONOI : f32 = 1.0;
const sfKSDw : f32 = 1.0;
const DEPTH_MAX : i32 = 6;
const INV_U32 : f32 = 1.0 / 4294967296.0;

struct FrameUniforms {
  viewProj : mat4x4<f32>,
  eyePos : vec4<f32>,
  sunPos : vec4<f32>,
  timePad : vec4<f32>,
};

struct BodyUniforms {
  centerRadius : vec4<f32>,
  camRight : vec4<f32>,
  camUp : vec4<f32>,
  spinOblMargin : vec4<f32>,
};

struct LandUniforms {
  p0 : vec4<f32>,
  p1 : vec4<f32>,
  p2 : vec4<f32>,
  p3 : vec4<f32>,
  p4 : vec4<f32>,
  p5 : vec4<f32>,
  p6 : vec4<f32>,
  p7 : vec4<f32>,
};

struct OverrideBuf {
  count : i32,
  _p0 : i32,
  _p1 : i32,
  _p2 : i32,
  items : array<vec4<i32>, 64>,
};

@group(0) @binding(0) var<uniform> frame : FrameUniforms;
@group(0) @binding(1) var<uniform> body : BodyUniforms;
@group(0) @binding(2) var<uniform> land : LandUniforms;
@group(0) @binding(3) var<uniform> ov : OverrideBuf;

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) local : vec2<f32>,
};

struct Nearest {
  cell : vec3<i32>,
  cell2 : vec3<i32>,
  d1 : f32,
  d2 : f32,
};

struct Hit {
  root : vec3<i32>,
  root2 : vec3<i32>,
  border : f32,
};

fn pcg3d(p : vec3<u32>) -> vec3<u32> {
  var v = p * 1664525u + 1013904223u;
  v.x = v.x + v.y * v.z;
  v.y = v.y + v.z * v.x;
  v.z = v.z + v.x * v.y;
  v = v ^ (v >> vec3<u32>(16u));
  v.x = v.x + v.y * v.z;
  v.y = v.y + v.z * v.x;
  v.z = v.z + v.x * v.y;
  return v;
}

fn hash01(x : i32, y : i32, z : i32) -> f32 {
  let h = pcg3d(vec3<u32>(u32(x), u32(y), u32(z)));
  return f32(h.x) * INV_U32;
}

fn cell_size(layer : i32) -> f32 {
  return exp2(-f32(max(layer, 0)));
}

fn site(layer : i32, cell : vec3<i32>, jitter : f32, seed : u32) -> vec3<f32> {
  let s = cell_size(layer);
  let ux = u32(cell.x + 262144);
  let uy = u32(cell.y + 262144);
  let uz = u32(cell.z + 262144);
  let lu = u32(layer);
  let h = pcg3d(vec3<u32>(
    ux + seed * 17u + lu * 113u,
    uy + seed * 31u + lu * 157u,
    uz + seed * 47u + lu * 191u,
  ));
  let o = vec3<f32>(h) * INV_U32;
  let j = clamp(jitter, 0.0, 1.0);
  return s * (vec3<f32>(cell) + 0.5 + (o - 0.5) * j);
}

fn nearest_sites(
  layer : i32,
  p : vec3<f32>,
  jitter : f32,
  seed : u32,
  search_r : i32,
) -> Nearest {
  let s = cell_size(layer);
  let r = clamp(search_r, 1, 2);
  let centre = vec3<i32>(floor(p / s));
  var best : Nearest;
  best.cell = centre;
  best.cell2 = centre;
  best.d1 = 1e20;
  best.d2 = 1e20;
  for (var dz = -2; dz <= 2; dz = dz + 1) {
    if (abs(dz) > r) { continue; }
    for (var dy = -2; dy <= 2; dy = dy + 1) {
      if (abs(dy) > r) { continue; }
      for (var dx = -2; dx <= 2; dx = dx + 1) {
        if (abs(dx) > r) { continue; }
        let cell = centre + vec3<i32>(dx, dy, dz);
        let q = site(layer, cell, jitter, seed);
        let d = dot(q - p, q - p);
        if (d < best.d1) {
          best.d2 = best.d1;
          best.cell2 = best.cell;
          best.d1 = d;
          best.cell = cell;
        } else if (d < best.d2) {
          best.d2 = d;
          best.cell2 = cell;
        }
      }
    }
  }
  return best;
}

fn root_cell(
  layer : i32,
  cell : vec3<i32>,
  jitter : f32,
  seed : u32,
  search_r : i32,
) -> vec3<i32> {
  var l = clamp(layer, 0, DEPTH_MAX);
  var c = cell;
  for (var i = 0; i < 8; i = i + 1) {
    if (l <= 0) { break; }
    let q = site(l, c, jitter, seed);
    c = nearest_sites(l - 1, q, jitter, seed, search_r).cell;
    l = l - 1;
  }
  return c;
}

fn partition_hit(
  p : vec3<f32>,
  depth : i32,
  jitter : f32,
  seed : u32,
  search_r : i32,
) -> Hit {
  let d = clamp(depth, 0, DEPTH_MAX);
  let n = nearest_sites(d, p, jitter, seed, search_r);
  var h : Hit;
  h.root = root_cell(d, n.cell, jitter, seed, search_r);
  h.root2 = root_cell(d, n.cell2, jitter, seed, search_r);
  let f1 = sqrt(max(n.d1, 0.0));
  let f2 = sqrt(max(n.d2, 0.0));
  let same = h.root.x == h.root2.x && h.root.y == h.root2.y && h.root.z == h.root2.z;
  h.border = select(max(0.0, f2 - f1), 1.0, same);
  return h;
}

fn warp_point(p : vec3<f32>, amt : f32) -> vec3<f32> {
  if (amt <= 1e-5) { return p; }
  let k = amt * 0.15;
  return p + vec3<f32>(
    sin(p.y * 3.1 + p.z * 1.7),
    sin(p.z * 2.9 + p.x * 1.3),
    sin(p.x * 3.3 + p.y * 1.9),
  ) * k;
}

fn cell_unit(cell : vec3<i32>, salt : u32) -> f32 {
  let sx = i32(salt);
  return hash01(
    cell.x + 128167 + sx * 13,
    cell.y + 648055 + sx * 29,
    cell.z + 548540 + sx * 47,
  );
}

fn cell_rgb(cell : vec3<i32>) -> vec3<f32> {
  let h = cell_unit(cell, 91u);
  return vec3<f32>(
    0.45 + 0.55 * sin(h * 6.2831 * 3.7 + 0.2),
    0.45 + 0.55 * sin(h * 6.2831 * 5.1 + 2.1),
    0.45 + 0.55 * sin(h * 6.2831 * 2.3 + 4.2),
  );
}

fn fill_salt(seed : u32, layer : i32) -> u32 {
  return seed + u32(layer + 1) * 10007u;
}

fn override_class(cell : vec3<i32>, layer : i32) -> i32 {
  let n = ov.count;
  for (var i = 0; i < 64; i = i + 1) {
    if (i >= n) { break; }
    let it = ov.items[i];
    if (it.x == cell.x && it.y == cell.y && it.z == cell.z) {
      if ((it.w & 15) == layer) {
        return (it.w >> 4) & 15;
      }
    }
  }
  return 0;
}

fn land_from_fill(
  cell : vec3<i32>,
  fill : f32,
  seed : u32,
  layer : i32,
) -> bool {
  let ovc = override_class(cell, layer);
  if (ovc == 1) { return true; }
  if (ovc == 2) { return false; }
  return cell_unit(cell, fill_salt(seed, layer)) < fill;
}

fn rotateY(v : vec3<f32>, a : f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

fn rotateX(v : vec3<f32>, a : f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
}

fn normalize_fast(v : vec3<f32>) -> vec3<f32> {
  return v * inverseSqrt(max(dot(v, v), 1e-20));
}

@vertex
fn vs_main(@builtin(vertex_index) vi : u32) -> VSOut {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  let local = corners[vi];
  let halfExt = body.centerRadius.w * body.spinOblMargin.z;
  let world =
    body.centerRadius.xyz
    + body.camRight.xyz * (local.x * halfExt)
    + body.camUp.xyz * (local.y * halfExt);
  var o : VSOut;
  o.position = frame.viewProj * vec4<f32>(world, 1.0);
  o.local = local;
  return o;
}

fn biome_land(nBody : vec3<f32>, inland : f32, mountain : f32, cellH : f32) -> vec3<f32> {
  let lat = nBody.y;
  let tundra = smoothstep(0.42, 0.62, lat);
  let desert = (1.0 - tundra) * smoothstep(0.55, 0.15, abs(lat)) * cellH;
  let grass = vec3<f32>(0.23, 0.42, 0.18);
  let dirt = vec3<f32>(0.36, 0.28, 0.16);
  let sand = vec3<f32>(0.72, 0.62, 0.34);
  let rock = vec3<f32>(0.42, 0.4, 0.38);
  let snow = vec3<f32>(0.92, 0.94, 0.96);
  var col = mix(grass, dirt, 0.25 + 0.35 * cellH);
  col = mix(col, sand, desert * 0.75);
  col = mix(col, rock, clamp(mountain * inland * cellH, 0.0, 1.0) * 0.65);
  col = mix(col, snow, tundra);
  let beach = 1.0 - inland;
  col = mix(col, vec3<f32>(0.78, 0.7, 0.48), beach * 0.85);
  return col;
}

@fragment
fn fs_main(in : VSOut) -> @location(0) vec4<f32> {
  let local = in.local;
  let r = length(local);
  let margin = max(body.spinOblMargin.z, 1.0);
  let discR = 1.0 / margin;
  let rr = r / discR;
  let atmOuter = 1.26;
  if (rr > atmOuter) {
    discard;
  }

  let camFwd = normalize_fast(cross(body.camRight.xyz, body.camUp.xyz));
  let zSphere = sqrt(max(0.0, 1.0 - min(rr * rr, 1.0)));
  let nLocal = normalize_fast(vec3<f32>(
    local.x / discR,
    local.y / discR,
    select(0.12, zSphere, rr <= 1.0),
  ));
  var nWorld = normalize_fast(
    body.camRight.xyz * nLocal.x
    + body.camUp.xyz * nLocal.y
    + camFwd * nLocal.z
  );
  let spin = body.spinOblMargin.x;
  let obl = body.spinOblMargin.y;
  var nBody = nWorld;
  nBody = rotateX(nBody, -obl);
  nBody = rotateY(nBody, -spin);
  nBody = normalize_fast(nBody);

  let seed = u32(land.p0.x + 0.5);
  let jitter = land.p0.y;
  let search_r = i32(land.p0.z + 0.5);
  let viewMode = i32(land.p0.w + 0.5);
  let warp = land.p4.z;
  let iceLat = land.p4.y;
  let mountain = land.p4.x;
  let coastW = max(land.p3.w, 0.004);
  let showBorders = land.p5.y > 0.5;
  let hlLayer = i32(land.p5.z);
  let atmK = land.p5.w;
  let hl = vec3<i32>(i32(land.p6.x), i32(land.p6.y), i32(land.p6.z));
  let heightScale = land.p6.w;

  let pc = warp_point(nBody * land.p1.x, warp);
  let hitC = partition_hit(pc, i32(land.p1.z + 0.5), jitter, seed, search_r);
  let isCont = land_from_fill(hitC.root, land.p1.y, seed, 0);

  var hitI : Hit;
  hitI.root = vec3<i32>(0);
  hitI.border = 1.0;
  var isIsland = false;
  let needIsland = (!isCont && land.p2.y > 1e-4) || viewMode == 2;
  if (needIsland) {
    hitI = partition_hit(
      warp_point(nBody * land.p2.x + vec3<f32>(17.1, -9.3, 4.7), warp * 0.7),
      i32(land.p2.z + 0.5),
      jitter,
      seed + 91u,
      search_r,
    );
    isIsland = land_from_fill(hitI.root, land.p2.y, seed, 1);
  }

  var hitL : Hit;
  hitL.root = vec3<i32>(0);
  hitL.border = 1.0;
  var isLake = false;
  let needLake = (isCont && land.p3.y > 1e-4) || viewMode == 3;
  if (needLake) {
    hitL = partition_hit(
      warp_point(nBody * land.p3.x + vec3<f32>(-11.0, 3.2, 8.8), warp * 0.5),
      i32(land.p3.z + 0.5),
      jitter,
      seed + 190u,
      search_r,
    );
    isLake = isCont && land_from_fill(hitL.root, land.p3.y, seed, 2);
  }

  var kind = 0;
  var border = 1.0;
  var root = hitC.root;
  if (isCont && !isLake) {
    kind = 1;
    border = hitC.border;
  } else if (isIsland) {
    kind = 2;
    border = hitI.border;
    root = hitI.root;
  } else if (isLake) {
    kind = 3;
    border = hitL.border;
    root = hitL.root;
  }
  if (kind != 0 && abs(nBody.y) > iceLat) {
    kind = 4;
  }

  let inland = 1.0 - exp(-border / coastW);
  let cellH = cell_unit(hitC.root, 3u);
  var albedo : vec3<f32>;
  var spec = 0.0;

  if (viewMode == 1) {
    let on = land_from_fill(hitC.root, land.p1.y, seed, 0);
    albedo = cell_rgb(hitC.root);
    if (!on) { albedo = albedo * 0.22 + vec3<f32>(0.04, 0.08, 0.16); }
    if (showBorders) {
      albedo = mix(vec3<f32>(0.02, 0.02, 0.04), albedo, smoothstep(0.0, 0.035, hitC.border));
    }
    root = hitC.root;
  } else if (viewMode == 2) {
    let on = land_from_fill(hitI.root, land.p2.y, seed, 1);
    albedo = cell_rgb(hitI.root);
    if (!on) { albedo = albedo * 0.22 + vec3<f32>(0.04, 0.08, 0.16); }
    if (showBorders) {
      albedo = mix(vec3<f32>(0.02, 0.02, 0.04), albedo, smoothstep(0.0, 0.03, hitI.border));
    }
    root = hitI.root;
  } else if (viewMode == 3) {
    let on = land_from_fill(hitL.root, land.p3.y, seed, 2);
    albedo = cell_rgb(hitL.root);
    if (!on) { albedo = albedo * 0.22 + vec3<f32>(0.04, 0.08, 0.16); }
    if (showBorders) {
      albedo = mix(vec3<f32>(0.02, 0.02, 0.04), albedo, smoothstep(0.0, 0.03, hitL.border));
    }
    root = hitL.root;
  } else if (viewMode == 4) {
    let hgt = select(0.08 + inland * (0.35 + mountain * cellH), 0.02, kind == 0 || kind == 3);
    albedo = vec3<f32>(hgt, hgt * 0.85 + 0.05, 0.2 + hgt * 0.4);
    root = hitC.root;
  } else {
    let ocean = vec3<f32>(0.04, 0.14, 0.32);
    let deep = vec3<f32>(0.02, 0.07, 0.2);
    let lake = vec3<f32>(0.1, 0.32, 0.42);
    if (kind == 0) {
      albedo = mix(deep, ocean, 0.45 + 0.4 * cellH);
      spec = 0.55;
    } else if (kind == 3) {
      albedo = lake;
      spec = 0.4;
    } else if (kind == 4) {
      albedo = mix(vec3<f32>(0.82, 0.88, 0.94), vec3<f32>(0.95, 0.97, 1.0), inland);
      spec = 0.22;
    } else if (kind == 2) {
      albedo = biome_land(nBody, inland, mountain * 0.4, cellH);
      albedo = mix(albedo, vec3<f32>(0.28, 0.5, 0.22), 0.25);
      spec = 0.04;
    } else {
      albedo = biome_land(nBody, inland, mountain, cellH);
      spec = 0.05;
    }
    _ = heightScale;
  }

  if (hlLayer >= 0 && root.x == hl.x && root.y == hl.y && root.z == hl.z) {
    albedo = mix(albedo, vec3<f32>(1.0, 0.82, 0.28), 0.4);
  }

  let surfaceMask = 1.0 - smoothstep(0.992, 1.0, rr);
  let sunDir = normalize_fast(frame.sunPos.xyz - body.centerRadius.xyz);
  let ndl = clamp(dot(nWorld, sunDir), 0.0, 1.0);
  let wrap = ndl * 0.88 + 0.12;
  let view = normalize_fast(frame.eyePos.xyz - (body.centerRadius.xyz + nWorld * body.centerRadius.w));
  let hlf = normalize_fast(sunDir + view);
  let specT = pow(max(dot(nWorld, hlf), 0.0), 48.0) * spec * ndl;
  var lit = albedo * (0.16 + 0.9 * wrap) + vec3<f32>(specT);
  let night = smoothstep(0.12, -0.2, ndl);
  lit = mix(lit, albedo * 0.045, night * 0.85);

  let fres = pow(1.0 - max(dot(nWorld, view), 0.0), 3.0);
  var atm = vec3<f32>(0.28, 0.5, 1.0) * fres * atmK * (0.3 + 0.7 * wrap);
  atm = atm * (1.0 - smoothstep(1.0, atmOuter, rr));
  let limb = smoothstep(atmOuter, 1.0, rr) * (1.0 - surfaceMask);
  atm = atm + vec3<f32>(0.22, 0.42, 0.95) * limb * atmK * 0.65;

  var col = lit * surfaceMask + atm;
  col = clamp(col, vec3<f32>(0.0), vec3<f32>(4.0));
  return vec4<f32>(col, clamp(surfaceMask, 0.0, 1.0));
}
`;
//# sourceMappingURL=land-disc.wgsl.js.map