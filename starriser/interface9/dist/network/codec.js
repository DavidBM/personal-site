/** Network-only Protobuf boundary. Rendering and UI consume projections, never this codec. */
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { ClientMessageSchema, ServerMessageSchema, } from "./generated/galaxy/v1/galaxy_pb.js";
import { validateClientMessage } from "./validate-client.js";
import { validateServerMessage } from "./validate-server.js";
import { checkDecodeBudget } from "./decode-budget.js";
import { MAX_MESSAGE_BYTES, MAX_TOPOLOGY_BYTES } from './limits.js';
export { MAX_MESSAGE_BYTES } from './limits.js';
function bounded(bytes) {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_MESSAGE_BYTES) {
        throw new RangeError(`Protocol message length must be 1..${MAX_MESSAGE_BYTES}`);
    }
    return bytes;
}
export function encodeClientMessage(message) {
    validateClientMessage(message);
    const bytes = bounded(toBinary(ClientMessageSchema, message));
    if (message.body.case === 'subscribeStrategic' && bytes.byteLength > 8192)
        throw new RangeError('Strategic message exceeds 8 KiB');
    if (message.body.case === 'playbackClock' && bytes.byteLength + 4 > 1200)
        throw new RangeError('Playback request exceeds 1200 framed bytes');
    return bytes;
}
export function decodeServerMessage(bytes) {
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_TOPOLOGY_BYTES)
        throw new RangeError('Protocol server message length exceeded');
    checkDecodeBudget(ServerMessageSchema, bytes);
    const message = fromBinary(ServerMessageSchema, bytes);
    if (message.body.case !== 'topology')
        bounded(bytes);
    validateServerMessage(message);
    return message;
}
//# sourceMappingURL=codec.js.map