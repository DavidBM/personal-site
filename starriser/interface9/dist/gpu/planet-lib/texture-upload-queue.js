export class PlanetTextureUploads {
    constructor(device) {
        this.jobs = [];
        this.disposed = false;
        this.device = device;
    }
    enqueue(bitmap, label, current) {
        if (this.disposed) {
            bitmap.close();
            return Promise.reject(new Error('Planet uploads disposed'));
        }
        return new Promise((resolve, reject) => this.jobs.push({ bitmap, label, current, row: 0, texture: null, resolve, reject }));
    }
    pump() {
        // A cancellation also consumes the slot, so obsolete work cannot create a
        // long cleanup burst in one frame. Its bitmap and partial texture are freed.
        const job = this.jobs[0];
        if (!job)
            return;
        if (!job.current()) {
            this.finish(job, new Error('Planet texture request superseded'));
            return;
        }
        try {
            const { bitmap } = job;
            job.texture ?? (job.texture = this.device.createTexture({ label: job.label, size: [bitmap.width, bitmap.height], format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT }));
            const rows = Math.min(bitmap.height - job.row, Math.max(1, Math.floor(4 * 1024 * 1024 / (bitmap.width * 4))));
            this.device.queue.copyExternalImageToTexture({ source: bitmap, origin: [0, job.row] }, { texture: job.texture, origin: [0, job.row] }, [bitmap.width, rows]);
            job.row += rows;
            if (job.row === bitmap.height)
                this.finish(job);
        }
        catch (error) {
            this.finish(job, error instanceof Error ? error : new Error(String(error)));
        }
    }
    finish(job, error) {
        this.jobs.shift();
        job.bitmap.close();
        if (error) {
            job.texture?.destroy();
            job.reject(error);
        }
        else
            job.resolve(job.texture);
    }
    dispose() {
        this.disposed = true;
        while (this.jobs.length)
            this.finish(this.jobs[0], new Error('Planet uploads disposed'));
    }
}
//# sourceMappingURL=texture-upload-queue.js.map