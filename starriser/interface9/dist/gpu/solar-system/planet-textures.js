/**
 * Load equirectangular planet maps for the solar-system showcase.
 * Paths are repo-root relative (served next to solar-system.html).
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
/** Load all showcase planet maps. Throws if any fetch fails. */
export async function loadPlanetTexturePack(device) {
    const [albedoBmp, normalBmp, specBmp, nightBmp, cloudBmp, moonBmp] = await Promise.all([
        fetchBitmap(SOLAR_ASSET.earthAlbedo),
        fetchBitmap(SOLAR_ASSET.earthNormal),
        fetchBitmap(SOLAR_ASSET.earthSpec),
        fetchBitmap(SOLAR_ASSET.earthNight),
        fetchBitmap(SOLAR_ASSET.cloud),
        fetchBitmap(SOLAR_ASSET.moon),
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
    };
}
//# sourceMappingURL=planet-textures.js.map