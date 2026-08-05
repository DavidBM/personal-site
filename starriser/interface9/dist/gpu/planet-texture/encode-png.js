/**
 * Re-export thruster PNG encoder with planet PixelBuffer shape.
 * Same pure stored-block PNG path (no npm deps).
 */
import { encodePngRgba as encodeThruster, isPngMagic, PNG_MAGIC_HEX, } from "../thruster-texture/encode-png.js";
export { isPngMagic, PNG_MAGIC_HEX };
export function encodePngRgba(buf) {
    return encodeThruster({
        width: buf.width,
        height: buf.height,
        rgba: buf.rgba,
    });
}
//# sourceMappingURL=encode-png.js.map