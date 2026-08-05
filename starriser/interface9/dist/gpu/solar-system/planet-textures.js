/**
 * Load equirectangular planet maps for the solar-system showcase.
 * Paths are repo-root relative (served next to solar-system.html).
 *
 * Offline planet-texture bake consumption (research item 9b): pass
 * `BakedEquirectSources` or URL query `?bakedAlbedo=...&bakedNormal=...`
 * via `resolvePlanetTextureUrls` / `loadPlanetTexturePack(device, sources)`.
 * Does not wire into the main galaxy fleet map — showcase only.
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
    // REPEAT on U for longitude seam (matches PoC WRAP_MODES.REPEAT).
    const sampler = device.createSampler({
        label: "planet-equirect",
        addressModeU: "repeat",
        addressModeV: "clamp-to-edge",
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "nearest",
    });
    return {
        albedo: uploadBitmap(device, albedoBmp, "earth-albedo"),
        normal: uploadBitmap(device, normalBmp, "earth-normal"),
        spec: uploadBitmap(device, specBmp, "earth-spec"),
        night: uploadBitmap(device, nightBmp, "earth-night"),
        cloud: uploadBitmap(device, cloudBmp, "earth-cloud"),
        moon: uploadBitmap(device, moonBmp, "moon-albedo"),
        sampler,
        urls,
    };
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
        urls: {
            ...base.urls,
            albedo: "memory:baked-albedo",
            usedBakedAlbedo: true,
        },
    };
}
//# sourceMappingURL=planet-textures.js.map