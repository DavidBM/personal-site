/**
 * Compact quaternion helpers for ship orientation (visual sim).
 *
 * Convention (right-handed, body frame):
 *   +Z = forward (matches heading 0 → world +Z)
 *   +Y = up
 *   +X = right
 *
 * Matches rotateLocalSlot: world right = (cos h, 0, −sin h), forward = (sin h, 0, cos h).
 * Yaw is about +Y; heading 0 faces +Z (atan2(forwardX, forwardZ)).
 *
 * Zero-alloc friendly: most ops write into an out tuple or mutate a 4-array.
 * No GPU / Bus imports.
 */
/** Identity quaternion (no rotation). */
export function quatIdentity() {
    return { x: 0, y: 0, z: 0, w: 1 };
}
/**
 * Yaw about +Y from heading (rad). Heading 0 faces +Z; positive yaw toward +X
 * (same as existing motion: forward = (sin h, 0, cos h)).
 */
export function quatFromYaw(yaw) {
    const half = yaw * 0.5;
    return {
        x: 0,
        y: Math.sin(half),
        z: 0,
        w: Math.cos(half),
    };
}
/** Write yaw quaternion into out (or return new). */
export function quatFromYawInto(yaw, out) {
    const half = yaw * 0.5;
    const y = Math.sin(half);
    const w = Math.cos(half);
    if (out) {
        out.x = 0;
        out.y = y;
        out.z = 0;
        out.w = w;
        return out;
    }
    return { x: 0, y, z: 0, w };
}
/**
 * Recover heading (yaw) from quaternion — consistent with quatFromYaw:
 * forward world = q * (0,0,1); heading = atan2(fwdX, fwdZ).
 */
export function yawFromQuat(qx, qy, qz, qw) {
    // Rotate local +Z by q: f = q * (0,0,1) * q^{-1}
    // For unit q: f.x = 2*(qx*qz + qw*qy), f.z = 1 - 2*(qx*qx + qy*qy)
    // (expanded from quatRotateVec3)
    const fx = 2 * (qx * qz + qw * qy);
    const fz = 1 - 2 * (qx * qx + qy * qy);
    return Math.atan2(fx, fz);
}
/** Squared length of quaternion. */
export function quatLenSq(qx, qy, qz, qw) {
    return qx * qx + qy * qy + qz * qz + qw * qw;
}
/** True if quaternion is missing / near-zero (uninitialized). */
export function quatIsZero(qx, qy, qz, qw, epsSq = 1e-12) {
    return quatLenSq(qx, qy, qz, qw) < epsSq;
}
/** Normalize in place (or into out). Degenerate → identity. */
export function quatNormalize(qx, qy, qz, qw, out) {
    const lenSq = quatLenSq(qx, qy, qz, qw);
    let x;
    let y;
    let z;
    let w;
    if (lenSq < 1e-20) {
        x = 0;
        y = 0;
        z = 0;
        w = 1;
    }
    else {
        const inv = 1 / Math.sqrt(lenSq);
        x = qx * inv;
        y = qy * inv;
        z = qz * inv;
        w = qw * inv;
    }
    if (out) {
        out.x = x;
        out.y = y;
        out.z = z;
        out.w = w;
        return out;
    }
    return { x, y, z, w };
}
/**
 * Hamilton product a⊗b (apply b first, then a — active rotation composition).
 * out may alias a or b only if careful; prefer distinct out.
 */
export function quatMul(ax, ay, az, aw, bx, by, bz, bw, out) {
    const x = aw * bx + ax * bw + ay * bz - az * by;
    const y = aw * by - ax * bz + ay * bw + az * bx;
    const z = aw * bz + ax * by - ay * bx + az * bw;
    const w = aw * bw - ax * bx - ay * by - az * bz;
    if (out) {
        out.x = x;
        out.y = y;
        out.z = z;
        out.w = w;
        return out;
    }
    return { x, y, z, w };
}
/**
 * Rotate local vector by unit quaternion → world.
 * v' = q * v * q^{-1}
 */
export function quatRotateVec3(qx, qy, qz, qw, vx, vy, vz, out) {
    // t = 2 * cross(q.xyz, v)
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    // v + qw * t + cross(q.xyz, t)
    const x = vx + qw * tx + (qy * tz - qz * ty);
    const y = vy + qw * ty + (qz * tx - qx * tz);
    const z = vz + qw * tz + (qx * ty - qy * tx);
    if (out) {
        out.x = x;
        out.y = y;
        out.z = z;
        return out;
    }
    return { x, y, z };
}
/** Axis-angle → quaternion. Axis need not be unit (normalized here). */
export function quatFromAxisAngle(ax, ay, az, angle, out) {
    const len = Math.hypot(ax, ay, az);
    if (len < 1e-12 || !Number.isFinite(angle)) {
        return quatIdentityInto(out);
    }
    const inv = 1 / len;
    const half = angle * 0.5;
    const s = Math.sin(half);
    const x = ax * inv * s;
    const y = ay * inv * s;
    const z = az * inv * s;
    const w = Math.cos(half);
    if (out) {
        out.x = x;
        out.y = y;
        out.z = z;
        out.w = w;
        return out;
    }
    return { x, y, z, w };
}
function quatIdentityInto(out) {
    if (out) {
        out.x = 0;
        out.y = 0;
        out.z = 0;
        out.w = 1;
        return out;
    }
    return quatIdentity();
}
/**
 * Spherical linear interpolation. t in [0,1]. Handles long-path flip.
 * Output is normalized.
 */
export function quatSlerp(ax, ay, az, aw, bx, by, bz, bw, t, out) {
    let bx2 = bx;
    let by2 = by;
    let bz2 = bz;
    let bw2 = bw;
    let cosOmega = ax * bx2 + ay * by2 + az * bz2 + aw * bw2;
    if (cosOmega < 0) {
        bx2 = -bx2;
        by2 = -by2;
        bz2 = -bz2;
        bw2 = -bw2;
        cosOmega = -cosOmega;
    }
    let t0;
    let t1;
    if (cosOmega > 0.9995) {
        // Near-linear
        t0 = 1 - t;
        t1 = t;
    }
    else {
        const omega = Math.acos(Math.min(1, cosOmega));
        const sinOmega = Math.sin(omega);
        t0 = Math.sin((1 - t) * omega) / sinOmega;
        t1 = Math.sin(t * omega) / sinOmega;
    }
    return quatNormalize(t0 * ax + t1 * bx2, t0 * ay + t1 * by2, t0 * az + t1 * bz2, t0 * aw + t1 * bw2, out);
}
/**
 * Rate-limited rotate current orientation toward target yaw (planar).
 * Equivalent turn budget: maxAngle = omegaMax * dt on shortest yaw delta.
 * Writes yaw-only result (pitch/roll cleared).
 */
export function quatRotateTowardYaw(qx, qy, qz, qw, targetYaw, maxAngle, out) {
    const cur = yawFromQuat(qx, qy, qz, qw);
    let d = Math.atan2(Math.sin(targetYaw - cur), Math.cos(targetYaw - cur));
    const maxA = maxAngle > 0 ? maxAngle : 0;
    if (d > maxA)
        d = maxA;
    else if (d < -maxA)
        d = -maxA;
    return quatFromYawInto(cur + d, out);
}
/**
 * Rate-limited slerp toward target quaternion by at most maxAngle (rad).
 */
export function quatRotateToward(cx, cy, cz, cw, tx, ty, tz, tw, maxAngle, out) {
    let txx = tx;
    let tyy = ty;
    let tzz = tz;
    let tww = tw;
    let cosOmega = cx * txx + cy * tyy + cz * tzz + cw * tww;
    if (cosOmega < 0) {
        txx = -txx;
        tyy = -tyy;
        tzz = -tzz;
        tww = -tww;
        cosOmega = -cosOmega;
    }
    const cosClamped = Math.min(1, Math.max(-1, cosOmega));
    const omega = Math.acos(cosClamped);
    if (omega < 1e-8 || maxAngle <= 0) {
        return quatNormalize(cx, cy, cz, cw, out);
    }
    const t = Math.min(1, maxAngle / omega);
    return quatSlerp(cx, cy, cz, cw, txx, tyy, tzz, tww, t, out);
}
/**
 * Look-rotation: body +Z → forward, body +Y → as close as possible to up.
 * Degenerate forward (zero) → identity. Parallel forward/up → pick orthogonal up.
 */
export function quatLookRotation(forwardX, forwardY, forwardZ, upX = 0, upY = 1, upZ = 0, out) {
    let fx = forwardX;
    let fy = forwardY;
    let fz = forwardZ;
    const fLen = Math.hypot(fx, fy, fz);
    if (fLen < 1e-12) {
        return quatIdentityInto(out);
    }
    const invF = 1 / fLen;
    fx *= invF;
    fy *= invF;
    fz *= invF;
    // right = normalize(cross(up, forward)) — wait: body X = right = cross(up, forward)?
    // Standard: right = normalize(cross(up, forward)) when forward is Z and up is Y
    // cross(up, f) = (uy*fz - uz*fy, uz*fx - ux*fz, ux*fy - uy*fx)
    let rx = upY * fz - upZ * fy;
    let ry = upZ * fx - upX * fz;
    let rz = upX * fy - upY * fx;
    let rLen = Math.hypot(rx, ry, rz);
    if (rLen < 1e-8) {
        // up ‖ forward — pick a fallback up
        const altX = Math.abs(fy) < 0.9 ? 0 : 1;
        const altY = Math.abs(fy) < 0.9 ? 1 : 0;
        const altZ = 0;
        rx = altY * fz - altZ * fy;
        ry = altZ * fx - altX * fz;
        rz = altX * fy - altY * fx;
        rLen = Math.hypot(rx, ry, rz);
        if (rLen < 1e-12) {
            return quatIdentityInto(out);
        }
    }
    const invR = 1 / rLen;
    rx *= invR;
    ry *= invR;
    rz *= invR;
    // trueUp = cross(forward, right)
    const ux = fy * rz - fz * ry;
    const uy = fz * rx - fx * rz;
    const uz = fx * ry - fy * rx;
    // Rotation matrix columns = right, up, forward (body axes in world)
    // Convert 3x3 to quaternion (Shepperd)
    const m00 = rx;
    const m01 = ux;
    const m02 = fx;
    const m10 = ry;
    const m11 = uy;
    const m12 = fy;
    const m20 = rz;
    const m21 = uz;
    const m22 = fz;
    const trace = m00 + m11 + m22;
    let x;
    let y;
    let z;
    let w;
    if (trace > 0) {
        const s = Math.sqrt(trace + 1) * 2;
        w = 0.25 * s;
        x = (m21 - m12) / s;
        y = (m02 - m20) / s;
        z = (m10 - m01) / s;
    }
    else if (m00 > m11 && m00 > m22) {
        const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
        w = (m21 - m12) / s;
        x = 0.25 * s;
        y = (m01 + m10) / s;
        z = (m02 + m20) / s;
    }
    else if (m11 > m22) {
        const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
        w = (m02 - m20) / s;
        x = (m01 + m10) / s;
        y = 0.25 * s;
        z = (m12 + m21) / s;
    }
    else {
        const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
        w = (m10 - m01) / s;
        x = (m02 + m20) / s;
        y = (m12 + m21) / s;
        z = 0.25 * s;
    }
    return quatNormalize(x, y, z, w, out);
}
/**
 * World forward from heading (planar): (sin h, 0, cos h).
 */
export function forwardFromHeading(heading, out) {
    const x = Math.sin(heading);
    const z = Math.cos(heading);
    if (out) {
        out.x = x;
        out.y = 0;
        out.z = z;
        return out;
    }
    return { x, y: 0, z };
}
/**
 * World forward from unit quaternion (body +Z).
 */
export function forwardFromQuat(qx, qy, qz, qw, out) {
    return quatRotateVec3(qx, qy, qz, qw, 0, 0, 1, out);
}
//# sourceMappingURL=quat.js.map