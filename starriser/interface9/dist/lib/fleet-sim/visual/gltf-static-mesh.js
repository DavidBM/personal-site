/**
 * Minimal glTF 2.0 / GLB static mesh loader (no npm).
 *
 * Supports: single (or first) triangle mesh with POSITION + NORMAL + TEXCOORD_0,
 * base color / diffuse texture, normal map, optional metallic-roughness as a
 * secondary “specular/diffuse” map. Skins, animations, multi-primitive materials
 * beyond the first mesh are out of scope.
 *
 * Output is pure typed arrays + image bytes — no GPU / DOM.
 */
const FLOATS_PER_VERT = 8; // pos3 + nrm3 + uv2
const GL_FLOAT = 5126;
const GL_UNSIGNED_SHORT = 5123;
const GL_UNSIGNED_INT = 5125;
const GL_UNSIGNED_BYTE = 5121;
const GL_BYTE = 5120;
const GL_SHORT = 5122;
function compsPerType(t) {
    switch (t) {
        case "SCALAR":
            return 1;
        case "VEC2":
            return 2;
        case "VEC3":
            return 3;
        case "VEC4":
            return 4;
        case "MAT4":
            return 16;
        default:
            return 1;
    }
}
function bytesPerComponent(ct) {
    switch (ct) {
        case GL_BYTE:
        case GL_UNSIGNED_BYTE:
            return 1;
        case GL_SHORT:
        case GL_UNSIGNED_SHORT:
            return 2;
        case GL_UNSIGNED_INT:
        case GL_FLOAT:
            return 4;
        default:
            return 4;
    }
}
function readComponent(view, offset, ct, normalized) {
    switch (ct) {
        case GL_FLOAT:
            return view.getFloat32(offset, true);
        case GL_UNSIGNED_SHORT: {
            const v = view.getUint16(offset, true);
            return normalized ? v / 65535 : v;
        }
        case GL_UNSIGNED_INT:
            return view.getUint32(offset, true);
        case GL_UNSIGNED_BYTE: {
            const v = view.getUint8(offset);
            return normalized ? v / 255 : v;
        }
        case GL_SHORT: {
            const v = view.getInt16(offset, true);
            return normalized ? Math.max(v / 32767, -1) : v;
        }
        case GL_BYTE: {
            const v = view.getInt8(offset);
            return normalized ? Math.max(v / 127, -1) : v;
        }
        default:
            return 0;
    }
}
function mat4Identity() {
    return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
function mat4Multiply(a, b) {
    const o = new Float64Array(16);
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            o[c * 4 + r] =
                a[0 * 4 + r] * b[c * 4 + 0] +
                    a[1 * 4 + r] * b[c * 4 + 1] +
                    a[2 * 4 + r] * b[c * 4 + 2] +
                    a[3 * 4 + r] * b[c * 4 + 3];
        }
    }
    return o;
}
function mat4FromNode(node) {
    if (node.matrix && node.matrix.length === 16) {
        return Float64Array.from(node.matrix);
    }
    const t = node.translation ?? [0, 0, 0];
    const r = node.rotation ?? [0, 0, 0, 1]; // xy zw quat
    const s = node.scale ?? [1, 1, 1];
    const [qx, qy, qz, qw] = r;
    const x2 = qx + qx;
    const y2 = qy + qy;
    const z2 = qz + qz;
    const xx = qx * x2;
    const yy = qy * y2;
    const zz = qz * z2;
    const xy = qx * y2;
    const xz = qx * z2;
    const yz = qy * z2;
    const wx = qw * x2;
    const wy = qw * y2;
    const wz = qw * z2;
    const m = mat4Identity();
    // column-major rotation * scale
    m[0] = (1 - (yy + zz)) * s[0];
    m[1] = (xy + wz) * s[0];
    m[2] = (xz - wy) * s[0];
    m[4] = (xy - wz) * s[1];
    m[5] = (1 - (xx + zz)) * s[1];
    m[6] = (yz + wx) * s[1];
    m[8] = (xz + wy) * s[2];
    m[9] = (yz - wx) * s[2];
    m[10] = (1 - (xx + yy)) * s[2];
    m[12] = t[0];
    m[13] = t[1];
    m[14] = t[2];
    return m;
}
function mat4TransformPoint(m, x, y, z) {
    const rw = m[3] * x + m[7] * y + m[11] * z + m[15];
    const inv = Math.abs(rw) > 1e-12 ? 1 / rw : 1;
    return [
        (m[0] * x + m[4] * y + m[8] * z + m[12]) * inv,
        (m[1] * x + m[5] * y + m[9] * z + m[13]) * inv,
        (m[2] * x + m[6] * y + m[10] * z + m[14]) * inv,
    ];
}
function mat4TransformDir(m, x, y, z) {
    // upper 3x3 only
    return [
        m[0] * x + m[4] * y + m[8] * z,
        m[1] * x + m[5] * y + m[9] * z,
        m[2] * x + m[6] * y + m[10] * z,
    ];
}
function collectMeshWorldMatrix(json, meshIndex) {
    const nodes = json.nodes ?? [];
    let found = null;
    const walk = (nodeIndex, parent) => {
        if (found)
            return;
        const node = nodes[nodeIndex];
        if (!node)
            return;
        const local = mat4FromNode(node);
        const world = mat4Multiply(parent, local);
        if (node.mesh === meshIndex) {
            found = world;
            return;
        }
        for (const c of node.children ?? [])
            walk(c, world);
    };
    const scene = json.scenes?.[json.scene ?? 0];
    const roots = scene?.nodes ?? nodes.map((_, i) => i);
    for (const r of roots)
        walk(r, mat4Identity());
    return found ?? mat4Identity();
}
function getAccessorData(json, bin, accessorIndex) {
    const acc = json.accessors?.[accessorIndex];
    if (!acc)
        throw new Error(`gltf: missing accessor ${accessorIndex}`);
    const comps = compsPerType(acc.type);
    const count = acc.count | 0;
    const bv = json.bufferViews?.[acc.bufferView ?? -1];
    if (!bv)
        throw new Error(`gltf: missing bufferView for accessor ${accessorIndex}`);
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const stride = bv.byteStride && bv.byteStride > 0
        ? bv.byteStride
        : bytesPerComponent(acc.componentType) * comps;
    const view = new DataView(bin);
    const out = new Float32Array(count * comps);
    const norm = acc.normalized === true;
    for (let i = 0; i < count; i++) {
        const row = base + i * stride;
        for (let c = 0; c < comps; c++) {
            out[i * comps + c] = readComponent(view, row + c * bytesPerComponent(acc.componentType), acc.componentType, norm);
        }
    }
    return { values: out, count, comps };
}
function getIndices(json, bin, accessorIndex) {
    const acc = json.accessors?.[accessorIndex];
    if (!acc)
        throw new Error(`gltf: missing index accessor ${accessorIndex}`);
    const bv = json.bufferViews?.[acc.bufferView ?? -1];
    if (!bv)
        throw new Error(`gltf: missing index bufferView`);
    const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const view = new DataView(bin);
    const count = acc.count | 0;
    const out = new Uint32Array(count);
    const bpc = bytesPerComponent(acc.componentType);
    for (let i = 0; i < count; i++) {
        const o = base + i * bpc;
        if (acc.componentType === GL_UNSIGNED_INT) {
            out[i] = view.getUint32(o, true);
        }
        else if (acc.componentType === GL_UNSIGNED_SHORT) {
            out[i] = view.getUint16(o, true);
        }
        else {
            out[i] = view.getUint8(o);
        }
    }
    return out;
}
function textureSourceIndex(json, textureIndex) {
    if (textureIndex == null || textureIndex < 0)
        return -1;
    const tex = json.textures?.[textureIndex];
    if (!tex || tex.source == null)
        return -1;
    return tex.source | 0;
}
function extractImages(json, bin) {
    const images = json.images ?? [];
    const out = [];
    for (const img of images) {
        if (img.bufferView == null) {
            out.push({ mimeType: img.mimeType ?? "application/octet-stream", data: new Uint8Array(0) });
            continue;
        }
        const bv = json.bufferViews?.[img.bufferView];
        if (!bv) {
            out.push({ mimeType: img.mimeType ?? "application/octet-stream", data: new Uint8Array(0) });
            continue;
        }
        const start = bv.byteOffset ?? 0;
        out.push({
            mimeType: img.mimeType ?? "image/png",
            data: new Uint8Array(bin, start, bv.byteLength),
        });
    }
    return out;
}
/**
 * Parse a GLB (binary glTF) ArrayBuffer into a static mesh + image bytes.
 */
export function parseGlb(buffer) {
    if (buffer.byteLength < 20) {
        throw new Error("gltf: buffer too small for GLB header");
    }
    const header = new DataView(buffer, 0, 12);
    const magic = header.getUint32(0, true);
    if (magic !== 0x46546c67) {
        throw new Error(`gltf: bad magic 0x${magic.toString(16)} (expected glTF)`);
    }
    const version = header.getUint32(4, true);
    if (version !== 2) {
        throw new Error(`gltf: unsupported version ${version}`);
    }
    const totalLength = header.getUint32(8, true);
    if (totalLength > buffer.byteLength) {
        throw new Error("gltf: declared length exceeds buffer");
    }
    let offset = 12;
    let json = null;
    let bin = null;
    while (offset + 8 <= totalLength) {
        const dv = new DataView(buffer, offset, 8);
        const chunkLen = dv.getUint32(0, true);
        const chunkType = dv.getUint32(4, true);
        offset += 8;
        if (offset + chunkLen > totalLength) {
            throw new Error("gltf: chunk overruns file");
        }
        const chunkData = buffer.slice(offset, offset + chunkLen);
        offset += chunkLen;
        // 0x4E4F534A = JSON, 0x004E4942 = BIN\0
        if (chunkType === 0x4e4f534a) {
            const text = new TextDecoder("utf-8").decode(chunkData);
            json = JSON.parse(text);
        }
        else if (chunkType === 0x004e4942) {
            bin = chunkData;
        }
    }
    if (!json)
        throw new Error("gltf: missing JSON chunk");
    if (!bin) {
        // Some assets put empty BIN; allow zero-length mesh failure later
        bin = new ArrayBuffer(0);
    }
    const mesh = json.meshes?.[0];
    const prim = mesh?.primitives?.[0];
    if (!prim || prim.attributes?.POSITION == null) {
        throw new Error("gltf: no mesh primitive with POSITION");
    }
    const posAcc = prim.attributes.POSITION;
    const nrmAcc = prim.attributes.NORMAL;
    const uvAcc = prim.attributes.TEXCOORD_0;
    const pos = getAccessorData(json, bin, posAcc);
    const nrm = nrmAcc != null
        ? getAccessorData(json, bin, nrmAcc)
        : { values: new Float32Array(pos.count * 3), count: pos.count, comps: 3 };
    if (nrmAcc == null) {
        for (let i = 0; i < pos.count; i++)
            nrm.values[i * 3 + 1] = 1;
    }
    const uv = uvAcc != null
        ? getAccessorData(json, bin, uvAcc)
        : { values: new Float32Array(pos.count * 2), count: pos.count, comps: 2 };
    if (pos.count !== nrm.count || pos.count !== uv.count) {
        throw new Error("gltf: POSITION/NORMAL/UV counts disagree");
    }
    const world = collectMeshWorldMatrix(json, 0);
    // Approximate uniform scale from column lengths (for tests / normalize).
    const sx = Math.hypot(world[0], world[1], world[2]);
    const sy = Math.hypot(world[4], world[5], world[6]);
    const sz = Math.hypot(world[8], world[9], world[10]);
    const bakedScale = (sx + sy + sz) / 3;
    const interleaved = new Float32Array(pos.count * FLOATS_PER_VERT);
    for (let i = 0; i < pos.count; i++) {
        const px = pos.values[i * 3];
        const py = pos.values[i * 3 + 1];
        const pz = pos.values[i * 3 + 2];
        const [wx, wy, wz] = mat4TransformPoint(world, px, py, pz);
        let nx = nrm.values[i * 3];
        let ny = nrm.values[i * 3 + 1];
        let nz = nrm.values[i * 3 + 2];
        [nx, ny, nz] = mat4TransformDir(world, nx, ny, nz);
        const nlen = Math.hypot(nx, ny, nz) || 1;
        nx /= nlen;
        ny /= nlen;
        nz /= nlen;
        const o = i * FLOATS_PER_VERT;
        interleaved[o] = wx;
        interleaved[o + 1] = wy;
        interleaved[o + 2] = wz;
        interleaved[o + 3] = nx;
        interleaved[o + 4] = ny;
        interleaved[o + 5] = nz;
        interleaved[o + 6] = uv.values[i * 2];
        interleaved[o + 7] = uv.values[i * 2 + 1];
    }
    let indices;
    if (prim.indices != null) {
        indices = getIndices(json, bin, prim.indices);
    }
    else {
        indices = new Uint32Array(pos.count);
        for (let i = 0; i < pos.count; i++)
            indices[i] = i;
    }
    const images = extractImages(json, bin);
    const mat = prim.material != null ? json.materials?.[prim.material] : undefined;
    const pbr = mat?.pbrMetallicRoughness;
    const baseColorImage = textureSourceIndex(json, pbr?.baseColorTexture?.index);
    const diffuseSpecularImage = textureSourceIndex(json, pbr?.metallicRoughnessTexture?.index);
    const normalImage = textureSourceIndex(json, mat?.normalTexture?.index);
    return {
        interleaved,
        indices,
        vertexCount: pos.count,
        indexCount: indices.length,
        floatsPerVertex: FLOATS_PER_VERT,
        bakedScale,
        images,
        baseColorImage,
        diffuseSpecularImage,
        normalImage,
        materialName: mat?.name ?? "",
    };
}
/** True when mesh has base color (or diffuse) and a normal map binding target. */
export function gltfHasColorAndNormal(mesh) {
    const hasColor = mesh.baseColorImage >= 0 || mesh.diffuseSpecularImage >= 0;
    const hasNormal = mesh.normalImage >= 0;
    return hasColor && hasNormal && mesh.vertexCount > 0 && mesh.indexCount >= 3;
}
export const GLTF_FLOATS_PER_VERTEX = FLOATS_PER_VERT;
//# sourceMappingURL=gltf-static-mesh.js.map