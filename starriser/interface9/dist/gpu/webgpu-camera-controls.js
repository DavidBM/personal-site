/**
 * WebGPU map camera: pan + curved zoom/tilt (no Three).
 *
 * - Wheel extends log-height / eye / tilt *targets*; rAF damps toward them.
 * - Far: top-down; near: ≤30° pitch along fixed −Z (see camera-zoom.ts).
 * - Zoom-in: cursor pivot; zoom-out: screen center.
 * - Pan is 1:1 ground-locked (instant on current + target).
 *
 * Pan/zoom mouse events are driven by the App pointer router (onMouse*).
 * Wheel + optional dblclick are self-bound on the canvas; dispose() removes them.
 * Call {@link update} once per frame from map-view beforeFrame (dt-independent).
 */
import { groundPickFromScreen, } from "./math/ground-pick.js";
import { ControlsManager } from "../controls-manager.js";
import { CHAIN_CURSOR_PX, CTRL_LOOK_RETURN_MS, DS_FRAME_MAX, TAU_S, TAU_TILT, TAU_XZ, chaseCameraFromShip, clampLogHeight, clampZoomHeight, ctrlLookReturnFactor, lerpEyePose, dampTowardExp, eyeAfterHeightScale, heightToLog, isPoseSettled, logToHeight, lookAtFromEyeTilt, orbitEyeAroundLookAt, pivotScreenForWheel, refineEyeForScreenGround, tiltFactorForHeight, wheelDeltaLogS, MIN_ZOOM, FOLLOW_TRANSITION_MS, } from "./camera-zoom.js";
import { applyFollowDragLook, followTransitionT, lerpFollowCamEndpoints, mapRestPoseFromFollowExit, } from "./follow-cam-pose.js";
export class WebGpuCameraController {
    constructor(view) {
        this.isDragging = false;
        this.dragStartGround = null;
        this.controlsManager = ControlsManager.getInstance();
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
        this.view = view;
        this.onWheelBound = (e) => this.onMouseWheel(e);
        this.onDblClickBound = (e) => this.onDoubleClick(e);
        this.onKeyDownBound = (e) => this.onKeyDown(e);
        this.onKeyUpBound = (e) => this.onKeyUp(e);
        view.canvas.addEventListener("wheel", this.onWheelBound, { passive: false });
        view.canvas.addEventListener("dblclick", this.onDblClickBound);
        window.addEventListener("keydown", this.onKeyDownBound);
        window.addEventListener("keyup", this.onKeyUpBound);
        view.canvas.style.cursor = "grab";
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
        if (typeof window !== "undefined" && window.matchMedia) {
            const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
            this.reducedMotion = mq.matches;
            const onMq = () => {
                this.reducedMotion = mq.matches;
            };
            if (typeof mq.addEventListener === "function") {
                mq.addEventListener("change", onMq);
            }
            else if (typeof mq.addListener === "function") {
                mq.addListener(onMq);
            }
        }
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        this.view.canvas.removeEventListener("wheel", this.onWheelBound);
        this.view.canvas.removeEventListener("dblclick", this.onDblClickBound);
        window.removeEventListener("keydown", this.onKeyDownBound);
        window.removeEventListener("keyup", this.onKeyUpBound);
        this.isDragging = false;
        this.dragStartGround = null;
        this.followActive = false;
        this.followGetPose = null;
        this.followTransition = null;
        this.preFollowMap = null;
        this.preFollowTarget = null;
        this.invalidatePickCache();
    }
    /**
     * Follow a ship (F1 roof-cam). Pass null to stop.
     * getPose is polled every frame while active.
     * Enter/exit ease over {@link FOLLOW_TRANSITION_MS} (~500ms).
     */
    setFollowShip(getPose) {
        this.lookYaw = 0;
        this.lookPitch = 0;
        this.lookYawHeld = 0;
        this.lookPitchHeld = 0;
        this.ctrlOrbitTarget = null;
        if (getPose == null) {
            // Stop follow: ease back to a clamped map rest pose (not twisted chase boom).
            this.followGetPose = null;
            this.followActive = false;
            const st = this.view.getCameraState();
            const from = {
                eyeX: this.cur.eyeX,
                eyeY: this.cur.eyeY,
                eyeZ: this.cur.eyeZ,
                targetX: st.targetX,
                targetY: 0,
                targetZ: st.targetZ,
            };
            const preferredH = this.preFollowMap?.eyeY;
            const rest = mapRestPoseFromFollowExit(this.cur.eyeX, this.cur.eyeY, this.cur.eyeZ, this.preFollowTarget?.x ?? st.targetX, this.preFollowTarget?.z ?? st.targetZ, preferredH);
            const exitTo = {
                eyeX: rest.eyeX,
                eyeY: rest.eyeY,
                eyeZ: rest.eyeZ,
                targetX: rest.targetX,
                targetY: 0,
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
            return;
        }
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
            targetY: 0,
            targetZ: st.targetZ,
        };
        this.followTransition = {
            kind: "enter",
            t0Ms: performance.now(),
            durationMs: FOLLOW_TRANSITION_MS,
            from,
        };
        // Seed first frame mid-ease (t=0 stays at map; update advances).
        this.view.setCameraLookAt(from.eyeX, from.eyeY, from.eyeZ, from.targetX, from.targetZ, from.targetY);
        this.invalidatePickCache();
    }
    isFollowing() {
        return this.followActive;
    }
    /** True while enter/exit ease is running. */
    isFollowTransitioning() {
        return this.followTransition != null;
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
        if (!this.followActive) {
            this.preCtrlEye = { ...this.cur };
            this.preCtrlTgt = { ...this.tgt };
            const st = this.view.getCameraState();
            this.ctrlOrbitTarget = {
                x: st.targetX,
                y: 0,
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
        if (!this.followActive && this.preCtrlEye) {
            this.ctrlReturnFrom = { ...this.cur };
            this.tgt = { ...this.preCtrlEye };
        }
        this.ctrlOrbitTarget = null;
    }
    /** Rendered camera height (matches LOD + HUD). */
    getZoomLevel() {
        return this.cur.eyeY;
    }
    /** Retarget height only (keeps XZ); animates via update. */
    setZoomTarget(height) {
        const h = clampZoomHeight(height);
        this.tgt.eyeY = h;
        this.tgt.tilt = tiltFactorForHeight(h);
        if (this.reducedMotion) {
            this.cur.eyeY = h;
            this.cur.tilt = this.tgt.tilt;
            this.applyPose(this.cur);
        }
    }
    /** Dive / pull back to a ground point at height (damped). */
    focusOnPoint(x, z, height) {
        const h = clampZoomHeight(height);
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
        // CTRL free-look return over ~200ms.
        if (!this.ctrlDown) {
            const elapsed = performance.now() - this.ctrlReleaseAtMs;
            const f = ctrlLookReturnFactor(elapsed, CTRL_LOOK_RETURN_MS);
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
            // Map mode: lerp eye from free-look pose back to pre-CTRL snapshot.
            if (!this.followActive && this.preCtrlEye && this.ctrlReturnFrom) {
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
                this.view.setCameraLookAt(mid.eyeX, mid.eyeY, mid.eyeZ, mid.targetX, mid.targetZ, mid.targetY);
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
        // Ship follow (optional enter ease into chase).
        if (this.followActive && this.followGetPose) {
            const pose = this.followGetPose();
            if (pose) {
                const chase = chaseCameraFromShip(pose.posX, pose.posY, pose.posZ, pose.heading, {
                    lookYaw: this.lookYaw,
                    lookPitch: this.lookPitch,
                });
                let eyeX = chase.eyeX;
                let eyeY = chase.eyeY;
                let eyeZ = chase.eyeZ;
                let targetX = chase.targetX;
                let targetY = chase.targetY;
                let targetZ = chase.targetZ;
                if (this.followTransition?.kind === "enter") {
                    const tr = this.followTransition;
                    const t = followTransitionT(performance.now() - tr.t0Ms, tr.durationMs);
                    const mid = lerpFollowCamEndpoints(tr.from, {
                        eyeX: chase.eyeX,
                        eyeY: chase.eyeY,
                        eyeZ: chase.eyeZ,
                        targetX: chase.targetX,
                        targetY: chase.targetY,
                        targetZ: chase.targetZ,
                    }, t);
                    eyeX = mid.eyeX;
                    eyeY = mid.eyeY;
                    eyeZ = mid.eyeZ;
                    targetX = mid.targetX;
                    targetY = mid.targetY;
                    targetZ = mid.targetZ;
                    if (t >= 1)
                        this.followTransition = null;
                }
                this.cur.eyeX = eyeX;
                this.cur.eyeY = eyeY;
                this.cur.eyeZ = eyeZ;
                this.tgt = { ...this.cur };
                // Same-frame pose → eye/target; map view uses this for floating origin.
                this.view.setCameraLookAt(eyeX, eyeY, eyeZ, targetX, targetZ, targetY);
                this.invalidatePickCache();
                return true;
            }
        }
        if (this.isDragging || this.controlsManager.isEditModeActive()) {
            return false;
        }
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
            this.lastPickEyeX === state.eyeX &&
            this.lastPickEyeY === state.eyeY &&
            this.lastPickEyeZ === state.eyeZ &&
            this.lastPickTargetX === state.targetX &&
            this.lastPickTargetZ === state.targetZ &&
            this.lastPickViewportW === state.viewportW &&
            this.lastPickViewportH === state.viewportH) {
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
            targetZ: state.targetZ,
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
        if (this.controlsManager.isEditModeActive()) {
            this.isDragging = false;
            this.view.canvas.style.cursor = "grab";
            return;
        }
        if (event.button !== 0)
            return;
        this.isDragging = true;
        this.lastPointerX = event.clientX;
        this.lastPointerY = event.clientY;
        // Freeze residual zoom: target adopts display so pan is authoritative on XZ.
        this.tgt = { ...this.cur };
        // Follow drag orbits around the ship (no ground lock). Map pan needs ground.
        this.dragStartGround = this.followActive
            ? null
            : this.getGroundPointFromScreenPosition(event.clientX, event.clientY);
        this.view.canvas.style.cursor = "grabbing";
        event.preventDefault();
    }
    onMouseMove(event) {
        if (this.controlsManager.isEditModeActive())
            return;
        // CTRL free-look: orbit around look-at (map) or chase boom (follow).
        if (this.ctrlDown) {
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
                if (!this.followActive) {
                    // Orbit eye on a sphere about the fixed pivot captured at CTRL press.
                    // Do NOT applyPose (tilt −Z look) — that caused the slide effect.
                    const pivot = this.ctrlOrbitTarget ??
                        (() => {
                            const st = this.view.getCameraState();
                            return { x: st.targetX, y: 0, z: st.targetZ };
                        })();
                    const next = orbitEyeAroundLookAt(this.cur.eyeX, this.cur.eyeY, this.cur.eyeZ, pivot.x, pivot.y, pivot.z, -mdx * 0.005, -mdy * 0.004, { minEyeY: MIN_ZOOM });
                    this.cur.eyeX = next.eyeX;
                    this.cur.eyeY = next.eyeY;
                    this.cur.eyeZ = next.eyeZ;
                    this.tgt = { ...this.cur };
                    this.view.setCameraLookAt(next.eyeX, next.eyeY, next.eyeZ, pivot.x, pivot.z);
                    this.invalidatePickCache();
                }
                event.preventDefault();
                return;
            }
            return;
        }
        if (!this.isDragging) {
            this.lastPointerX = event.clientX;
            this.lastPointerY = event.clientY;
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
                this.lookYawHeld = this.lookYaw;
                this.lookPitchHeld = this.lookPitch;
            }
            event.preventDefault();
            return;
        }
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
        event.preventDefault();
    }
    onMouseUp(event) {
        if (!this.isDragging)
            return;
        this.isDragging = false;
        this.dragStartGround = null;
        this.view.canvas.style.cursor = "grab";
        event.preventDefault();
    }
    onMouseWheel(event) {
        if (this.controlsManager.isEditModeActive()) {
            event.preventDefault();
            return;
        }
        // Ignore wheel retarget while panning — pan owns XZ.
        if (this.isDragging) {
            event.preventDefault();
            return;
        }
        event.preventDefault();
        const state = this.view.getCameraState();
        let ds = wheelDeltaLogS(event.deltaY, event.deltaMode, this.tgt.eyeY, state.viewportH);
        if (ds === 0)
            return;
        // Per-frame budget so trackpad flings can't skip the galaxy.
        const cap = this.wheelBudgetS;
        if (ds > cap)
            ds = cap;
        if (ds < -cap)
            ds = -cap;
        this.wheelBudgetS -= Math.abs(ds);
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
            const sNew = clampLogHeight(heightToLog(this.tgt.eyeY) + ds);
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
        const sNew = clampLogHeight(heightToLog(this.tgt.eyeY) + ds);
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
        event.preventDefault();
    }
}
//# sourceMappingURL=webgpu-camera-controls.js.map