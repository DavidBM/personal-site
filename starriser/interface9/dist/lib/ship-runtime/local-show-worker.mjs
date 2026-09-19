import { encodeLocalShowAttack } from "./packet.js";

self.onmessage = ({ data }) => {
  try {
    const packet = encodeLocalShowAttack(data);
    self.postMessage({ id: data.id, packet }, [packet]);
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error?.message ?? error) });
  }
};
