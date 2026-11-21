// net for the mod: ports in `listeners` accept connections, others refuse.
export const listeners = new Set();
export async function connect(host, port) {
  if (!listeners.has(`${host}:${port}`)) throw new Error("connection refused");
  return { write: async () => {}, read: async () => null, close() {} };
}
export default { connect };
