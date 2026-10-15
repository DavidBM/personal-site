import { screenAnchor } from './dock-layout.js';
/** Online panels join the same retained, compact dock as the local sandbox. */
export function onlineShellMarkup() {
    return `    <p class="online-status" role="status" aria-live="polite">Connecting to the galaxy…</p>
    <section class="ui-panel game-drawer" data-drawer="account" aria-label="Account" hidden>
      <header class="ui-panel-title"><h2>Account</h2><button type="button" data-close aria-label="Close account">×</button></header>
      <form class="online-connect">
        <label>Server<input name="server" type="url" value="https://localhost:4433/session" required></label>
        <label>Fallback server<input name="fallback" type="url" value="ws://127.0.0.1:4435/session" required></label>
        <label>Server certificate SHA-256 (optional)<input name="pin" spellcheck="false" autocomplete="off"></label>
        <label>Access code<input name="credential" type="password" autocomplete="off" spellcheck="false" required></label>
        <button type="submit">Connect</button><button type="button" data-action="signout" hidden>Sign out</button>
      </form>
    </section>
    <div class="online-orders" inert>
      <section class="ui-panel game-drawer online-navigation" data-drawer="navigation" aria-label="Atlas" hidden>
        <header class="ui-panel-title"><h2>Atlas</h2><button type="button" data-close aria-label="Close atlas">×</button></header>
        <p>Scroll to zoom. Drag to pan. Systems load around your view.</p>
        <label>Nearby systems<select class="online-systems" aria-label="Viewing system"></select></label>
        <button type="button" data-action="view">Enter system</button><button type="button" data-action="galaxy">Find a cluster</button>
      </section>
      <section class="ui-panel game-drawer online-fleet-panel" data-drawer="fleet" aria-label="Fleets" hidden>
        <header class="ui-panel-title"><h2>Fleets</h2><button type="button" data-close aria-label="Close fleets">×</button></header>
        <div class="online-roster-panel"></div>
        <label>Fleets in this system<select class="online-fleets" aria-label="Your fleets"></select></label>
        <button type="button" data-action="details">Fleet details</button><button type="button" data-action="focus">Focus fleet</button>
        <span class="online-page"></span><button type="button" data-action="first">First page</button><button type="button" data-action="more" hidden>Next page</button>
        <details><summary>Movement orders</summary>
          <div class="online-target"><label>Destination X<input name="x" type="number" step="0.001" value="0.025"></label>
            <label>Destination Z<input name="z" type="number" step="0.001" value="0.015"></label></div>
          <button type="button" data-action="preview">Preview move</button><button type="button" data-action="move">Move</button>
          <label>Route destination<select class="online-destinations" aria-label="Jump destination"></select></label>
          <button type="button" data-action="route">Preview route</button><button type="button" data-action="transfer">Jump</button>
          <p class="online-preview" role="status"></p>
        </details>
        <div class="online-recovery" hidden>
          <label>Unresolved orders<select class="online-retained" aria-label="Retained orders"></select></label><p class="online-recovery-message"></p>
          <button type="button" data-action="resolve">Check original order</button><button type="button" data-action="retry">Retry original order</button>
          <button type="button" data-action="continue">Continue with a new order</button>
        </div>
      </section>
      <section class="ui-panel game-drawer online-activity" data-drawer="activity" aria-label="Operations" hidden>
        <header class="ui-panel-title"><h2>Operations</h2><button type="button" data-close aria-label="Close operations">×</button></header>
      </section>
      <section class="ui-panel game-drawer online-planets" data-drawer="planet" aria-label="Planets" hidden>
        <header class="ui-panel-title"><h2>Planets</h2><button type="button" data-close aria-label="Close planets">×</button></header>
      </section>
    </div>`;
}
export function bindOnlineShell(root) {
    const drawers = [...root.querySelectorAll('[data-drawer]')];
    const windows = drawers.map(drawer => {
        const name = drawer.dataset.drawer;
        drawer.id = `game-${name}`;
        drawer.hidden = false;
        drawer.classList.add('dock-user-hidden');
        const content = document.createElement('div');
        content.className = 'ui-panel-content';
        const header = drawer.querySelector('header');
        for (const child of [...drawer.childNodes])
            if (child !== header)
                content.appendChild(child);
        drawer.appendChild(content);
        drawer.querySelector('[data-close]').onclick = () => {
            window.dispatchEvent(new CustomEvent('galaxy:hide-panel', { detail: drawer.id }));
        };
        return { id: drawer.id, title: drawer.getAttribute('aria-label'), element: drawer,
            initiallyHidden: true, anchor: screenAnchor('right', 'top', 56, 12, 310, 540) };
    });
    return {
        windows,
        show(name) {
            window.dispatchEvent(new CustomEvent('galaxy:show-panel', { detail: `game-${name}` }));
        },
    };
}
//# sourceMappingURL=online-shell.js.map