import { watchGameplay } from '../../features/http-worker/client.js';
import { bindText, setText, setDisabled } from '../../ui/dom-bindings.js';
import { requestDevelopment } from '../../lib/development-content/client.js';
const names = ['', 'Habitat', 'Industrial complex', 'Research campus', 'Floating platform'];
/** Sparse commands and retained display nodes; deadlines need no polling loop. */
export function createDevelopmentPanel(parent, overlay, inspect) {
    const root = document.createElement('aside');
    root.className = 'planet-development';
    root.innerHTML = '<p class="planet-eyebrow">SURFACE DEVELOPMENT</p><h2>Make this world yours</h2><p class="development-intro">Place a complex on the surface. Shape settlement, industry and research areas.</p><div class="development-kinds"></div><p class="development-anchor"></p><button class="development-build" type="button">Build here</button><p class="development-status" role="status"></p><div class="development-toolbar"><strong>Complexes</strong><button class="development-refresh" type="button">Refresh</button></div><div class="development-buildings"></div><div class="development-paging"><button type="button">First</button><button type="button">Next</button></div><p class="development-selected"></p><button class="development-upgrade" type="button">Upgrade</button><button class="development-retry" type="button" hidden>Retry unconfirmed order</button><p class="development-note">Construction preview. Area rings are planning overlays; production and population effects come later.</p>';
    parent.append(root);
    const status = bindText(root.querySelector('.development-status'), { height: '56px', lineHeight: '18px', wrap: true }), anchor = bindText(root.querySelector('.development-anchor')), selected = bindText(root.querySelector('.development-selected'), { height: '36px', lineHeight: '18px', wrap: true });
    const build = root.querySelector('.development-build'), upgrade = root.querySelector('.development-upgrade'), retry = root.querySelector('.development-retry');
    const buildText = bindText(build, { height: '38px', lineHeight: '22px' }), upgradeText = bindText(upgrade, { height: '38px', lineHeight: '22px' });
    const refresh = root.querySelector('.development-refresh'), paging = root.querySelectorAll('.development-paging button');
    let context, selection, scope, body = '', revision = '0', canBuild = false, suspended = false, kind = 1, rows = [], chosen, next = null, cursor;
    let retained;
    let pending, command, clock = 0n, clockAt = 0, closed = false, visible = false, interval;
    const kinds = names.slice(1).map((name, i) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.dataset.kind = String(i + 1); b.setAttribute('aria-pressed', String(i === 0)); b.onclick = () => { kind = i + 1; kinds.forEach((node, j) => node.setAttribute('aria-pressed', String(j === i))); show(); }; root.querySelector('.development-kinds').append(b); return b; });
    const pool = Array.from({ length: 32 }, () => { const b = document.createElement('button'); b.type = 'button'; b.hidden = true; const label = document.createElement('span'), time = document.createElement('span'); b.append(label, time); root.querySelector('.development-buildings').append(b); let value; b.onclick = () => { if (value) {
        chosen = value.id;
        inspect(value.x, value.y);
        show();
    } }; return { b, label: bindText(label, { height: '18px', lineHeight: '18px' }), time: bindText(time, { height: '18px', lineHeight: '18px' }), set(v) { value = v; b.hidden = !v; } }; });
    function now() { return clock + BigInt(Math.max(0, Math.floor(performance.now() - clockAt))); }
    function tick() { const current = now(); rows.forEach((b, i) => { const active = BigInt(b.readyMs) > current; const level = BigInt(b.targetLevel) - (active ? 1n : 0n); setText(pool[i].time, active ? `${level === 0n ? 'Building' : 'Upgrading'} · ${Math.max(0, Math.ceil(Number(BigInt(b.readyMs) - current) / 1000))}s` : `Level ${level} · Ready`); }); const b = rows.find(b => b.id === chosen); setDisabled(upgrade, !selection || !canBuild || suspended || !!pending || !!retained || !b || BigInt(b.readyMs) > current); if (!rows.some(b => BigInt(b.readyMs) > current) && interval) {
        clearInterval(interval);
        interval = undefined;
    } }
    function show() {
        setText(anchor, selection?.pixel ? `Site ${selection.pixel.x}, ${selection.pixel.y}` : 'Choose a site on the map');
        build.disabled = !canBuild || suspended || !selection?.pixel || !!pending || !!retained;
        kinds.forEach(b => { const cls = context?.bodies.find(b => b.bodyId === body)?.planetClass; b.disabled = !canBuild || suspended || !!command || (cls === 'gas' ? b.dataset.kind !== '4' : b.dataset.kind === '4'); });
        pool.forEach((p, i) => { const b = rows[i]; p.set(b); if (b) {
            setText(p.label, `${names[b.kind]} · ${b.x}, ${b.y}`);
            p.b.setAttribute('aria-pressed', String(b.id === chosen));
        }
        else {
            setText(p.label, '');
            setText(p.time, '');
        } });
        const b = rows.find(b => b.id === chosen);
        setText(selected, b ? `${names[b.kind]} · Next level ${BigInt(b.targetLevel) + 1n}` : 'Select a complex to upgrade');
        paging[1].disabled = !next || !!pending;
        paging[0].disabled = !cursor || !!pending;
        refresh.disabled = !!pending;
        retry.hidden = !command;
        retry.disabled = !!pending;
        overlay({ buildings: rows, selected: chosen, anchor: selection?.pixel ? { ...selection.pixel, kind } : undefined });
        tick();
        if (visible && interval === undefined && rows.some(b => BigInt(b.readyMs) > now()))
            interval = setInterval(tick, 250);
    }
    async function perform(op) {
        if (!scope || !body || pending || closed)
            return;
        const owner = new AbortController();
        pending = owner;
        const target = body;
        if (op.action !== 'list')
            retained = { world: scope.worldId, system: scope.systemId, body, operation: op };
        show();
        setText(status, op.action === 'list' ? 'Loading surface development…' : 'Sending order…');
        try {
            const result = await requestDevelopment(scope, target, op, owner.signal);
            if (pending !== owner || body !== target)
                return;
            clock = BigInt(result.serverNowMs);
            clockAt = performance.now();
            if (result.kind === 'page') {
                setText(buildText, `Build here · ${Math.ceil(Number(result.durationMs) / 1000)}s`);
                setText(upgradeText, `Upgrade · ${Math.ceil(Number(result.durationMs) / 1000)}s`);
                revision = result.revision;
                canBuild = result.canBuild;
                rows = result.buildings;
                next = result.next;
                setText(status, canBuild ? 'Your world · Select a site, then build.' : 'Exploration view · Construction requires ownership.');
            }
            if (result.kind === 'accepted') {
                command = undefined;
                retained = undefined;
                const at = rows.findIndex(b => b.id === result.building.id);
                if (at >= 0)
                    rows[at] = result.building;
                else if (rows.length < 32)
                    rows.push(result.building);
                chosen = result.building.id;
                if (op.action === 'build')
                    revision = String(BigInt(op.revision) + 1n);
                setText(status, 'Order confirmed. Construction is underway.');
            }
        }
        catch (e) {
            if (pending !== owner)
                return;
            const code = e.status;
            if (code && [400, 401, 403, 404, 409, 412, 429].includes(code)) {
                command = undefined;
                if (op.action !== 'list')
                    retained = undefined;
            }
            if (code === 404 && op.action === 'list') {
                canBuild = false;
                setText(status, 'Surface development is not available on this world yet.');
            }
            else
                setText(status, e instanceof Error ? e.message : 'Request unconfirmed. Retry this order.');
        }
        finally {
            if (pending === owner) {
                pending = undefined;
                show();
                if (dirty) {
                    dirty = false;
                    load();
                }
            }
        }
    }
    let dirty = false;
    const unwatch = watchGameplay(8, () => { if (!scope || !body || closed)
        return; if (pending)
        dirty = true;
    else
        load(); });
    function load() { void perform({ action: 'list', after: cursor }); }
    build.onclick = () => { if (build.disabled || !selection?.pixel)
        return; command = { action: 'build', commandId: crypto.randomUUID().replace(/-/g, ''), revision, kind, ...selection.pixel }; void perform(command); };
    upgrade.onclick = () => { const b = rows.find(b => b.id === chosen); if (upgrade.disabled || !b)
        return; command = { action: 'upgrade', commandId: crypto.randomUUID().replace(/-/g, ''), buildingId: b.id, level: b.targetLevel }; void perform(command); };
    retry.onclick = () => { if (command)
        void perform(command); };
    refresh.onclick = load;
    paging[0].onclick = () => { cursor = undefined; load(); };
    paging[1].onclick = () => { if (next) {
        cursor = next;
        load();
    } };
    function clear() { pending?.abort(); pending = undefined; body = ''; scope = undefined; selection = undefined; rows = []; chosen = undefined; canBuild = false; command = undefined; cursor = undefined; next = null; show(); }
    return { resetSelection: clear, setContext(value) { if (context?.worldId !== value?.worldId || context?.systemId !== value?.systemId || context?.visibilityEpoch !== value?.visibilityEpoch)
            clear(); context = value; suspended = false; show(); },
        suspend() { suspended = true; show(); },
        select(value) { if (!value) {
            selection = undefined;
            show();
            return;
        } if (!context || value.systemId !== context.systemId)
            return; selection = value; if (body !== value.bodyId) {
            clear();
            selection = value;
            body = value.bodyId;
            scope = { worldId: context.worldId, systemId: context.systemId, visibilityEpoch: context.visibilityEpoch };
            if (retained?.world === scope.worldId && retained.system === scope.systemId && retained.body === body)
                command = retained.operation;
            const cls = context.bodies.find(b => b.bodyId === body)?.planetClass;
            kind = cls === 'gas' ? 4 : 1;
            kinds.forEach((b, i) => b.setAttribute('aria-pressed', String(i === kind - 1)));
            load();
        } if (value.pixel) {
            chosen = rows.find(b => ((value.pixel.x - b.x + 8192) % 8192) < 2 && value.pixel.y >= b.y && value.pixel.y <= b.y + 1)?.id;
        } show(); },
        visible(value) { visible = value; if (interval)
            clearInterval(interval); interval = undefined; if (visible)
            tick(); if (visible && rows.some(b => BigInt(b.readyMs) > now()))
            interval = setInterval(tick, 250); },
        dispose() { closed = true; unwatch(); retained = undefined; clear(); if (interval)
            clearInterval(interval); root.remove(); } };
}
//# sourceMappingURL=panel.js.map