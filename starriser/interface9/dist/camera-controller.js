import * as THREE from "./vendor/three.js";
import { ControlsManager } from "./controls-manager.js";
export class CameraController {
    constructor(renderer) {
        this.renderer = renderer;
        this.camera = renderer.camera;
        this.scene = renderer.scene;
        this.currentMode = "map";
        this.domElement = renderer.renderer.domElement;
        // Parameters
        this.minZoom = 100; // Minimum camera height
        this.maxZoom = 1000000; // Maximum camera height
        this.zoomSpeed = 3; // Base zoom speed
        this.panSpeed = 1.0; // Pan speed
        this.dampingFactor = 0.12; // Animation smoothing factor (for non-drag movements)
        // Tilt angle parameters
        this.minTiltAngle = 0; // Top-down view when zoomed out
        this.maxTiltAngle = THREE.MathUtils.degToRad(30); // 30 degrees tilt when zoomed in
        // Animation state
        this.targetPosition = new THREE.Vector3();
        this.targetTiltFactor = 0;
        this.currentTiltFactor = 0;
        // Initialize camera and target
        this.target = new THREE.Vector3(0, 0, 0);
        this.camera.position.set(0, 2000, 0); // Start directly above target
        this.targetPosition.copy(this.camera.position);
        this.camera.lookAt(this.target);
        // Internal state
        this.isDragging = false;
        this.lastMousePosition = new THREE.Vector2();
        this.dragStartPoint = new THREE.Vector3();
        this.raycaster = new THREE.Raycaster();
        // Temporary camera used for tilt-compensation calculations
        this._tempCamera = null;
        // Track the last wheel event screen position to detect near-stationary pointer
        this.lastWheelScreenPos = new THREE.Vector2(NaN, NaN);
        // Ground plane (XZ in Three.js)
        this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        // Control manager reference
        this.controlsManager = ControlsManager.getInstance();
        // Add event listeners
        this.addEventListeners();
        // Set initial cursor
        this.domElement.style.cursor = "grab";
        // Apply initial tilt based on starting height
        this.targetTiltFactor = this.getTiltFactorForHeight(this.camera.position.y);
        this.currentTiltFactor = this.targetTiltFactor;
        this.updateCameraTilt();
    }
    addEventListeners() {
        // Mouse events are handled by app.js which calls the onMouse* methods
        // Only keep non-conflicting events
        this.domElement.addEventListener("wheel", this.onMouseWheel.bind(this), {
            passive: false,
        });
        this.domElement.addEventListener("dblclick", this.onDoubleClick.bind(this));
        window.addEventListener("resize", this.onWindowResize.bind(this));
    }
    setMode(mode) {
        if (mode === "map" || mode === "orbit") {
            this.currentMode = "map";
            this.controlsManager.setActiveMode("map");
        }
    }
    getTiltFactorForHeight(height) {
        // Calculate tilt factor (0 to 1) based on height
        // 0 = no tilt (zoomed out), 1 = maximum tilt (zoomed in)
        const heightRange = 150000; // Transition zone for tilt
        return 1 - Math.min(1, Math.max(0, (height - this.minZoom) / heightRange));
    }
    updateCameraTilt() {
        // Get tilt angle from tilt factor
        const tiltAngle = this.minTiltAngle +
            this.currentTiltFactor * (this.maxTiltAngle - this.minTiltAngle);
        // Calculate horizontal offset in the -Z direction (fixed axis)
        const horizontalOffset = Math.tan(tiltAngle) * this.camera.position.y;
        // Get ground point directly below camera
        const groundPoint = new THREE.Vector3(this.camera.position.x, 0, this.camera.position.z);
        // Set target position by offsetting the ground point in fixed -Z direction
        this.target
            .copy(groundPoint)
            .add(new THREE.Vector3(0, 0, -horizontalOffset));
        // Look at target
        this.camera.lookAt(this.target);
    }
    getGroundPointFromScreenPosition(x, y) {
        // Convert screen position to normalized device coordinates
        const mouse = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
        // Set up raycaster
        this.raycaster.setFromCamera(mouse, this.camera);
        // Find intersection with ground plane
        const groundPoint = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this.groundPlane, groundPoint)) {
            return groundPoint;
        }
        return null;
    }
    /**
     * Compute the ground-plane intersection for a screen point given a
     * hypothetical camera position and tilt factor. Used by the
     * tilt-compensated zoom to iteratively refine the camera position so
     * the original ground point stays under the cursor.
     */
    getGroundIntersectionForCandidate(screenX, screenY, camPos, tiltFactor) {
        // Lazily create a temporary camera that mirrors the main one
        const tempCam = this._tempCamera ??
            (this._tempCamera = new THREE.PerspectiveCamera(this.camera.fov, this.camera.aspect, this.camera.near, this.camera.far));
        // Configure temporary camera
        tempCam.position.copy(camPos);
        // Reproduce the tilt for this height/factor
        const tiltAngle = this.minTiltAngle + tiltFactor * (this.maxTiltAngle - this.minTiltAngle);
        const horizontalOffset = Math.tan(tiltAngle) * camPos.y;
        const groundPoint = new THREE.Vector3(camPos.x, 0, camPos.z);
        const tempTarget = groundPoint
            .clone()
            .add(new THREE.Vector3(0, 0, -horizontalOffset));
        tempCam.lookAt(tempTarget);
        tempCam.updateMatrixWorld();
        tempCam.updateProjectionMatrix();
        // Cast a ray for the requested screen point
        const mouse = new THREE.Vector2((screenX / window.innerWidth) * 2 - 1, -(screenY / window.innerHeight) * 2 + 1);
        this.raycaster.setFromCamera(mouse, tempCam);
        const hit = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
            return hit;
        }
        return null;
    }
    onMouseDown(event) {
        // Disable camera drag in edit mode.
        if (this.controlsManager && this.controlsManager._editModeActive) {
            this.isDragging = false;
            this.domElement.style.cursor = "grab";
            return;
        }
        if (event.button === 0) {
            // Left button
            this.isDragging = true;
            this.lastMousePosition.set(event.clientX, event.clientY);
            // Store the world point under the mouse at drag start
            const groundPoint = this.getGroundPointFromScreenPosition(event.clientX, event.clientY);
            if (groundPoint) {
                this.dragStartPoint.copy(groundPoint);
            }
            this.domElement.style.cursor = "grabbing";
            event.preventDefault();
        }
    }
    onMouseMove(event) {
        // Disable camera drag in edit mode.
        if (this.controlsManager && this.controlsManager._editModeActive) {
            return;
        }
        if (this.isDragging) {
            // Get current point under mouse
            const currentGroundPoint = this.getGroundPointFromScreenPosition(event.clientX, event.clientY);
            if (currentGroundPoint && this.dragStartPoint) {
                // Calculate movement needed to keep the starting point under the mouse
                const movement = new THREE.Vector3().subVectors(this.dragStartPoint, currentGroundPoint);
                // Move camera directly (no animation during drag)
                this.camera.position.add(movement);
                // Update target position to match the new camera position
                this.targetPosition.copy(this.camera.position);
                // Update camera tilt immediately
                this.updateCameraTilt();
            }
            // Update for next frame
            this.lastMousePosition.set(event.clientX, event.clientY);
            event.preventDefault();
        }
    }
    onMouseUp(event) {
        if (this.isDragging) {
            this.isDragging = false;
            this.domElement.style.cursor = "grab";
            event.preventDefault();
        }
    }
    onMouseWheel(event) {
        // Disable zoom in edit mode.
        if (this.controlsManager && this.controlsManager._editModeActive) {
            event.preventDefault();
            return;
        }
        event.preventDefault();
        // Determine whether zooming in or out
        const isZoomOut = event.deltaY > 0;
        // For zooming out, always use center of the screen as ground point
        let screenX, screenY;
        if (isZoomOut) {
            screenX = window.innerWidth / 2;
            screenY = window.innerHeight / 2;
        }
        else {
            screenX = event.clientX;
            screenY = event.clientY;
        }
        // Get position in normalized device coordinates
        const mouse = new THREE.Vector2((screenX / window.innerWidth) * 2 - 1, -(screenY / window.innerHeight) * 2 + 1);
        // --- Determine which camera pose to use for ground-intersection -------------
        let pointGround = null;
        const animating = !this.camera.position.equals(this.targetPosition) ||
            Math.abs(this.currentTiltFactor - this.targetTiltFactor) > 0.001;
        // If already animating, zooming *in*, and the mouse hasn't moved >5 px,
        // predict the ground point under the cursor *after* the current animation.
        if (!isZoomOut &&
            animating &&
            this.lastWheelScreenPos.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) < 10) {
            pointGround = this.getGroundIntersectionForCandidate(screenX, screenY, this.targetPosition, this.targetTiltFactor);
        }
        // Fallback to intersection with the current camera
        if (!pointGround) {
            this.raycaster.setFromCamera(mouse, this.camera);
            const hit = new THREE.Vector3();
            if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
                pointGround = hit;
            }
        }
        if (pointGround) {
            // Calculate zoom factor - slower when zoomed in, faster when zoomed out
            const zoomDelta = isZoomOut ? 1.1 : 1 / 1.1;
            const speedMultiplier = Math.min(2.5, 1 + this.camera.position.y / 5000);
            const zoomFactor = Math.pow(zoomDelta, this.zoomSpeed * speedMultiplier);
            // Calculate new height
            let newHeight = this.camera.position.y * zoomFactor;
            newHeight = Math.max(this.minZoom, Math.min(this.maxZoom, newHeight));
            // --- Tilt-compensated zoom ---------------------------------------
            // Initial candidate camera position: preserve current XZ offset
            const toCamera = new THREE.Vector2(this.camera.position.x - pointGround.x, this.camera.position.z - pointGround.z).multiplyScalar(zoomFactor);
            const candidatePos = new THREE.Vector3(pointGround.x + toCamera.x, newHeight, pointGround.z + toCamera.y);
            // Target tilt factor for this height
            const targetTiltFactor = this.getTiltFactorForHeight(newHeight);
            // Iteratively refine so that the cursor keeps pointing at
            // the same ground point even after the tilt is applied.
            for (let i = 0; i < 3; i++) {
                const hit = this.getGroundIntersectionForCandidate(screenX, screenY, candidatePos, targetTiltFactor);
                if (!hit)
                    break;
                const correction = new THREE.Vector3().subVectors(pointGround, hit);
                // Only adjust horizontally
                candidatePos.add(correction);
                if (correction.lengthSq() < 1e-6)
                    break;
            }
            // Commit refined position & tilt
            this.targetPosition.copy(candidatePos);
            this.targetTiltFactor = targetTiltFactor;
        }
        // Remember last wheel position for chaining zoom-in events
        this.lastWheelScreenPos.set(event.clientX, event.clientY);
    }
    onDoubleClick(event) {
        const groundPoint = this.getGroundPointFromScreenPosition(event.clientX, event.clientY);
        if (groundPoint) {
            const currentHeight = this.camera.position.y;
            // Toggle between zoomed in and out
            if (currentHeight < 500) {
                this.focusOnPoint(groundPoint, 2000);
            }
            else {
                this.focusOnPoint(groundPoint, 300);
            }
        }
    }
    focusOnPoint(point, height) {
        // Set target camera position directly above point at specified height
        this.targetPosition.set(point.x, height, point.z);
        // Update target tilt factor based on the new height
        this.targetTiltFactor = this.getTiltFactorForHeight(height);
    }
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
    update() {
        // Don't animate if dragging
        if (this.isDragging) {
            return false;
        }
        // Check if we need to update anything
        const positionNeedsUpdate = !this.camera.position.equals(this.targetPosition);
        const tiltNeedsUpdate = Math.abs(this.currentTiltFactor - this.targetTiltFactor) > 0.001;
        if (positionNeedsUpdate || tiltNeedsUpdate) {
            // Smoothly move camera towards target position
            if (positionNeedsUpdate) {
                this.camera.position.lerp(this.targetPosition, this.dampingFactor);
            }
            // Smoothly interpolate tilt factor
            if (tiltNeedsUpdate) {
                this.currentTiltFactor +=
                    (this.targetTiltFactor - this.currentTiltFactor) * this.dampingFactor;
            }
            // Update camera tilt
            this.updateCameraTilt();
            return true; // Camera was updated
        }
        return false; // No update needed
    }
    /**
     * Returns a ray {origin: {x,y,z}, direction: {x,y,z}} for pointer at (x, y) in screen coords.
     */
    getPointerRayFromScreenPosition(x, y) {
        // Convert screen position to normalized device coordinates
        const mouse = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
        this.raycaster.setFromCamera(mouse, this.camera);
        // Unpack raycaster.ray to plain objects for postMessage/bus use.
        const ray = this.raycaster.ray;
        return {
            origin: {
                x: ray.origin.x,
                y: ray.origin.y,
                z: ray.origin.z,
            },
            direction: {
                x: ray.direction.x,
                y: ray.direction.y,
                z: ray.direction.z,
            },
        };
    }
}
//# sourceMappingURL=camera-controller.js.map