import { bindText, setText } from './dom-bindings.js';
/** Optional 5 Hz observer; consumer formats a tiny summary, never ship rows. */
export class QualityDiagnosticsPanel {
    constructor(client) {
        this.text = [];
        this.timer = null;
        this.closed = false;
        this.history = [];
        this.client = client;
        this.element = document.createElement('section');
        Object.assign(this.element.style, { position: 'fixed', right: '260px', bottom: '12px', width: '310px', height: '226px', contain: 'strict', overflow: 'hidden', background: '#020814ed', color: '#91bbce', border: '1px solid #284056', padding: '8px', font: '10px monospace', zIndex: '30' });
        for (let i = 0; i < 11; i++) {
            const row = document.createElement('div');
            this.text.push(bindText(row, { height: '16px', lineHeight: '16px' }));
            this.element.append(row);
        }
        const save = document.createElement('button');
        save.textContent = 'Export samples';
        save.addEventListener('click', () => this.export());
        this.element.append(save);
        const timing = document.createElement('button');
        timing.textContent = 'Capture pass times';
        timing.addEventListener('click', () => {
            timing.disabled = true;
            void client.query({ type: 'measureFrameTimings' }).then(result => {
                if (!this.closed) {
                    this.history.push({ wallMs: Date.now(), passTiming: result });
                    if (this.history.length > 300)
                        this.history.shift();
                }
            }).catch(error => { if (!this.closed)
                setText(this.text[1], String(error)); }).finally(() => { timing.disabled = false; });
        });
        this.element.append(timing);
        document.body.append(this.element);
        setText(this.text[0], 'GPU detail diagnostics · sampled at 5 Hz');
        void this.sample();
    }
    async sample() {
        try {
            const result = await this.client.query({ type: 'qualitySample' });
            if (this.closed)
                return;
            if (result) {
                const c = result.counts, snapshot = this.client.snapshot();
                const record = { ...result, systemId: snapshot?.systemId, metrics: snapshot ? { ...snapshot.metrics } : null, dpr: devicePixelRatio };
                this.history.push(record);
                if (this.history.length > 300)
                    this.history.shift();
                const values = [
                    `Resident ${c[0]} · ${result.width}×${result.height}`,
                    `Hull tiny / low / full: ${c[1]} / ${c[2]} / ${c[3]}`,
                    `Visible hulls: ${result.visible.join(" / ")}`,
                    `Pilot every 8 / 2 / 1 ticks: ${c[11]} / ${c[12]} / ${c[13]}`,
                    `Managed ${c[10]} · invalid advice ${c[18]}`,
                    `Warp ${c[14]} · combat ${c[15]} · timed ${c[16]}`,
                    `Missing guide ${c[17]} · emitters ${result.emitters}`,
                    `Trail segments ${result.segments}`,
                    `Observed hull / pilot changes: ${c[7]} / ${c[8]}`,
                    `Refreshed since sample: ${c[9]} ships`,
                ];
                values.forEach((v, i) => setText(this.text[i + 1], v));
            }
            else
                setText(this.text[1], 'Waiting for an active ship scene');
        }
        catch (error) {
            if (!this.closed)
                setText(this.text[1], `Sample failed: ${String(error)}`);
        }
        if (!this.closed)
            this.timer = setTimeout(() => void this.sample(), 200);
    }
    export() {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, mode: 'sampled-summary; normal grouped simulation', samples: this.history }, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'galaxy-gpu-quality.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    dispose() {
        this.closed = true;
        if (this.timer !== null)
            clearTimeout(this.timer);
        this.history = [];
        this.element.remove();
        this.client.send({ type: 'clearQualityDiagnostics' });
    }
}
//# sourceMappingURL=quality-diagnostics.js.map