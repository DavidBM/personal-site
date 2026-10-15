import { bindText, setText, setHidden } from './dom-bindings.js';
/** Persistent command selection is independent of the camera and scene residency. */
export function createSelectedFleet(parent, go, clear, follow) {
    const root = document.createElement('section');
    root.id = 'selected-fleet';
    root.hidden = true;
    root.setAttribute('aria-label', 'Selected fleet');
    root.innerHTML = '<div class="selected-fleet-types"></div><header><strong></strong><button type="button" aria-label="Deselect fleet">×</button></header><p class="selected-fleet-count"></p><p class="selected-fleet-location"></p><p class="selected-fleet-activity" role="status"></p><div class="selected-fleet-timers"></div><div class="selected-fleet-actions"><button type="button" class="selected-fleet-go">Go to fleet ↗</button><button type="button" class="selected-fleet-follow" title="Stay with one ship through departure, warp and arrival">Follow ship</button></div>';
    parent.append(root);
    const name = bindText(root.querySelector('strong'), { width: '24ch' }), count = bindText(root.querySelector('.selected-fleet-count')), location = bindText(root.querySelector('.selected-fleet-location')), activity = bindText(root.querySelector('.selected-fleet-activity'));
    const button = root.querySelector('.selected-fleet-go');
    root.querySelector('header button').addEventListener('click', clear);
    button.addEventListener('click', go);
    const followButton = root.querySelector('.selected-fleet-follow');
    followButton.hidden = !follow;
    followButton.addEventListener('click', () => follow?.());
    const names = ['Interceptor', 'Fighter', 'Bomber', 'Frigate', 'Battleship', 'Colossus'];
    const shapes = ['M12 3 20 21 12 16 4 21Z', 'M12 3 16 10 22 18 15 17 12 21 9 17 2 18 8 10Z', 'M12 3 19 9 19 19 5 19 5 9Z', 'M12 2 16 8 16 19 12 23 8 19 8 8Z', 'M12 2 18 8 20 20 14 19 12 23 10 19 4 20 6 8Z', 'M8 2 16 2 16 7 21 10 21 19 16 18 16 23 8 23 8 18 3 19 3 10 8 7Z'];
    const badges = names.map((name, i) => { const node = document.createElement('div'); node.className = 'selected-ship-circle'; node.hidden = true; node.innerHTML = `<svg viewBox="0 0 24 26" aria-hidden="true"><path d="${shapes[i]}"/></svg><span></span>`; node.title = name; node.setAttribute('aria-label', name); root.querySelector('.selected-fleet-types').append(node); return { node, text: bindText(node.querySelector('span'), { width: '7ch', height: '14px', lineHeight: '14px' }) }; });
    const timers = Array.from({ length: 3 }, () => { const node = document.createElement('p'); root.querySelector('.selected-fleet-timers').append(node); return bindText(node, { height: '16px', lineHeight: '16px' }); });
    let value, interval;
    function tick() { for (let i = 0; i < timers.length; i++) {
        const t = value?.timers?.[i];
        setText(timers[i], t ? `${t.label} · ${Math.max(0, Math.ceil((t.endsAt - performance.now()) / 1000))}s` : '');
    } }
    return { value: () => value,
        update(next) {
            value = next;
            setHidden(root, !next);
            if (!next) {
                if (interval !== undefined)
                    clearInterval(interval);
                interval = undefined;
                return;
            }
            setText(name, next.name);
            setText(count, `${next.ships.toLocaleString()} ships${next.canOrder ? ' · Yours' : ''}`);
            badges.forEach((badge, i) => { const n = next.counts?.[i] ?? 0; setHidden(badge.node, n === 0); setText(badge.text, n.toLocaleString()); });
            tick();
            if (next.timers?.length && interval === undefined)
                interval = setInterval(tick, 250);
            else if (!next.timers?.length && interval !== undefined) {
                clearInterval(interval);
                interval = undefined;
            }
            setText(location, next.location);
            setText(activity, next.activity);
            const canFollow = next.canFollow ?? next.canGo;
            if (followButton.disabled === canFollow)
                followButton.disabled = !canFollow;
            if (button.disabled === next.canGo)
                button.disabled = !next.canGo;
            if (root.dataset.fleetId !== next.id)
                root.dataset.fleetId = next.id;
        }, dispose() { if (interval !== undefined)
            clearInterval(interval); value = undefined; root.remove(); } };
}
//# sourceMappingURL=selected-fleet.js.map