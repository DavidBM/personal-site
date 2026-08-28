/**
 * View-owned catalog texture residency.
 *
 * Preview ~1k cache keyed by catalog id. Refuse a 9th **concurrent** preview
 * ({@link retainPreviews} / {@link releasePreview} evict on SCENE rebuild so
 * refuse-9th is not a lifetime lock).
 * One hi 4K+pole slot (`promoteHi` / `releaseHi`) — at most one {@link loadHi}
 * in flight (`hiLoading`); RecurseDraw parent until it lands.
 *
 * Never fetch inside renderFrame — {@link requestPreview} only admits and
 * schedules a microtask. Encode reads whatever is already resident.
 */
import { catalogMapsRecord } from "./planet-lib/catalog-assets.js";
import { createDummyPoleTexture, createPoleSampler, destroyPlanetTexturePack, loadCatalogPlanetPack, uploadSolid, } from "./planet-lib/planet-textures.js";
export const MAX_PREVIEW_PACKS = 8;
/**
 * Pure admission (Node-testable). `have` = cached ∪ in-flight ids.
 */
export function admitPreviewRequest(have, id, max = MAX_PREVIEW_PACKS) {
    if (!id)
        return "refuse";
    if (have.has(id))
        return "hit";
    if (have.size >= max)
        return "refuse";
    return "admit";
}
/** Ids in `have` that are not in the current compact Kepler keep-set. */
export function previewIdsToRelease(have, keep) {
    const out = [];
    for (const id of have) {
        if (!keep.has(id))
            out.push(id);
    }
    return out;
}
function createBellySampler(device, label) {
    return device.createSampler({
        label,
        addressModeU: "repeat",
        addressModeV: "clamp-to-edge",
        magFilter: "linear",
        minFilter: "linear",
        mipmapFilter: "nearest",
    });
}
/** 1×1 analytic fallback so Band B can draw before / without catalog I/O. */
export function createDummyPlanetPack(device, label = "solar-catalog-dummy") {
    const dummyPole = createDummyPoleTexture(device, `${label}-pole`);
    return {
        albedo: uploadSolid(device, 90, 110, 160, 255, `${label}-albedo`),
        normal: uploadSolid(device, 128, 128, 255, 255, `${label}-normal`),
        spec: uploadSolid(device, 0, 0, 0, 255, `${label}-spec`),
        night: uploadSolid(device, 0, 0, 0, 255, `${label}-night`),
        cloud: uploadSolid(device, 0, 0, 0, 0, `${label}-cloud`),
        moon: uploadSolid(device, 80, 80, 80, 255, `${label}-moon`),
        sampler: createBellySampler(device, `${label}-samp`),
        poleSampler: createPoleSampler(device, `${label}-poleSamp`),
        poleNorth: dummyPole,
        poleSouth: dummyPole,
        cloudPoleNorth: dummyPole,
        cloudPoleSouth: dummyPole,
        urls: {
            albedo: "memory:dummy",
            normal: "memory:dummy",
            spec: "memory:dummy",
            night: "memory:dummy",
            cloud: "memory:dummy",
            moon: "memory:dummy",
            usedBakedAlbedo: false,
        },
    };
}
export class SolarCatalogResidency {
    constructor(device, dummy) {
        this.preview = new Map();
        this.pending = new Set();
        this.failed = new Set();
        this.hiId = null;
        this.hiPack = null;
        this.hiPending = null;
        /** One in-flight {@link loadHi}; further pumps are ignored until it settles. */
        this.hiLoading = false;
        this.queued = new Set();
        this.device = device;
        this.dummy = dummy ?? createDummyPlanetPack(device);
    }
    previewCount() {
        return this.preview.size;
    }
    pendingCount() {
        return this.pending.size;
    }
    hasPreview(id) {
        return this.preview.has(id);
    }
    hiCatalogId() {
        return this.hiId;
    }
    /**
     * Admit a preview slot. Does **not** fetch — call {@link pumpPreviewLoads}
     * after renderFrame / GPU submit.
     */
    requestPreview(id) {
        if (!id)
            return "refused";
        if (this.preview.has(id))
            return "ready";
        if (this.pending.has(id) || this.queued.has(id))
            return "pending";
        const have = new Set(this.preview.keys());
        for (const p of this.pending)
            have.add(p);
        for (const q of this.queued)
            have.add(q);
        const admit = admitPreviewRequest(have, id, MAX_PREVIEW_PACKS);
        if (admit === "refuse")
            return "refused";
        this.queued.add(id);
        return "pending";
    }
    /**
     * Start admitted preview fetches. Call **after** renderFrame / GPU submit,
     * never from inside encode or measureOneGpuFrameMs.
     */
    pumpPreviewLoads() {
        if (this.queued.size === 0)
            return;
        const ids = [...this.queued];
        this.queued.clear();
        for (const id of ids) {
            if (this.preview.has(id) || this.pending.has(id))
                continue;
            const have = new Set(this.preview.keys());
            for (const p of this.pending)
                have.add(p);
            if (admitPreviewRequest(have, id, MAX_PREVIEW_PACKS) === "refuse")
                continue;
            this.pending.add(id);
            void this.loadPreview(id);
        }
    }
    /**
     * Drop one preview (and cancel queued / in-flight). GPU pack is destroyed.
     * In-flight {@link loadPreview} sees pending cleared and discards the pack.
     */
    releasePreview(id) {
        if (!id)
            return;
        const pack = this.preview.get(id);
        if (pack) {
            destroyPlanetTexturePack(pack);
            this.preview.delete(id);
        }
        this.queued.delete(id);
        this.pending.delete(id);
        this.failed.delete(id);
    }
    /**
     * Keep only `keep` (current compact Kepler planet ids). Refuse-9th is a
     * concurrent cap — SCENE rebuild must evict the previous set.
     */
    retainPreviews(keep) {
        for (const id of previewIdsToRelease(this.preview.keys(), keep)) {
            this.releasePreview(id);
        }
        for (const id of previewIdsToRelease(this.queued, keep)) {
            this.queued.delete(id);
        }
        for (const id of previewIdsToRelease(this.pending, keep)) {
            this.pending.delete(id);
        }
        for (const id of previewIdsToRelease(this.failed, keep)) {
            this.failed.delete(id);
        }
    }
    /**
     * One hi 4K+pole slot. S4 calls this for the focused body only.
     * RecurseDraw parent (preview / dummy) stays until hi resolves.
     */
    promoteHi(catalogId) {
        if (!catalogId)
            return "refused";
        if (this.hiId === catalogId && this.hiPack)
            return "ready";
        if (this.hiPending === catalogId)
            return "pending";
        this.hiPending = catalogId;
        return "pending";
    }
    /**
     * S4 calls after the frame that requested {@link promoteHi}.
     * Starts at most one {@link loadHi}; later pumps no-op until it settles.
     */
    pumpHiLoad() {
        if (this.hiLoading)
            return;
        const id = this.hiPending;
        if (!id || (this.hiId === id && this.hiPack))
            return;
        this.hiLoading = true;
        void this.loadHi(id).finally(() => {
            this.hiLoading = false;
        });
    }
    releaseHi() {
        this.hiPending = null;
        if (this.hiPack) {
            destroyPlanetTexturePack(this.hiPack);
            this.hiPack = null;
        }
        this.hiId = null;
    }
    /**
     * RecurseDraw: hi if resident for this id, else preview, else dummy.
     */
    packForDraw(id) {
        if (id && this.hiId === id && this.hiPack)
            return this.hiPack;
        if (id && this.preview.has(id))
            return this.preview.get(id);
        return this.dummy;
    }
    dispose() {
        this.releaseHi();
        for (const pack of this.preview.values()) {
            destroyPlanetTexturePack(pack);
        }
        this.preview.clear();
        this.pending.clear();
        this.failed.clear();
        destroyPlanetTexturePack(this.dummy);
    }
    async loadPreview(id) {
        if (this.preview.has(id)) {
            this.pending.delete(id);
            return;
        }
        try {
            const maps = catalogMapsRecord(id);
            const pack = await loadCatalogPlanetPack(this.device, maps, "preview");
            if (!this.pending.has(id)) {
                destroyPlanetTexturePack(pack);
                return;
            }
            if (this.preview.size >= MAX_PREVIEW_PACKS && !this.preview.has(id)) {
                destroyPlanetTexturePack(pack);
                this.failed.add(id);
                return;
            }
            const prev = this.preview.get(id);
            if (prev)
                destroyPlanetTexturePack(prev);
            this.preview.set(id, pack);
        }
        catch {
            this.failed.add(id);
        }
        finally {
            this.pending.delete(id);
        }
    }
    async loadHi(id) {
        if (this.hiPending !== id)
            return;
        try {
            const maps = catalogMapsRecord(id);
            const pack = await loadCatalogPlanetPack(this.device, maps, "hi");
            if (this.hiPending !== id) {
                destroyPlanetTexturePack(pack);
                return;
            }
            if (this.hiPack)
                destroyPlanetTexturePack(this.hiPack);
            this.hiPack = pack;
            this.hiId = id;
        }
        catch {
            /* RecurseDraw keeps preview / dummy */
        }
        finally {
            if (this.hiPending === id)
                this.hiPending = null;
        }
    }
}
//# sourceMappingURL=solar-catalog-residency.js.map