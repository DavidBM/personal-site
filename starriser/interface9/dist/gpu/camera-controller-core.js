import { touchCameraPose } from './touch-camera-pose.js';
import { groundPickFromScreen, } from "./math/ground-pick.js";
import { FOLLOW_ZOOM_MIN, FOLLOW_ZOOM_MAX, hullChaseCamera, FollowOrientation } from './ship-chase-camera.js';
import { CHAIN_CURSOR_PX, CTRL_LOOK_RETURN_MS, DS_FRAME_MAX, TAU_S, TAU_TILT, TAU_XZ, chaseCameraFromShip, chaseCameraSceneBoom, clampLogHeight, clampZoomHeight, ctrlLookReturnFactor, lerpEyePose, dampTowardExp, eyeAfterHeightScale, heightToLog, isPoseSettled, logToHeight, lookAtFromEyeTilt, tiltAngleRad, orbitEyeAroundLookAt, pivotScreenForWheel, refineEyeForScreenGround, tiltFactorForHeight, wheelDeltaLogS, MIN_ZOOM, SCENE_MIN_ZOOM, ORBIT_MAX_PITCH, ORBIT_WHEEL_DS_MUL, FOLLOW_TRANSITION_MS, } from "./camera-zoom.js";
import { applyFollowDragLook, followTransitionT, lerpFollowCamEndpoints, mapRestPoseFromFollowExit, } from "./follow-cam-pose.js";
import { composeCompactBodyWorld } from "./solar-system-lod.js";
import { createSystemOrbitPose, defaultSystemOrbitRadius, systemOrbitApplyDrag, systemOrbitApplyWheel, systemOrbitAnglesFromView, systemOrbitDampRadius, systemOrbitExitHeight, systemOrbitEye, systemOrbitMaxRadius, systemOrbitMinRadius, systemOrbitSetFocus, SYSTEM_ORBIT_SELECT_MS, } from "./system-orbit-pose.js";
import { SCENE_AGENT_SCALE, SCENE_SHIP_VISUAL_MUL, } from "./ship-motion-config.js";
export class WebGpuCameraController {
    constructor(view, environment) {
        this.isDragging = false;
        this.touchFree = false;
        this.dragStartGround = null;
        this.disposed = false;
        /** Display pose (damped). */
        this.cur = { eyeX: 0, eyeY: 2000, eyeZ: 0, tilt: 0 };
        /** Animation targets (wheel/focus extend these). */
        this.tgt = { eyeX: 0, eyeY: 2000, eyeZ: 0, tilt: 0 };
        this.lastWheelX = NaN;
        this.lastWheelY = NaN;
        /** Remaining |Δs| budget this frame (refilled in update). */
        this.wheelBudgetS = DS_FRAME_MAX;
        this.reducedMotion = false;
        /** Third-person follow: ship pose provider set by map/app. */
        this.followActive = false;
        this.followGetPose = null;
        this.followZoom = 1;
        this.followZoomTarget = 1;
        /**
         * Map pose snapshot when follow starts — restored (eased) on stop.
         * Height is always clampZoomHeight so exit never lands past min/max zoom.
         */
        this.preFollowMap = null;
        this.preFollowTarget = null;
        /** Enter/exit ease (~500ms). Null when settled in map or follow. */
        this.followTransition = null;
        /** CTRL free-look offsets (rad). Also used for follow drag orbit. */
        this.lookYaw = 0;
        this.lookPitch = 0;
        this.lookYawHeld = 0;
        this.lookPitchHeld = 0;
        this.ctrlDown = false;
        this.ctrlReleaseAtMs = 0;
        this.lastPointerX = 0;
        this.lastPointerY = 0;
        /** Map-mode CTRL free-look: eye pose at CTRL press (restored over 200ms). */
        this.preCtrlEye = null;
        this.preCtrlTgt = null;
        /** Eye at CTRL release — lerp from here toward preCtrlEye. */
        this.ctrlReturnFrom = null;
        /**
         * Fixed look-at pivot for map CTRL orbit (captured on press). Prevents the
         * “center behind camera / slide” bug from re-deriving look along −Z each frame.
         */
        this.ctrlOrbitTarget = null;
        /** Band B SCENE yaw/pitch/radius pose. Null when galaxy pan / follow owns eye. */
        this.orbit = null;
        /** Display orbit radius; `orbit.radius` is the wheel/select target. */
        this.orbitRadiusCur = 0;
        /** Selected body/fleet position, polled every frame so moving targets stay centered. */
        this.orbitTarget = null;
        this.orbitActive = false;
        this.orbitTransition = null;
        /** Reused Mat4s for pick — no alloc per pointer event. */
        this.pickScratch = {
            proj: new Float32Array(16),
            view: new Float32Array(16),
            viewProj: new Float32Array(16),
            invViewProj: new Float32Array(16),
        };
        /**
         * Last pick for (screenX, screenY) under the same camera state.
         * getGroundPoint + getPointerRay in one publish only invert once.
         */
        this.lastPickX = NaN;
        this.lastPickY = NaN;
        this.lastPickEyeX = NaN;
        this.lastPickEyeY = NaN;
        this.lastPickEyeZ = NaN;
        this.lastPickTargetX = NaN;
        this.lastPickTargetZ = NaN;
        this.lastPickViewportW = NaN;
        this.lastPickViewportH = NaN;
        this.lastPick = null;
        this.followPending = false;
        this.followOrientation = new FollowOrientation();
        this.view = view;
        this.environment = environment;
        this.controlsManager = this.environment.controls;
        this.reducedMotion = this.environment.reducedMotion ?? false;
        this.unbind = this.environment.bind?.({
            wheel: (e) => this.onMouseWheel(e),
            doubleClick: (e) => this.onDoubleClick(e),
            keyDown: (e) => this.onKeyDown(e),
            keyUp: (e) => this.onKeyUp(e),
            reducedMotion: (value) => { this.reducedMotion = value; },
        });
        this.environment.setCursor?.("grab");
        // Sync internal state from map view initial pose + apply tilt look-at.
        const st = view.getCameraState();
        const tilt = tiltFactorForHeight(st.eyeY);
        this.cur = {
            eyeX: st.eyeX,
            eyeY: st.eyeY,
            eyeZ: st.eyeZ,
            tilt,
        };
        this.tgt = { ...this.cur };
        this.applyPose(this.cur);
    }
    /** Worker input has no DOM methods, globals, or synthetic event objects. */
    handleInput(input) {
        switch (input.type) {
            case 'touchGesture':
                this.applyTouchGesture(input);
                break;
            case 'resetOrientation':
                this.resetOrientation();
                break;
            case "down":
                this.onMouseDown({ button: input.button, clientX: input.x, clientY: input.y });
                break;
            case "move":
                this.onMouseMove({ button: input.button, clientX: input.x, clientY: input.y });
                break;
            case "up":
                this.onMouseUp({ button: input.button, clientX: input.x, clientY: input.y });
                break;
            case "doubleClick":
                this.onDoubleClick({ button: input.button, clientX: input.x, clientY: input.y });
                break;
            case "wheel":
                this.onMouseWheel({ clientX: input.x, clientY: input.y, deltaY: input.deltaY, deltaMode: input.deltaMode });
                break;
            case "keyDown":
                this.onKeyDown(input);
                break;
            case "keyUp":
                this.onKeyUp(input);
                break;
            case "reducedMotion":
                this.reducedMotion = input.value;
                break;
        }
    }
    applyTouchGesture(input) {
        const pose = touchCameraPose(this.view.getCameraState(), input);
        this.releaseFollow('touch-navigation');
        this.followActive = false;
        this.followGetPose = null;
        this.followTransition = null;
        this.disarmOrbit();
        this.touchFree = true;
        this.view.setCameraLookAt(pose.eyeX, pose.eyeY, pose.eyeZ, pose.targetX, pose.targetZ, pose.targetY);
        this.adoptViewCamera();
    }
    resetOrientation() {
        const st = this.view.getCameraState();
        const height = this.clampHeight(Math.max(st.eyeY - st.targetY, Math.hypot(st.eyeX - st.targetX, st.eyeY - st.targetY, st.eyeZ - st.targetZ) * 0.7));
        this.releaseFollow('reset-orientation');
        this.followActive = false;
        this.followGetPose = null;
        this.followTransition = null;
        this.disarmOrbit();
        this.touchFree = false;
        const tilt = tiltFactorForHeight(height);
        this.cur = { eyeX: st.targetX, eyeY: height, eyeZ: st.targetZ + Math.tan(tiltAngleRad(tilt)) * height, tilt };
        this.tgt = { ...this.cur };
        this.applyPose(this.cur);
    }
    dispose() {
        if (this.disposed)
            return;
        this.releaseFollow('camera-disposed');
        this.disposed = true;
        this.unbind?.();
        this.isDragging = false;
        this.dragStartGround = null;
        this.followActive = false;
        this.followGetPose = null;
        this.followTransition = null;
        this.preFollowMap = null;
        this.preFollowTarget = null;
        this.orbit = null;
        this.orbitRadiusCur = 0;
        this.orbitTarget = null;
        this.orbitActive = false;
        this.orbitTransition = null;
        this.invalidatePickCache();
    }
    /**
     * Follow a ship (F1 roof-cam). Pass null to stop.
     * getPose is polled every frame while active.
     * Enter/exit ease over {@link FOLLOW_TRANSITION_MS} (~500ms).
     */
    setFollowShip(getPose, reason = 'follow-command') {
        this.lookYaw = 0;
        this.lookPitch = 0;
        this.lookYawHeld = 0;
        this.lookPitchHeld = 0;
        this.ctrlOrbitTarget = null;
        this.followZoom = this.followZoomTarget = 1;
        if (getPose == null) {
            this.stopFollowing(reason);
            return;
        }
        this.touchFree = false;
        // Enter follow: snapshot map pose, ease into chase.
        this.preFollowMap = { ...this.cur };
        const st = this.view.getCameraState();
        this.preFollowTarget = { x: st.targetX, z: st.targetZ };
        this.followGetPose = getPose;
        this.followActive = true;
        const from = {
            eyeX: this.cur.eyeX,
            eyeY: this.cur.eyeY,
            eyeZ: this.cur.eyeZ,
            targetX: st.targetX,
            targetY: st.targetY,
            targetZ: st.targetZ,
            upX: st.upX, upY: st.upY, upZ: st.upZ,
        };
        this.followTransition = {
            kind: "enter",
            t0Ms: performance.now(),
            durationMs: FOLLOW_TRANSITION_MS,
            from,
        };
        // Seed first frame mid-ease (t=0 stays at map; update advances).
        this.view.setCameraLookAt(from.eyeX, from.eyeY, from.eyeZ, from.targetX, from.targetZ, from.targetY, from.upX, from.upY, from.upZ);
        this.invalidatePickCache();
    }
    releaseFollow(reason) {
        if (this.followActive) {
            this.view.noteFollowEvent?.(`camera:stop:${reason}`);
            this.view.setFollowShipIndex(null, reason);
        }
        this.followGetPose = null;
        this.followActive = false;
        this.followPending = false;
    }
    stopFollowing(reason = 'system-orbit-free') {
        this.releaseFollow(reason);
        // A hull may be banked or below the system plane. Release both camera
        // owners into an upright scene view before ground-locked panning resumes.
        if (this.view.getSystemSceneIds().size > 0) {
            this.followTransition = null;
            this.preFollowMap = null;
            this.preFollowTarget = null;
            this.beginSceneFreeTransition();
            this.invalidatePickCache();
            return;
        }
        // Stop follow: ease back to a clamped map rest pose (not twisted chase boom).
        const st = this.view.getCameraState();
        const from = {
            eyeX: this.cur.eyeX,
            eyeY: this.cur.eyeY,
            eyeZ: this.cur.eyeZ,
            targetX: st.targetX,
            targetY: st.targetY,
            targetZ: st.targetZ,
            upX: st.upX, upY: st.upY, upZ: st.upZ,
        };
        const preferredH = this.preFollowMap?.eyeY;
        const rest = mapRestPoseFromFollowExit(this.cur.eyeX, this.cur.eyeY, this.cur.eyeZ, this.preFollowTarget?.x ?? st.targetX, this.preFollowTarget?.z ?? st.targetZ, preferredH);
        const exitTo = {
            eyeX: rest.eyeX,
            eyeY: rest.eyeY,
            eyeZ: rest.eyeZ,
            targetX: rest.targetX,
            targetY: st.targetY,
            targetZ: rest.targetZ,
            tilt: rest.tilt,
        };
        this.followTransition = {
            kind: "exit",
            t0Ms: performance.now(),
            durationMs: FOLLOW_TRANSITION_MS,
            from,
            exitTo,
        };
        this.preFollowMap = null;
        this.preFollowTarget = null;
        this.tgt = {
            eyeX: rest.eyeX,
            eyeY: rest.eyeY,
            eyeZ: rest.eyeZ,
            tilt: rest.tilt,
        };
    }
    isFollowing() {
        return this.followActive;
    }
    /** True while enter/exit ease is running. */
    isFollowTransitioning() {
        return this.followTransition != null;
    }
    /** System-orbit pose mode (SCENE). Follow still wins the camera when both. */
    isOrbiting() {
        return this.orbitActive && !this.followActive;
    }
    /**
     * Galaxy topology / 5px fade while Kepler SCENE orbit eases.
     * map (no orbit, no transition) → 1; enter t∈[0,1] → 1−t; orbit → 0; exit t → t.
     */
    getGalaxyFade() {
        const tr = this.orbitTransition;
        if (tr) {
            const t = followTransitionT(performance.now() - tr.t0Ms, tr.durationMs);
            if (tr.kind === "enter")
                return 1 - t;
            if (tr.kind === "exit")
                return t;
            if (tr.kind === "free")
                return 0;
        }
        return this.orbitActive || this.peekSceneId() != null ? 0 : 1;
    }
    getOrbitPose() {
        return this.orbit ? { ...this.orbit } : null;
    }
    /**
     * Tests / Band C: copy the view's live eye into cur/tgt without applyPose
     * (tilt −Z look would undo a scripted setCameraLookAt).
     */
    adoptViewCamera() {
        const st = this.view.getCameraState();
        this.cur = {
            eyeX: st.eyeX,
            eyeY: st.eyeY,
            eyeZ: st.eyeZ,
            tilt: tiltFactorForHeight(st.eyeY),
        };
        this.tgt = { ...this.cur };
        this.invalidatePickCache();
    }
    /**
     * Band C lock: orbit this compact body at `radius` (boom). The moving body
     * is polled every frame; acquisition keeps the live view angle and eases.
     */
    setSystemOrbitFocus(opts) {
        const near = this.view.getCameraState().near;
        this.setSystemOrbitTarget({
            targetId: opts.bodyIndex,
            getPosition: () => composeCompactBodyWorld(this.view.solarBodies, opts.bodyIndex, this.view.getSceneTimeSec()),
            radius: opts.radius,
            minRadius: opts.minRadius ?? systemOrbitMinRadius(this.view.solarBodies.radius[opts.bodyIndex] ?? 0, near),
        });
    }
    /** Select any body/ship/fleet position provider using the current view angle. */
    setSystemOrbitTarget(target) {
        this.touchFree = false;
        const position = target.getPosition();
        if (!position)
            return;
        const st = this.view.getCameraState();
        const fallback = this.orbit ?? createSystemOrbitPose();
        const angles = systemOrbitAnglesFromView(st.eyeX, st.eyeY, st.eyeZ, st.targetX, st.targetY, st.targetZ, fallback.yaw, fallback.pitch);
        const minR = target.minRadius ?? systemOrbitMinRadius(0, st.near);
        const maxR = target.maxRadius ?? systemOrbitMaxRadius(st.bufferH, st.fovyDeg);
        const radius = Math.max(minR, Math.min(maxR, target.radius));
        this.orbit = systemOrbitSetFocus(createSystemOrbitPose({ ...fallback, ...angles }), position.x, position.y, position.z, target.targetId, radius);
        this.orbitTarget = target;
        this.orbitRadiusCur = radius;
        this.orbitActive = true;
        this.clearCtrlLookRestore();
        this.orbitTransition = {
            kind: "enter",
            t0Ms: performance.now(),
            durationMs: this.reducedMotion ? 0 : SYSTEM_ORBIT_SELECT_MS,
            from: {
                eyeX: st.eyeX, eyeY: st.eyeY, eyeZ: st.eyeZ,
                targetX: st.targetX, targetY: st.targetY, targetZ: st.targetZ,
                upX: st.upX, upY: st.upY, upZ: st.upZ,
            },
        };
        if (this.reducedMotion)
            this.applyOrbitLookAt(systemOrbitEye(this.orbit));
    }
    /** Release selection while keeping the compact system resident and pannable. */
    setSystemOrbitFree() {
        if (this.peekSceneId() == null)
            return;
        if (this.followActive) {
            this.stopFollowing();
            return;
        }
        if (!this.orbitActive || this.orbitTransition?.kind === "free")
            return;
        this.beginSceneFreeTransition();
    }
    beginSceneFreeTransition() {
        const st = this.view.getCameraState();
        const h = Math.max(defaultSystemOrbitRadius(), st.near * 3);
        const tilt = tiltFactorForHeight(h);
        const eyeZ = st.targetZ + Math.tan(tiltAngleRad(tilt)) * h;
        this.orbitTarget = null;
        this.orbit = null;
        this.orbitRadiusCur = 0;
        this.orbitActive = true;
        this.clearCtrlLookRestore();
        this.orbitTransition = {
            kind: "free",
            t0Ms: performance.now(),
            durationMs: this.reducedMotion ? 0 : SYSTEM_ORBIT_SELECT_MS,
            from: {
                eyeX: st.eyeX, eyeY: st.eyeY, eyeZ: st.eyeZ,
                targetX: st.targetX, targetY: st.targetY, targetZ: st.targetZ,
                upX: st.upX, upY: st.upY, upZ: st.upZ,
            },
            exitTo: {
                eyeX: st.targetX, eyeY: h, eyeZ,
                targetX: st.targetX, targetY: 0, targetZ: st.targetZ,
                tilt,
            },
        };
    }
    /** Explicitly selected sun: ease into its compact orbit. */
    setSystemOrbitSun() {
        if (this.view.getSystemSceneIds().size === 0)
            return;
        const store = this.view.solarBodies;
        const radius = this.orbit?.radius ?? defaultSystemOrbitRadius();
        this.setSystemOrbitFocus({ bodyIndex: 0, x: store.systemX, y: 0, z: store.systemZ, radius });
    }
    /**
     * Chase free-look / follow-drag orbit angles (rad).
     * Used by tests to prove {@link onMouseMove} follow-drag path mutates look.
     */
    getFollowLookAngles() {
        return { lookYaw: this.lookYaw, lookPitch: this.lookPitch };
    }
    onKeyDown(e) {
        if (e.key !== "Control" && e.code !== "ControlLeft" && e.code !== "ControlRight") {
            return;
        }
        if (this.ctrlDown)
            return;
        this.ctrlDown = true;
        this.lookYawHeld = this.lookYaw;
        this.lookPitchHeld = this.lookPitch;
        // Map free-look mutates eye — snapshot rest pose to ease back on release.
        // Orbit yaw/pitch is permanent at the live radius; do not snapshot a restore.
        if (!this.followActive && !this.orbitActive) {
            this.preCtrlEye = { ...this.cur };
            this.preCtrlTgt = { ...this.tgt };
            const st = this.view.getCameraState();
            this.ctrlOrbitTarget = {
                x: st.targetX,
                y: st.targetY,
                z: st.targetZ,
            };
        }
    }
    onKeyUp(e) {
        if (e.key !== "Control" && e.code !== "ControlLeft" && e.code !== "ControlRight") {
            return;
        }
        if (!this.ctrlDown)
            return;
        this.ctrlDown = false;
        this.ctrlReleaseAtMs = performance.now();
        this.lookYawHeld = this.lookYaw;
        this.lookPitchHeld = this.lookPitch;
        // Begin easing map eye back toward pre-CTRL snapshot.
        if (!this.followActive && !this.orbitActive && this.preCtrlEye) {
            this.ctrlReturnFrom = { ...this.cur };
            this.tgt = { ...this.preCtrlEye };
        }
        this.ctrlOrbitTarget = null;
    }
    /** Rendered camera height (matches LOD + HUD). */
    getZoomLevel() {
        return this.cur.eyeY;
    }
    /** Jewel free-cam may go below galaxy {@link MIN_ZOOM} to reach model LOD. */
    zoomFloor() {
        return this.view.solarBodies.systemId != null ? SCENE_MIN_ZOOM : MIN_ZOOM;
    }
    clampHeight(height) {
        return clampZoomHeight(height, this.zoomFloor());
    }
    clampLog(s) {
        return clampLogHeight(s, this.zoomFloor());
    }
    /** Retarget height only (keeps XZ); animates via update. */
    setZoomTarget(height) {
        if (this.orbitActive)
            this.disarmOrbit();
        const h = this.clampHeight(height);
        this.tgt.eyeY = h;
        this.tgt.tilt = tiltFactorForHeight(h);
        if (this.reducedMotion) {
            this.cur.eyeY = h;
            this.cur.tilt = this.tgt.tilt;
            this.applyPose(this.cur);
        }
    }
    /**
     * Director author: slam display + target to an eased sample so rAF `update`
     * does not fight the fly. Disarms orbit; does not start follow.
     */
    applyDirectorPose(opts) {
        this.touchFree = false;
        // Director owns the eye even during F1 — leftover follow made every
        // sample a no-op (hatch shot stuck at origin/2000). Clear via isFollowing
        // so onMouseMove keeps the only followActive brace-block (mdx-before-write).
        if (this.isFollowing()) {
            this.releaseFollow('camera-director');
        }
        // An exit transition is still camera work after followActive becomes false.
        // It must not restore an earlier pose after the director finishes.
        this.followTransition = null;
        this.preFollowMap = null;
        this.preFollowTarget = null;
        this.clearCtrlLookRestore();
        this.disarmOrbit();
        const h = this.clampHeight(opts.eyeY);
        const tilt = tiltFactorForHeight(h);
        this.cur = { eyeX: opts.eyeX, eyeY: h, eyeZ: opts.eyeZ, tilt };
        this.tgt = { ...this.cur };
        this.view.setCameraLookAt(opts.eyeX, h, opts.eyeZ, opts.targetX, opts.targetZ, opts.targetY ?? 0);
        this.invalidatePickCache();
    }
    /** Current damped-target height (free-cam pan keeps this). */
    targetHeight() {
        return this.tgt.eyeY;
    }
    /** Dive / pull back to a ground point at height (damped). */
    focusOnPoint(x, z, height) {
        this.touchFree = false;
        if (this.orbitActive)
            this.disarmOrbit();
        const h = this.clampHeight(height);
        this.tgt.eyeX = x;
        this.tgt.eyeY = h;
        this.tgt.eyeZ = z;
        this.tgt.tilt = tiltFactorForHeight(h);
        if (this.reducedMotion) {
            this.cur = { ...this.tgt };
            this.applyPose(this.cur);
        }
    }
    /**
     * Advance damped pose toward targets. Call once per rAF before look-at/LOD.
     * @returns true if the rendered pose changed.
     */
    update(dtMs) {
        if (this.disposed)
            return false;
        this.wheelBudgetS = DS_FRAME_MAX;
        if (this.touchFree)
            return false;
        if (this.updateControlReturn())
            return true;
        if (this.updateFollowExit())
            return true;
        if (this.updateFollowPose(dtMs))
            return true;
        // Follow wins; system orbit may take control only outside edit mode.
        if (!this.controlsManager.isEditModeActive()) {
            this.pollSystemOrbit();
            if (this.orbitActive)
                return this.applyOrbitFrame(dtMs);
        }
        if (this.isDragging || this.controlsManager.isEditModeActive())
            return false;
        return this.updateMapPose(dtMs);
    }
    updateHeldLook(f) {
        if (this.lookYawHeld !== 0 || this.lookPitchHeld !== 0) {
            this.lookYaw = this.lookYawHeld * f;
            this.lookPitch = this.lookPitchHeld * f;
            if (f <= 0) {
                this.lookYaw = 0;
                this.lookPitch = 0;
                this.lookYawHeld = 0;
                this.lookPitchHeld = 0;
            }
        }
    }
    updateControlReturn() {
        // CTRL free-look return over ~200ms.
        if (!this.ctrlDown) {
            const elapsed = performance.now() - this.ctrlReleaseAtMs;
            const f = ctrlLookReturnFactor(elapsed, CTRL_LOOK_RETURN_MS);
            this.updateHeldLook(f);
            // Map mode: lerp eye from free-look pose back to pre-CTRL snapshot.
            if (!this.followActive &&
                !this.orbitActive &&
                this.preCtrlEye &&
                this.ctrlReturnFrom) {
                const t = 1 - f; // 0 at release → 1 at rest
                this.cur = lerpEyePose(this.ctrlReturnFrom, this.preCtrlEye, t);
                this.tgt = { ...this.cur };
                this.applyPose(this.cur);
                if (f <= 0) {
                    this.cur = { ...this.preCtrlEye };
                    this.tgt = { ...(this.preCtrlTgt ?? this.preCtrlEye) };
                    this.applyPose(this.cur);
                    this.preCtrlEye = null;
                    this.preCtrlTgt = null;
                    this.ctrlReturnFrom = null;
                }
                return true;
            }
        }
        return false;
    }
    updateFollowExit() {
        // Exit-follow ease (map rest) — runs after followActive is already false.
        if (this.followTransition?.kind === "exit") {
            const tr = this.followTransition;
            const exitTo = tr.exitTo;
            if (!exitTo) {
                this.followTransition = null;
            }
            else {
                const t = followTransitionT(performance.now() - tr.t0Ms, tr.durationMs);
                const mid = lerpFollowCamEndpoints(tr.from, exitTo, t);
                this.cur.eyeX = mid.eyeX;
                this.cur.eyeY = mid.eyeY;
                this.cur.eyeZ = mid.eyeZ;
                this.cur.tilt = exitTo.tilt;
                this.tgt = { ...this.cur };
                this.view.setCameraLookAt(mid.eyeX, mid.eyeY, mid.eyeZ, mid.targetX, mid.targetZ, mid.targetY, mid.upX, mid.upY, mid.upZ);
                this.invalidatePickCache();
                if (t >= 1) {
                    this.followTransition = null;
                    this.tgt = {
                        eyeX: exitTo.eyeX,
                        eyeY: exitTo.eyeY,
                        eyeZ: exitTo.eyeZ,
                        tilt: exitTo.tilt,
                    };
                    this.cur = { ...this.tgt };
                    this.applyPose(this.cur);
                }
                return true;
            }
        }
        return false;
    }
    updateFollowPose(dtMs) {
        if (!this.followActive || !this.followGetPose)
            return false;
        const pose = this.followGetPose();
        if (!pose) {
            this.stopFollowing('ship-retired-or-unavailable');
            return true;
        }
        if (Boolean(pose.pending) !== this.followPending) {
            this.followPending = Boolean(pose.pending);
            this.view.noteFollowEvent?.(pose.pending ? 'pose:waiting' : 'pose:ready');
        }
        if (pose.pending) {
            if (this.followTransition)
                this.followTransition.t0Ms = performance.now();
            return true;
        }
        this.followZoom = dampTowardExp(this.followZoom, this.followZoomTarget, dtMs / 1000, TAU_S);
        this.applyOrbitLookAt(this.easeFollowEntry(this.followCameraPose(pose)));
        return true;
    }
    setFollowRotation(on) {
        this.followOrientation.set(on, this.followGetPose?.()?.attitude);
        this.view.setFollowRotation(on);
    }
    followCameraPose(pose) {
        if (pose.attitude && pose.hullRadius)
            return hullChaseCamera({ ...pose, attitude: this.followOrientation.at(pose.attitude) }, this.followZoom, this.lookYaw, this.lookPitch);
        const jewel = this.view.isFollowedFleetInSystemScene() || this.view.solarBodies.systemId != null;
        const boom = jewel ? chaseCameraSceneBoom(SCENE_AGENT_SCALE * SCENE_SHIP_VISUAL_MUL) : undefined;
        return chaseCameraFromShip(pose.posX, pose.posY, pose.posZ, pose.heading, { lookYaw: this.lookYaw, lookPitch: this.lookPitch, ...boom });
    }
    easeFollowEntry(chase) {
        if (this.followTransition?.kind !== "enter")
            return chase;
        const tr = this.followTransition;
        const t = followTransitionT(performance.now() - tr.t0Ms, tr.durationMs);
        const mid = lerpFollowCamEndpoints(tr.from, chase, t);
        if (t >= 1)
            this.followTransition = null;
        return mid;
    }
    updateMapPose(dtMs) {
        if (isPoseSettled(this.cur, this.tgt)) {
            if (this.cur.eyeX !== this.tgt.eyeX ||
                this.cur.eyeY !== this.tgt.eyeY ||
                this.cur.eyeZ !== this.tgt.eyeZ ||
                this.cur.tilt !== this.tgt.tilt) {
                this.cur = { ...this.tgt };
                this.applyPose(this.cur);
                return true;
            }
            return false;
        }
        const dtSec = Math.max(0, dtMs) / 1000;
        if (this.reducedMotion) {
            this.cur = { ...this.tgt };
            this.applyPose(this.cur);
            return true;
        }
        // Damp height in log space so settle is even across altitudes.
        const s0 = heightToLog(this.cur.eyeY);
        const s1 = heightToLog(this.tgt.eyeY);
        const s = dampTowardExp(s0, s1, dtSec, TAU_S);
        this.cur.eyeY = logToHeight(s);
        this.cur.eyeX = dampTowardExp(this.cur.eyeX, this.tgt.eyeX, dtSec, TAU_XZ);
        this.cur.eyeZ = dampTowardExp(this.cur.eyeZ, this.tgt.eyeZ, dtSec, TAU_XZ);
        this.cur.tilt = dampTowardExp(this.cur.tilt, this.tgt.tilt, dtSec, TAU_TILT);
        if (isPoseSettled(this.cur, this.tgt)) {
            this.cur = { ...this.tgt };
        }
        this.applyPose(this.cur);
        return true;
    }
    peekSceneId() {
        const ids = this.view.getSystemSceneIds();
        for (const id of ids)
            return id;
        return null;
    }
    recomposeOrbitFocus() {
        if (!this.orbit)
            return;
        if (this.orbitTarget) {
            const position = this.orbitTarget.getPosition();
            if (!position) {
                this.setSystemOrbitFree();
                return;
            }
            this.orbit.focusX = position.x;
            this.orbit.focusY = position.y;
            this.orbit.focusZ = position.z;
            return;
        }
        const store = this.view.solarBodies;
        const world = composeCompactBodyWorld(store, this.orbit.focusIndex, this.view.getSceneTimeSec());
        if (!world)
            return;
        this.orbit.focusX = world.x;
        this.orbit.focusY = world.y;
        this.orbit.focusZ = world.z;
    }
    applyOrbitLookAt(p) {
        this.cur.eyeX = p.eyeX;
        this.cur.eyeY = p.eyeY;
        this.cur.eyeZ = p.eyeZ;
        this.tgt = { ...this.cur };
        this.view.setCameraLookAt(p.eyeX, p.eyeY, p.eyeZ, p.targetX, p.targetZ, p.targetY, p.upX, p.upY, p.upZ);
        this.invalidatePickCache();
    }
    applyOrbitFrame(dtMs) {
        // Free/exit transitions do not need a selected orbit. The scene can retire
        // while a banked chase is still easing back to normal controls.
        if (this.orbitTransition?.exitTo)
            return this.applyOrbitTransition(this.orbitTransition, dtMs);
        if (!this.orbitActive || !this.orbit)
            return false;
        this.recomposeOrbitFocus();
        if (!this.orbitActive || !this.orbit)
            return false;
        const tr = this.orbitTransition;
        if (tr)
            return this.applyOrbitTransition(tr, dtMs);
        return this.applyOrbitSettled(dtMs);
    }
    applyOrbitTransition(tr, dtMs) {
        const t = followTransitionT(performance.now() - tr.t0Ms, tr.durationMs);
        if (tr.kind === "exit" && tr.exitTo) {
            return this.applyOrbitExitTransition(tr.exitTo, tr.from, t);
        }
        if (tr.kind === "free" && tr.exitTo) {
            return this.applyOrbitFreeTransition(tr, t);
        }
        if (!this.orbit)
            return false;
        const dest = systemOrbitEye(this.orbit);
        if (tr.kind === "enter") {
            const mid = lerpFollowCamEndpoints(tr.from, dest, t);
            this.applyOrbitLookAt(mid);
            if (t >= 1) {
                this.orbitTransition = null;
                this.orbitRadiusCur = this.orbit.radius;
            }
            return true;
        }
        return this.applyOrbitSettled(dtMs);
    }
    applyOrbitExitTransition(exitTo, from, t) {
        const mid = lerpFollowCamEndpoints(from, exitTo, t);
        this.view.setCameraLookAt(mid.eyeX, mid.eyeY, mid.eyeZ, mid.targetX, mid.targetZ, mid.targetY, mid.upX, mid.upY, mid.upZ);
        this.cur.eyeX = mid.eyeX;
        this.cur.eyeY = mid.eyeY;
        this.cur.eyeZ = mid.eyeZ;
        this.tgt = { ...this.cur };
        this.invalidatePickCache();
        if (t < 1)
            return true;
        this.orbitTransition = null;
        this.orbitActive = false;
        this.orbit = null;
        this.orbitRadiusCur = 0;
        this.cur = {
            eyeX: exitTo.eyeX,
            eyeY: exitTo.eyeY,
            eyeZ: exitTo.eyeZ,
            tilt: exitTo.tilt,
        };
        this.tgt = { ...this.cur };
        this.applyPose(this.cur);
        this.view.dismissCompactScene();
        return true;
    }
    applyOrbitSettled(dtMs) {
        if (!this.orbit)
            return false;
        const { minR, maxR } = this.orbitMinMax();
        const target = Math.max(minR, Math.min(maxR, this.orbit.radius));
        this.orbit.radius = target;
        let radius = this.orbitRadiusCur > 1e-9 ? this.orbitRadiusCur : target;
        const holdR = this.ctrlDown || this.isDragging;
        if (!holdR) {
            radius = this.reducedMotion
                ? target
                : systemOrbitDampRadius(radius, target, Math.max(0, dtMs) / 1000, minR, maxR);
        }
        this.orbitRadiusCur = radius;
        this.applyOrbitLookAt(systemOrbitEye({ ...this.orbit, radius }));
        return true;
    }
    liveOrbitRadiusFromView() {
        const o = this.orbit;
        if (!o)
            return defaultSystemOrbitRadius();
        const st = this.view.getCameraState();
        const r = Math.hypot(st.eyeX - o.focusX, st.eyeY - o.focusY, st.eyeZ - o.focusZ);
        return r > 1e-9 ? r : o.radius;
    }
    /** User yaw/zoom owns the radius; cancel enter/free eases that would lerp from far. */
    takeOverOrbitEase() {
        const tr = this.orbitTransition;
        if (!tr || tr.kind === "exit")
            return;
        const live = this.liveOrbitRadiusFromView();
        this.orbitTransition = null;
        this.orbitRadiusCur = live;
        if (this.orbit)
            this.orbit.radius = live;
    }
    applyOrbitDrag(dxPx, dyPx) {
        if (!this.orbit)
            return;
        this.takeOverOrbitEase();
        this.orbit = systemOrbitApplyDrag(this.orbit, dxPx, dyPx);
        this.recomposeOrbitFocus();
        if (!this.orbit)
            return;
        const radius = this.orbitRadiusCur > 1e-9 ? this.orbitRadiusCur : this.orbit.radius;
        this.applyOrbitLookAt(systemOrbitEye({ ...this.orbit, radius }));
    }
    clearCtrlLookRestore() {
        this.preCtrlEye = null;
        this.preCtrlTgt = null;
        this.ctrlReturnFrom = null;
        this.ctrlOrbitTarget = null;
    }
    applyOrbitFreeTransition(transition, t) {
        const mid = lerpFollowCamEndpoints(transition.from, transition.exitTo, t);
        this.view.setCameraLookAt(mid.eyeX, mid.eyeY, mid.eyeZ, mid.targetX, mid.targetZ, mid.targetY, mid.upX, mid.upY, mid.upZ);
        this.cur = { eyeX: mid.eyeX, eyeY: mid.eyeY, eyeZ: mid.eyeZ, tilt: transition.exitTo.tilt };
        this.tgt = { ...this.cur };
        this.invalidatePickCache();
        if (t < 1)
            return true;
        this.orbitTransition = null;
        this.orbitActive = false;
        this.orbit = null;
        this.orbitRadiusCur = 0;
        this.cur = {
            eyeX: transition.exitTo.eyeX,
            eyeY: transition.exitTo.eyeY,
            eyeZ: transition.exitTo.eyeZ,
            tilt: transition.exitTo.tilt,
        };
        this.tgt = { ...this.cur };
        this.applyPose(this.cur);
        return true;
    }
    beginOrbitExit() {
        if (!this.orbitActive)
            return;
        const st = this.view.getCameraState();
        const store = this.view.solarBodies;
        const sysX = store.systemX;
        const sysZ = store.systemZ;
        const h = systemOrbitExitHeight(st.bufferH, st.fovyDeg);
        const tilt = tiltFactorForHeight(h);
        const look = lookAtFromEyeTilt(sysX, h, sysZ, tilt);
        this.clearCtrlLookRestore();
        this.orbitTransition = {
            kind: "exit",
            t0Ms: performance.now(),
            durationMs: FOLLOW_TRANSITION_MS,
            from: {
                eyeX: st.eyeX,
                eyeY: st.eyeY,
                eyeZ: st.eyeZ,
                targetX: st.targetX,
                targetY: st.targetY,
                targetZ: st.targetZ,
                upX: st.upX, upY: st.upY, upZ: st.upZ,
            },
            exitTo: {
                eyeX: sysX,
                eyeY: h,
                eyeZ: sysZ,
                targetX: look.x,
                targetY: 0,
                targetZ: look.z,
                tilt,
            },
        };
    }
    /** Snap off orbit (dblclick / focusOnPoint). Do not auto-reenter until SCENE empties. */
    disarmOrbit() {
        this.orbitActive = false;
        this.orbitTransition = null;
        this.orbit = null;
        this.orbitRadiusCur = 0;
        this.orbitTarget = null;
        this.clearCtrlLookRestore();
    }
    orbitMinMax() {
        const st = this.view.getCameraState();
        const store = this.view.solarBodies;
        const idx = this.orbit?.focusIndex ?? 0;
        const bodyR = idx >= 0 && store.currentCount > idx ? store.radius[idx] : 0;
        return {
            minR: this.orbitTarget?.minRadius ?? systemOrbitMinRadius(bodyR, st.near),
            maxR: this.orbitTarget?.maxRadius ?? systemOrbitMaxRadius(st.bufferH, st.fovyDeg),
        };
    }
    pollSystemOrbit() {
        const sceneId = this.peekSceneId();
        if (sceneId == null) {
            if (this.orbitActive && this.orbitTransition?.kind !== "exit") {
                this.beginOrbitExit();
            }
            return;
        }
    }
    applyPose(p) {
        const look = lookAtFromEyeTilt(p.eyeX, p.eyeY, p.eyeZ, p.tilt);
        this.view.setCameraLookAt(p.eyeX, p.eyeY, p.eyeZ, look.x, look.z);
        this.invalidatePickCache();
    }
    invalidatePickCache() {
        this.lastPickX = NaN;
        this.lastPickY = NaN;
        this.lastPick = null;
    }
    /**
     * Single ground pick (scratch + optional same-frame cache).
     * Returns null if singular view·proj or ray misses y=0.
     */
    pickAt(screenX, screenY) {
        const state = this.view.getCameraState();
        if (this.lastPick != null &&
            this.lastPickX === screenX &&
            this.lastPickY === screenY &&
            this.isPickPoseCurrent(state)) {
            return this.lastPick;
        }
        const hit = groundPickFromScreen({
            screenX,
            screenY,
            viewportW: state.viewportW,
            viewportH: state.viewportH,
            eyeX: state.eyeX,
            eyeY: state.eyeY,
            eyeZ: state.eyeZ,
            targetX: state.targetX,
            targetY: state.targetY,
            targetZ: state.targetZ,
            upX: state.upX, upY: state.upY, upZ: state.upZ,
            fovyDeg: state.fovyDeg,
            near: state.near,
            far: state.far,
        }, this.pickScratch);
        this.lastPickX = screenX;
        this.lastPickY = screenY;
        this.lastPickEyeX = state.eyeX;
        this.lastPickEyeY = state.eyeY;
        this.lastPickEyeZ = state.eyeZ;
        this.lastPickTargetX = state.targetX;
        this.lastPickTargetZ = state.targetZ;
        this.lastPickViewportW = state.viewportW;
        this.lastPickViewportH = state.viewportH;
        this.lastPick = hit;
        return hit;
    }
    isPickPoseCurrent(state) {
        return this.lastPickEyeX === state.eyeX &&
            this.lastPickEyeY === state.eyeY &&
            this.lastPickEyeZ === state.eyeZ &&
            this.lastPickTargetX === state.targetX &&
            this.lastPickTargetZ === state.targetZ &&
            this.lastPickViewportW === state.viewportW &&
            this.lastPickViewportH === state.viewportH;
    }
    /** Ground hit for a hypothetical eye + tilt (not the live camera). */
    pickAtPose(screenX, screenY, eyeX, eyeY, eyeZ, tilt) {
        const look = lookAtFromEyeTilt(eyeX, eyeY, eyeZ, tilt);
        const state = this.view.getCameraState();
        return groundPickFromScreen({
            screenX,
            screenY,
            viewportW: state.viewportW,
            viewportH: state.viewportH,
            eyeX,
            eyeY,
            eyeZ,
            targetX: look.x,
            targetZ: look.z,
            fovyDeg: state.fovyDeg,
            near: state.near,
            far: state.far,
        }, this.pickScratch);
    }
    getGroundPointFromScreenPosition(x, y) {
        const hit = this.pickAt(x, y);
        return hit?.ground ?? null;
    }
    getPointerRayFromScreenPosition(x, y) {
        const hit = this.pickAt(x, y);
        if (hit)
            return hit.ray;
        // Fallback: downward ray from eye (rare: singular matrix / parallel plane).
        const state = this.view.getCameraState();
        return {
            origin: { x: state.eyeX, y: state.eyeY, z: state.eyeZ },
            direction: { x: 0, y: -1, z: 0 },
        };
    }
    onMouseDown(event) {
        if (this.touchFree) {
            this.touchFree = false;
            this.applyPose(this.cur);
        }
        if (this.controlsManager.isEditModeActive()) {
            this.isDragging = false;
            this.environment.setCursor?.("grab");
            return;
        }
        if (event.button !== 0)
            return;
        this.isDragging = true;
        this.lastPointerX = event.clientX;
        this.lastPointerY = event.clientY;
        // Seed from the live view. Band C tick / lock writes look-at on the view
        // without updating cur — freezing stale cur here then applyPose on the
        // first move slams the galaxy between two poses.
        const st = this.view.getCameraState();
        this.cur.eyeX = st.eyeX;
        this.cur.eyeY = st.eyeY;
        this.cur.eyeZ = st.eyeZ;
        // Freeze residual zoom: target adopts display so pan is authoritative on XZ.
        this.tgt = { ...this.cur };
        // Follow / system-orbit: LMB yaws around the body (no ground lock). Do not
        // steal RMB — this handler already returned unless button === 0.
        this.dragStartGround =
            this.followActive || this.orbitActive
                ? null
                : this.getGroundPointFromScreenPosition(event.clientX, event.clientY);
        this.environment.setCursor?.("grabbing");
        event.preventDefault?.();
    }
    onMouseMove(event) {
        if (this.controlsManager.isEditModeActive())
            return;
        if (this.ctrlDown) {
            this.moveControlLook(event);
            return;
        }
        if (!this.isDragging) {
            this.lastPointerX = event.clientX;
            this.lastPointerY = event.clientY;
            return;
        }
        if (this.isSystemOrbitControl()) {
            this.moveSystemOrbit(event);
            return;
        }
        // Follow drag: orbit camera around the ship (lookYaw/lookPitch), not map pan.
        // Delta MUST be computed before updating lastPointer (same order as CTRL free-look).
        if (this.followActive) {
            const mdx = event.clientX - this.lastPointerX;
            const mdy = event.clientY - this.lastPointerY;
            this.lastPointerX = event.clientX;
            this.lastPointerY = event.clientY;
            if (mdx !== 0 || mdy !== 0) {
                const next = applyFollowDragLook(this.lookYaw, this.lookPitch, mdx, mdy);
                this.lookYaw = next.lookYaw;
                this.lookPitch = next.lookPitch;
                // Ordinary drag is a persistent orbit. Only CTRL free-look owns the
                // held angles that updateControlReturn eases back on release.
                this.lookYawHeld = 0;
                this.lookPitchHeld = 0;
            }
            event.preventDefault?.();
            return;
        }
        this.panMap(event);
    }
    isSystemOrbitControl() {
        return this.orbitActive && this.orbit != null && !this.followActive;
    }
    moveControlLook(event) {
        const mdx = event.clientX - this.lastPointerX;
        const mdy = event.clientY - this.lastPointerY;
        this.lastPointerX = event.clientX;
        this.lastPointerY = event.clientY;
        if (mdx !== 0 || mdy !== 0) {
            this.lookYaw -= mdx * 0.005;
            this.lookPitch -= mdy * 0.004;
            this.lookPitch = Math.max(-0.85, Math.min(0.85, this.lookPitch));
            this.lookYawHeld = this.lookYaw;
            this.lookPitchHeld = this.lookPitch;
            if (this.isSystemOrbitControl()) {
                this.applyOrbitDrag(mdx, mdy);
                event.preventDefault?.();
                return;
            }
            if (!this.followActive) {
                // Orbit eye on a sphere about the fixed pivot captured at CTRL press.
                // Do NOT applyPose (tilt −Z look) — that caused the slide effect.
                const pivot = this.ctrlOrbitTarget ??
                    (() => {
                        const st = this.view.getCameraState();
                        return { x: st.targetX, y: st.targetY, z: st.targetZ };
                    })();
                // Full sphere about the look-at — eye may go under the ground plane.
                // Jewel CTRL matches planet grab: drag moves the world with the cursor.
                // Map free-look keeps the older pitch sign (drag down lowers the eye).
                const jewel = this.view.solarBodies.systemId != null;
                const next = orbitEyeAroundLookAt(this.cur.eyeX, this.cur.eyeY, this.cur.eyeZ, pivot.x, pivot.y, pivot.z, -mdx * 0.005, (jewel ? mdy : -mdy) * 0.004, { maxPitch: ORBIT_MAX_PITCH });
                this.cur.eyeX = next.eyeX;
                this.cur.eyeY = next.eyeY;
                this.cur.eyeZ = next.eyeZ;
                this.tgt = { ...this.cur };
                this.view.setCameraLookAt(next.eyeX, next.eyeY, next.eyeZ, pivot.x, pivot.z, pivot.y);
                this.invalidatePickCache();
            }
            event.preventDefault?.();
            return;
        }
    }
    moveSystemOrbit(event) {
        const mdx = event.clientX - this.lastPointerX;
        const mdy = event.clientY - this.lastPointerY;
        this.lastPointerX = event.clientX;
        this.lastPointerY = event.clientY;
        if (mdx !== 0 || mdy !== 0) {
            this.applyOrbitDrag(mdx, mdy);
        }
        event.preventDefault?.();
    }
    panMap(event) {
        this.lastPointerX = event.clientX;
        this.lastPointerY = event.clientY;
        if (!this.dragStartGround)
            return;
        // One pick for pan (cursor-under-finger); then shift eye (tilt re-derived).
        const hit = this.pickAt(event.clientX, event.clientY);
        if (!hit)
            return;
        const current = hit.ground;
        const dx = this.dragStartGround.x - current.x;
        const dz = this.dragStartGround.z - current.z;
        if (dx === 0 && dz === 0)
            return;
        this.cur.eyeX += dx;
        this.cur.eyeZ += dz;
        this.tgt.eyeX += dx;
        this.tgt.eyeZ += dz;
        this.applyPose(this.cur);
        event.preventDefault?.();
    }
    onMouseUp(event) {
        if (!this.isDragging)
            return;
        this.isDragging = false;
        this.dragStartGround = null;
        this.environment.setCursor?.("grab");
        event.preventDefault?.();
    }
    onMouseWheel(event) {
        if (this.touchFree) {
            this.touchFree = false;
            this.applyPose(this.cur);
        }
        event.preventDefault?.();
        if (this.controlsManager.isEditModeActive() || this.isDragging)
            return;
        if (this.followActive) {
            const ds = this.takeWheelDelta(event, 1) * 0.35;
            this.followZoomTarget = Math.max(FOLLOW_ZOOM_MIN, Math.min(FOLLOW_ZOOM_MAX, this.followZoomTarget * Math.exp(ds)));
            return;
        }
        if (this.isSystemOrbitControl()) {
            this.zoomSystemOrbit(event);
            return;
        }
        this.zoomMap(event);
    }
    takeWheelDelta(event, height) {
        const state = this.view.getCameraState();
        const delta = wheelDeltaLogS(event.deltaY, event.deltaMode, height, state.viewportH);
        const capped = Math.max(-this.wheelBudgetS, Math.min(this.wheelBudgetS, delta));
        this.wheelBudgetS -= Math.abs(capped);
        return capped;
    }
    zoomSystemOrbit(event) {
        const ds = this.takeWheelDelta(event, this.orbit.radius) * ORBIT_WHEEL_DS_MUL;
        if (ds === 0)
            return;
        if (this.orbitTransition?.kind === "exit")
            return;
        this.takeOverOrbitEase();
        const { minR, maxR } = this.orbitMinMax();
        const next = systemOrbitApplyWheel(this.orbit, ds, minR, maxR);
        this.orbit = next.pose;
        if (next.pastMax) {
            this.beginOrbitExit();
            return;
        }
        if (this.reducedMotion) {
            this.orbitRadiusCur = this.orbit.radius;
            this.recomposeOrbitFocus();
            this.applyOrbitLookAt(systemOrbitEye(this.orbit));
        }
    }
    zoomMap(event) {
        const state = this.view.getCameraState();
        const ds = this.takeWheelDelta(event, this.tgt.eyeY);
        if (ds === 0)
            return;
        const isZoomOut = ds > 0;
        const pivot = pivotScreenForWheel(isZoomOut, event.clientX, event.clientY, state.viewportW, state.viewportH);
        const animating = !isPoseSettled(this.cur, this.tgt);
        const cursorStable = Number.isFinite(this.lastWheelX) &&
            Math.hypot(event.clientX - this.lastWheelX, event.clientY - this.lastWheelY) <
                CHAIN_CURSOR_PX;
        // Chain zoom-in against target pose so more scroll digs deeper under same point.
        const useTarget = !isZoomOut && animating && cursorStable;
        const pickPose = useTarget ? this.tgt : this.cur;
        let groundHit = this.pickAtPose(pivot.x, pivot.y, pickPose.eyeX, pickPose.eyeY, pickPose.eyeZ, pickPose.tilt);
        if (!groundHit) {
            // Fallback: live camera at pivot, then pure vertical height.
            groundHit = this.pickAt(pivot.x, pivot.y);
        }
        if (!groundHit) {
            // Last resort: height-only retarget.
            const sNew = this.clampLog(heightToLog(this.tgt.eyeY) + ds);
            this.tgt.eyeY = logToHeight(sNew);
            this.tgt.tilt = tiltFactorForHeight(this.tgt.eyeY);
            this.lastWheelX = event.clientX;
            this.lastWheelY = event.clientY;
            if (this.reducedMotion) {
                this.cur = { ...this.tgt };
                this.applyPose(this.cur);
            }
            return;
        }
        const G = groundHit.ground;
        const sNew = this.clampLog(heightToLog(this.tgt.eyeY) + ds);
        const hNew = logToHeight(sNew);
        const tNew = tiltFactorForHeight(hNew);
        let eye = eyeAfterHeightScale(this.tgt.eyeX, this.tgt.eyeY, this.tgt.eyeZ, G.x, G.z, hNew);
        const hitAt = (sx, sy, ex, ey, ez, tilt) => {
            const hit = this.pickAtPose(sx, sy, ex, ey, ez, tilt);
            return hit ? { x: hit.ground.x, z: hit.ground.z } : null;
        };
        eye = refineEyeForScreenGround(pivot.x, pivot.y, G.x, G.z, eye.x, eye.y, eye.z, tNew, hitAt, 3);
        this.tgt.eyeX = eye.x;
        this.tgt.eyeY = eye.y;
        this.tgt.eyeZ = eye.z;
        this.tgt.tilt = tNew;
        this.lastWheelX = event.clientX;
        this.lastWheelY = event.clientY;
        if (this.reducedMotion) {
            this.cur = { ...this.tgt };
            this.applyPose(this.cur);
        }
    }
    onDoubleClick(event) {
        if (this.controlsManager.isEditModeActive())
            return;
        if (this.isDragging)
            return;
        const ground = this.getGroundPointFromScreenPosition(event.clientX, event.clientY);
        if (!ground)
            return;
        // Toggle dive / pull-back over the ground under the cursor.
        const h = this.cur.eyeY;
        if (h < 600) {
            this.focusOnPoint(ground.x, ground.z, 2500);
        }
        else {
            this.focusOnPoint(ground.x, ground.z, 350);
        }
        event.preventDefault?.();
    }
}
//# sourceMappingURL=camera-controller-core.js.map