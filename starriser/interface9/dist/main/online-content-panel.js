import { bindText, setText } from '../ui/dom-bindings.js';
import { createAtlasNavigation } from './online-atlas-navigation.js';
/** A bounded content consumer: one atlas page and one selected system. Static
 * atlas inspection is independent of the current fleet topology projection. */
export function createOnlineContentPanel(parent, selectCluster = () => { }) {
    const root = document.createElement('details');
    root.className = 'online-world-content';
    const heading = document.createElement('summary');
    heading.textContent = 'Galaxy atlas';
    const progress = document.createElement('p'), progressText = bindText(progress, { height: '32px', wrap: true });
    setText(progressText, 'Connect to load the galaxy atlas.');
    progress.setAttribute('role', 'status');
    const selection = document.createElement('p'), selectionText = bindText(selection, { height: '48px', wrap: true });
    setText(selectionText, 'Select a discovered system to inspect it.');
    root.append(heading, progress, selection);
    parent.append(root);
    let loadedClusters = 0;
    const navigation = createAtlasNavigation(root, selectCluster);
    function reset() {
        navigation.reset();
        loadedClusters = 0;
        setText(selectionText, 'Select a discovered system to inspect it.');
    }
    return {
        consumer: {
            reset,
            status(state, loaded, total) {
                if (state === 'unavailable')
                    setText(progressText, 'Galaxy atlas is unavailable on this connection.');
                else if (state === 'waiting')
                    setText(progressText, 'Waiting for your galaxy access…');
                else if (state === 'ready')
                    setText(progressText, 'Galaxy atlas loaded.');
                else
                    setText(progressText, total ? `Loading galaxy atlas: ${loaded} of ${total} sections.` : 'Loading galaxy atlas…');
            },
            atlas(clusters, index, total) {
                navigation.accept(clusters);
                loadedClusters += clusters.length;
                // Give input/layout a task before another verified page can update the DOM.
                return new Promise(resolve => setTimeout(resolve, 0));
            },
            system(value) {
                setText(selectionText, value
                    ? `${value.name}${value.isJumpGate ? ' · Jump gate' : ''} · Position ${value.position.map(n => n.toFixed(1)).join(', ')}`
                    : 'Select a discovered system to inspect it.');
            },
        },
        open() { root.open = true; return loadedClusters > 0; },
        dispose() { root.remove(); },
    };
}
//# sourceMappingURL=online-content-panel.js.map