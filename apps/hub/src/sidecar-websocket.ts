import { upgradeWebSocket, websocket } from "hono/bun";
import type { SidecarRouter, WsHandle } from "@intx/hub-sessions";
import { MAX_SIDECAR_FRAME_BYTES } from "@intx/types/sidecar";

// The native router owns authentication and protocol handling; this adapter
// retains handles only for shutdown.
export function createSidecarWebSocket(router: SidecarRouter) {
  const sockets = new Set<WsHandle>();
  const handler = upgradeWebSocket(() => {
    let handle: WsHandle;
    return {
      onOpen(_event, socket) {
        handle = {
          send: (data) => socket.send(data),
          close: () => socket.close(),
        };
        sockets.add(handle);
        router.handleOpen(handle);
      },
      onMessage(event) {
        if (typeof event.data === "string")
          router.handleMessage(handle, event.data);
      },
      onClose() {
        sockets.delete(handle);
        router.handleClose(handle);
      },
    };
  });
  return {
    handler,
    websocket: { ...websocket, maxPayloadLength: MAX_SIDECAR_FRAME_BYTES },
    close() {
      for (const socket of sockets) {
        router.handleClose(socket);
        socket.close();
      }
      sockets.clear();
    },
  };
}
