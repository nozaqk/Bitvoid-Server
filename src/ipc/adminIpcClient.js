import net from "node:net";

/**
 * Local Administration IPC Client (Unix domain socket / Windows Named Pipe).
 * Sends a JSON-RPC 2.0 request frame and resolves the matching response frame.
 */
export function sendAdminIpcRequest({
  ipcPath,
  method,
  params = {},
  authToken = null,
  timeoutMs = 30000
}) {
  return new Promise((resolve, reject) => {
    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const socket = net.createConnection(ipcPath);
    let buffer = "";
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      finish(new Error(`IPC request "${method}" timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    socket.once("error", (err) => finish(err));

    socket.once("connect", () => {
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
        ...(authToken ? { authToken } : {})
      });
      socket.write(`${payload}\n`);
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const nl = buffer.indexOf("\n");
      if (nl === -1) return;
      const line = buffer.slice(0, nl).trim();
      try {
        const parsed = JSON.parse(line);
        if (parsed.error) {
          const err = new Error(parsed.error.message || "IPC error");
          err.code = parsed.error.errorCode || "ipc_error";
          err.rpcCode = parsed.error.code;
          finish(err);
        } else {
          finish(null, parsed.result);
        }
      } catch (err) {
        finish(err);
      }
    });
  });
}
