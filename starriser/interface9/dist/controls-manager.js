export class ControlsManager {
    static getInstance() {
        if (!ControlsManager.instance) {
            ControlsManager.instance = new ControlsManager();
        }
        return ControlsManager.instance;
    }
    constructor() {
        this.activeMode = "orbit"; // 'orbit', 'editor', 'ship', etc.
        this.orbitControls = null;
        this.editorActive = false;
        this.altKeyPressed = false;
        // Edit mode UI (set via event, not global)
        this._editModeActive = false;
        this._editClusterId = null;
        // Pointer position/memory
        this.pointerDownScreen = null; // {x, y}
        this.pointerLastScreen = null; // {x, y}
        this.pointerUpScreen = null; // {x, y}
        this.hasActivePointer = false;
        this._pointerDownTimestamp = null;
        // Key states
        this.ctrlKeyPressed = false;
        this.shiftKeyPressed = false;
        this.metaKeyPressed = false;
        // Add event listener for alt key
        window.addEventListener("keydown", (e) => {
            if (e.key === "Alt") {
                this.altKeyPressed = true;
            }
            if (e.key === "Control") {
                this.ctrlKeyPressed = true;
            }
            if (e.key === "Shift") {
                this.shiftKeyPressed = true;
            }
            if (e.key === "Meta") {
                this.metaKeyPressed = true;
            }
        });
        window.addEventListener("keyup", (e) => {
            if (e.key === "Alt") {
                this.altKeyPressed = false;
            }
            if (e.key === "Control") {
                this.ctrlKeyPressed = false;
            }
            if (e.key === "Shift") {
                this.shiftKeyPressed = false;
            }
            if (e.key === "Meta") {
                this.metaKeyPressed = false;
            }
        });
    }
    registerOrbitControls(controls) {
        this.orbitControls = controls;
    }
    setActiveMode(mode) {
        this.activeMode = mode;
        // Update orbit controls based on mode
        if (this.orbitControls) {
            // Only enable orbit controls when in orbit mode or when in editor mode with alt key
            this.updateOrbitControlsState();
        }
        console.log(`Active control mode set to: ${mode}`);
    }
    setEditorActive(active) {
        this.editorActive = active;
        this.updateOrbitControlsState();
    }
    updateOrbitControlsState() {
        if (!this.orbitControls)
            return;
        // Add this event listener to the document if not already
        if (!this._mouseOverHandler) {
            this._mouseOverHandler = (event) => {
                // Disable orbit controls if mouse is over UI
                if (this.isOverUI(event)) {
                    if (this.orbitControls && this.orbitControls.enabled) {
                        this._wasEnabled = true;
                        this.orbitControls.enabled = false;
                    }
                }
                else if (this._wasEnabled && this.orbitControls) {
                    // Re-enable based on mode
                    if (this.activeMode === "orbit") {
                        this.orbitControls.enabled = true;
                    }
                    else if (this.activeMode === "editor") {
                        this.orbitControls.enabled = this.altKeyPressed;
                    }
                    this._wasEnabled = false;
                }
            };
            document.addEventListener("mousemove", this._mouseOverHandler);
        }
        // Set the initial state
        if (this.activeMode === "orbit") {
            // Always enable in orbit mode
            this.orbitControls.enabled = true;
        }
        else if (this.activeMode === "editor") {
            // In editor mode, only enable when alt is pressed
            this.orbitControls.enabled = this.altKeyPressed;
        }
        else {
            // Disable in other modes (ship, ortho)
            this.orbitControls.enabled = false;
        }
    }
    onAltStateChanged() {
        if (this.activeMode === "editor") {
            this.updateOrbitControlsState();
        }
    }
    canOrbit() {
        return (this.activeMode === "orbit" ||
            (this.activeMode === "editor" && this.altKeyPressed));
    }
    canEditObjects() {
        return this.activeMode === "editor" && !this.altKeyPressed;
    }
    /**
     * Pointer-memory helpers for forwarding from app.js, e.g., on mouse/touch events.
     */
    pointerDown(screenX, screenY) {
        // Disable camera drag completely if edit overlay is active (evented paradigm, not global)
        if (this._editModeActive) {
            this.hasActivePointer = false;
            return;
        }
        this.pointerDownScreen = { x: screenX, y: screenY };
        this.pointerLastScreen = { x: screenX, y: screenY };
        this.hasActivePointer = true;
        this._pointerDownTimestamp = Date.now();
    }
    pointerMove(screenX, screenY) {
        if (this._editModeActive) {
            return;
        }
        this.pointerLastScreen = { x: screenX, y: screenY };
    }
    pointerUp(screenX, screenY) {
        if (this._editModeActive) {
            return;
        }
        this.pointerUpScreen = { x: screenX, y: screenY };
        this.hasActivePointer = false;
    }
    getPointerDownPosition() {
        return this.pointerDownScreen;
    }
    getPointerLastPosition() {
        return this.pointerLastScreen;
    }
    getPointerUpPosition() {
        return this.pointerUpScreen;
    }
    pointerMovedDistanceSq() {
        if (!this.pointerDownScreen || !this.pointerLastScreen)
            return 0;
        const dx = this.pointerLastScreen.x - this.pointerDownScreen.x;
        const dy = this.pointerLastScreen.y - this.pointerDownScreen.y;
        return dx * dx + dy * dy;
    }
    /**
     * Returns {altKey, ctrlKey, shiftKey, metaKey} (current state).
     */
    getCurrentKeyState() {
        return {
            altKey: this.altKeyPressed,
            ctrlKey: this.ctrlKeyPressed,
            shiftKey: this.shiftKeyPressed,
            metaKey: this.metaKeyPressed,
        };
    }
    isOverUI(event) {
        const target = event.target;
        if (!(target instanceof Element))
            return false;
        // Create a temporary element to test if we're over UI
        let element = target;
        // Traverse up the DOM tree
        while (element) {
            if (element.classList.contains("editor-buttons")) {
                return true;
            }
            element = element.parentElement;
        }
        return false;
    }
    /**
     * Evented API: set edit mode enabled/disabled explicitly.
     */
    setEditModeActive(active, clusterId = null) {
        this._editModeActive = !!active;
        this._editClusterId = active ? clusterId : null;
        // Optionally, disable camera controls, reset pointer memory, etc.
        if (this._editModeActive && this.orbitControls) {
            this.orbitControls.enabled = false;
        }
        else if (this.orbitControls) {
            this.updateOrbitControlsState();
        }
    }
}
ControlsManager.instance = null;
//# sourceMappingURL=controls-manager.js.map