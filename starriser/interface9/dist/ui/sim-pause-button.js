import { ensureMicroStyles, microButton } from './micro.js';
import { bindText, setText } from './dom-bindings.js';
const PAUSE_ICON = 'M8 5 V19 M16 5 V19';
const PLAY_ICON = 'M9 5 L18 12 L9 19 Z';
const bindings = new Set();
/** Register once at mount; the UI/dock owner unregisters on teardown. */
export function registerSimPauseButton(button) {
    const name = button.querySelector('.dock-label');
    const icon = button.querySelector('svg');
    const text = bindText(name ?? button, name ? { width: '9ch' } : { width: '8ch', height: '22px' });
    const path = icon ? document.createElementNS('http://www.w3.org/2000/svg', 'path') : null;
    if (path)
        icon.replaceChildren(path);
    let previous;
    const paint = (paused) => {
        if (paused === previous)
            return;
        previous = paused;
        const title = paused ? 'Resume fleet movement and jumps' : 'Pause fleet movement and jumps';
        button.title = title;
        button.setAttribute('aria-label', title);
        button.setAttribute('aria-pressed', String(paused));
        setText(text, paused ? 'Resume' : 'Pause');
        if (path) {
            path.setAttribute('d', paused ? PLAY_ICON : PAUSE_ICON);
            path.setAttribute('fill', paused ? 'currentColor' : 'none');
            path.setAttribute('stroke', paused ? 'none' : 'currentColor');
        }
    };
    bindings.add(paint);
    return () => { bindings.delete(paint); };
}
/** A pause event patches retained controls; no document search or subtree rebuild. */
export function paintSimPauseButtons(paused) {
    for (const paint of bindings)
        paint(paused);
}
export function mountSimPauseButton(ctx, actions) {
    ensureMicroStyles();
    const button = microButton('Pause', 'Pause fleet movement and jumps', () => actions.toggleSimPaused());
    button.id = 'sim-pause';
    button.dataset.simPause = '1';
    const unregister = registerSimPauseButton(button);
    ctx.root.register({ id: 'sim-pause', kind: 'button', element: button,
        destroy() { unregister(); button.remove(); } });
    paintSimPauseButtons(actions.isSimPaused());
    return button;
}
//# sourceMappingURL=sim-pause-button.js.map