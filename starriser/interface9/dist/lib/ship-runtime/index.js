export { DIRECTOR_PACKET_MAGIC, DIRECTOR_PACKET_VERSION, DIRECTOR_PACKET_HEADER_BYTES, DIRECTOR_PACKET_COMMAND_BYTES, DIRECTOR_PACKET_MAX_BYTES, DIRECTOR_LANE_NONE, DIRECTOR_AUTHORITY, DIRECTOR_STRATEGIES, encodeDirectorPacket, encodeLocalShowAttack, decodeDirectorPacket, directorPacketFingerprint, } from "./packet.js";
export { SHIP_BYTES as SHIP_RUNTIME_STRIDE } from "./ship-layout.mjs";
import { SHIP_BYTES } from "./ship-layout.mjs";
export const FOLLOW_POSE_BYTES = SHIP_BYTES * 2;
export const NAMED_EXTRAS = Object.freeze(["clock-rebase", "pack", "spawn-grow", "reclaim-compact", "regroup", "recover"]);
//# sourceMappingURL=index.js.map