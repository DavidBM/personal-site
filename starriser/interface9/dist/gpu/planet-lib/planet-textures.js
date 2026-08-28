/**
 * Load equirectangular planet maps (shared by the solar lab and the live map).
 * Paths are repo-root relative (served next to solar-system.html / index.html).
 *
 * Offline planet-texture bake consumption (research item 9b): pass
 * `BakedEquirectSources` or URL query `?bakedAlbedo=...&bakedNormal=...`
 * via `resolvePlanetTextureUrls` / `loadPlanetTexturePack(device, sources)`.
 */
export const SOLAR_ASSET = {
    earthAlbedo: "assets/solar/earthmap.jpg",
    earthNormal: "assets/solar/earthnormal.png",
    earthSpec: "assets/solar/earthspec.jpg",
    earthNight: "assets/solar/earthlights.jpg",
    cloud: "assets/solar/cloud.png",
    moon: "assets/solar/moon512.jpg",
};
async function fetchBitmap(url) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to load ${url} (${res.status})`);
    }
    const blob = await res.blob();
    return createImageBitmap(blob);
}
function createBellySampler(device, label = "planet-equirect") {
    // REPEAT on U for longitude seam (matches PoC WRAP_MODES.REPEAT).
    return device.createSampler({
        label,
        addressModeU: "repeat",
        addressModeV: "clamp-to-edge",
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "nearest",
    });
}
export function createPoleSampler(device, label = "planet-pole-clamp") {
    return device.createSampler({
        label,
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "nearest",
    });
}
/** 1×1 solid RGBA8 (authoring / missing-channel / dummy poles). */
export function uploadSolid(device, r, g, b, a, label) {
    return uploadRgbaEquirect(device, 1, 1, new Uint8ClampedArray([r, g, b, a]), label);
}
/** 1×1 RGBA (0,0,0,0) so dual-UV pole blend is a no-op. */
export function createDummyPoleTexture(device, label = "planet-pole-dummy") {
    return uploadSolid(device, 0, 0, 0, 0, label);
}
function attachDummyPoles(device, pack) {
    const dummy = createDummyPoleTexture(device);
    return {
        ...pack,
        poleSampler: createPoleSampler(device),
        poleNorth: dummy,
        poleSouth: dummy,
        cloudPoleNorth: dummy,
        cloudPoleSouth: dummy,
    };
}
/** Destroy GPU textures owned by a pack (samplers are device-lifetime). */
export function destroyPlanetTexturePack(pack) {
    const seen = new Set();
    for (const t of [
        pack.albedo,
        pack.normal,
        pack.spec,
        pack.night,
        pack.cloud,
        pack.moon,
        pack.poleNorth,
        pack.poleSouth,
        pack.cloudPoleNorth,
        pack.cloudPoleSouth,
    ]) {
        if (seen.has(t))
            continue;
        seen.add(t);
        try {
            t.destroy();
        }
        catch {
            /* already gone */
        }
    }
}
function uploadBitmap(device, bmp, label) {
    const tex = device.createTexture({
        label,
        size: [bmp.width, bmp.height],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
        mipLevelCount: 1, // no mips — lon seam UV derivatives would pick coarse mip (PoC note)
    });
    device.queue.copyExternalImageToTexture({ source: bmp }, { texture: tex }, [bmp.width, bmp.height]);
    bmp.close();
    return tex;
}
/**
 * Merge default solar assets with optional offline-baked equirect overrides.
 * Pure — no fetch; used by loader and Node smokes.
 */
export function resolvePlanetTextureUrls(baked) {
    const b = baked ?? {};
    const albedo = (b.albedoUrl && b.albedoUrl.trim()) || SOLAR_ASSET.earthAlbedo;
    return {
        albedo,
        normal: (b.normalUrl && b.normalUrl.trim()) || SOLAR_ASSET.earthNormal,
        spec: (b.specUrl && b.specUrl.trim()) || SOLAR_ASSET.earthSpec,
        night: (b.nightUrl && b.nightUrl.trim()) || SOLAR_ASSET.earthNight,
        cloud: (b.cloudUrl && b.cloudUrl.trim()) || SOLAR_ASSET.cloud,
        moon: (b.moonUrl && b.moonUrl.trim()) || SOLAR_ASSET.moon,
        usedBakedAlbedo: !!(b.albedoUrl && b.albedoUrl.trim()),
    };
}
/**
 * Parse showcase URL query for bake hooks:
 *   ?bakedAlbedo=path&bakedNormal=path&bakedSpec=path&bakedCloud=path
 * Pure string parse (works in Node with a search string).
 */
export function bakedSourcesFromSearch(search) {
    const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const pick = (k) => {
        const v = q.get(k);
        return v && v.trim() ? v.trim() : null;
    };
    return {
        albedoUrl: pick("bakedAlbedo"),
        normalUrl: pick("bakedNormal"),
        specUrl: pick("bakedSpec"),
        nightUrl: pick("bakedNight"),
        cloudUrl: pick("bakedCloud"),
        moonUrl: pick("bakedMoon"),
    };
}
/**
 * Upload raw RGBA8 equirect into a GPU texture (bake → showcase without files).
 * Pure helper for in-memory multi-map consumption.
 */
export function uploadRgbaEquirect(device, width, height, rgba, label) {
    if (rgba.length < width * height * 4) {
        throw new Error(`uploadRgbaEquirect: buffer too short for ${width}×${height}`);
    }
    const tex = device.createTexture({
        label,
        size: [width, height],
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
        mipLevelCount: 1,
    });
    device.queue.writeTexture({ texture: tex }, rgba, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height]);
    return tex;
}
/** Load all showcase planet maps. Throws if any fetch fails. */
export async function loadPlanetTexturePack(device, baked) {
    const urls = resolvePlanetTextureUrls(baked);
    const [albedoBmp, normalBmp, specBmp, nightBmp, cloudBmp, moonBmp] = await Promise.all([
        fetchBitmap(urls.albedo),
        fetchBitmap(urls.normal),
        fetchBitmap(urls.spec),
        fetchBitmap(urls.night),
        fetchBitmap(urls.cloud),
        fetchBitmap(urls.moon),
    ]);
    return attachDummyPoles(device, {
        albedo: uploadBitmap(device, albedoBmp, "earth-albedo"),
        normal: uploadBitmap(device, normalBmp, "earth-normal"),
        spec: uploadBitmap(device, specBmp, "earth-spec"),
        night: uploadBitmap(device, nightBmp, "earth-night"),
        cloud: uploadBitmap(device, cloudBmp, "earth-cloud"),
        moon: uploadBitmap(device, moonBmp, "moon-albedo"),
        sampler: createBellySampler(device),
        urls,
    });
}
/**
 * Build a pack using in-memory bake albedo (and optional maps), falling back
 * to default assets for missing channels. For GPU path after offline bake.
 */
export async function loadPlanetTexturePackFromBakeBuffers(device, bake) {
    // Load defaults for channels we don't replace
    const base = await loadPlanetTexturePack(device, null);
    // Replace albedo
    base.albedo.destroy();
    const albedo = uploadRgbaEquirect(device, bake.albedo.width, bake.albedo.height, bake.albedo.rgba, "baked-albedo");
    let normal = base.normal;
    if (bake.normal) {
        base.normal.destroy();
        normal = uploadRgbaEquirect(device, bake.normal.width, bake.normal.height, bake.normal.rgba, "baked-normal");
    }
    let spec = base.spec;
    if (bake.liquidMask) {
        base.spec.destroy();
        // Liquid mask R → spec-like ocean mask
        spec = uploadRgbaEquirect(device, bake.liquidMask.width, bake.liquidMask.height, bake.liquidMask.rgba, "baked-spec-liquid");
    }
    let cloud = base.cloud;
    if (bake.clouds) {
        base.cloud.destroy();
        cloud = uploadRgbaEquirect(device, bake.clouds.width, bake.clouds.height, bake.clouds.rgba, "baked-cloud");
    }
    return {
        albedo,
        normal,
        spec,
        night: base.night,
        cloud,
        moon: base.moon,
        sampler: base.sampler,
        poleSampler: base.poleSampler,
        poleNorth: base.poleNorth,
        poleSouth: base.poleSouth,
        cloudPoleNorth: base.cloudPoleNorth,
        cloudPoleSouth: base.cloudPoleSouth,
        urls: {
            ...base.urls,
            albedo: "memory:baked-albedo",
            usedBakedAlbedo: true,
        },
    };
}
function trimMap(maps, key) {
    const v = maps[key];
    return v && v.trim() ? v.trim() : null;
}
function pickMap(maps, keys) {
    for (const k of keys) {
        const v = trimMap(maps, k);
        if (v)
            return v;
    }
    return null;
}
async function fetchBitmapOrNull(url) {
    if (!url)
        return null;
    try {
        return await fetchBitmap(url);
    }
    catch (err) {
        console.warn("[planet-textures] catalog map failed", url, err);
        return null;
    }
}
function texFromBmpOrSolid(device, bmp, label, fallback) {
    if (bmp)
        return uploadBitmap(device, bmp, label);
    return uploadSolid(device, fallback[0], fallback[1], fallback[2], fallback[3], label);
}
/**
 * Load one catalog planet pack.
 * - preview: preview_* (or 4k albedo if preview missing). Dummy poles OK.
 * - hi: 4k albedo/normal/spec/night/clouds + real pole textures when paths exist.
 */
export async function loadCatalogPlanetPack(device, maps, quality) {
    const preview = quality === "preview";
    const albedoUrl = preview
        ? pickMap(maps, ["preview_albedo", "albedo"])
        : pickMap(maps, ["albedo", "preview_albedo"]);
    if (!albedoUrl) {
        throw new Error("loadCatalogPlanetPack: missing albedo / preview_albedo");
    }
    const normalUrl = preview
        ? pickMap(maps, ["preview_normal", "normal"])
        : pickMap(maps, ["normal", "preview_normal"]);
    const specUrl = preview
        ? pickMap(maps, ["preview_spec", "spec"])
        : pickMap(maps, ["spec", "preview_spec"]);
    const nightUrl = preview
        ? pickMap(maps, ["preview_night", "night"])
        : pickMap(maps, ["night", "preview_night"]);
    const cloudUrl = preview
        ? pickMap(maps, ["preview_clouds", "clouds"])
        : pickMap(maps, ["clouds", "preview_clouds"]);
    const poleNUrl = preview ? null : trimMap(maps, "pole_n");
    const poleSUrl = preview ? null : trimMap(maps, "pole_s");
    const cloudPoleNUrl = preview ? null : trimMap(maps, "clouds_pole_n");
    const cloudPoleSUrl = preview ? null : trimMap(maps, "clouds_pole_s");
    const [albedoBmp, normalBmp, specBmp, nightBmp, cloudBmp, poleNBmp, poleSBmp, cloudPoleNBmp, cloudPoleSBmp,] = await Promise.all([
        fetchBitmap(albedoUrl),
        fetchBitmapOrNull(normalUrl),
        fetchBitmapOrNull(specUrl),
        fetchBitmapOrNull(nightUrl),
        fetchBitmapOrNull(cloudUrl),
        fetchBitmapOrNull(poleNUrl),
        fetchBitmapOrNull(poleSUrl),
        fetchBitmapOrNull(cloudPoleNUrl),
        fetchBitmapOrNull(cloudPoleSUrl),
    ]);
    const dummyPole = createDummyPoleTexture(device, `catalog-pole-dummy-${quality}`);
    return {
        albedo: uploadBitmap(device, albedoBmp, `catalog-albedo-${quality}`),
        normal: texFromBmpOrSolid(device, normalBmp, `catalog-normal-${quality}`, [
            128, 128, 255, 255,
        ]),
        spec: texFromBmpOrSolid(device, specBmp, `catalog-spec-${quality}`, [
            0, 0, 0, 255,
        ]),
        night: texFromBmpOrSolid(device, nightBmp, `catalog-night-${quality}`, [
            0, 0, 0, 255,
        ]),
        cloud: texFromBmpOrSolid(device, cloudBmp, `catalog-cloud-${quality}`, [
            0, 0, 0, 0,
        ]),
        moon: uploadSolid(device, 80, 80, 80, 255, `catalog-moon-${quality}`),
        sampler: createBellySampler(device, `catalog-equirect-${quality}`),
        poleSampler: createPoleSampler(device, `catalog-poleSampler-${quality}`),
        poleNorth: poleNBmp
            ? uploadBitmap(device, poleNBmp, `catalog-pole-n-${quality}`)
            : dummyPole,
        poleSouth: poleSBmp
            ? uploadBitmap(device, poleSBmp, `catalog-pole-s-${quality}`)
            : dummyPole,
        cloudPoleNorth: cloudPoleNBmp
            ? uploadBitmap(device, cloudPoleNBmp, `catalog-cloud-pole-n-${quality}`)
            : dummyPole,
        cloudPoleSouth: cloudPoleSBmp
            ? uploadBitmap(device, cloudPoleSBmp, `catalog-cloud-pole-s-${quality}`)
            : dummyPole,
        urls: {
            albedo: albedoUrl,
            normal: normalUrl ?? "memory:flat-normal",
            spec: specUrl ?? "memory:black-spec",
            night: nightUrl ?? "memory:black-night",
            cloud: cloudUrl ?? "memory:empty-cloud",
            moon: "memory:catalog-moon",
            usedBakedAlbedo: true,
        },
    };
}
//# sourceMappingURL=planet-textures.js.map