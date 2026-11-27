/**
 * When the room reads itself again. The stream says when the room moved; these reads cover what it
 * cannot say: a slow fallback, a run parking on an approval, the commit that trails a closed run,
 * and a coordinator still to bind. `useRoomReload` owns the reader and hands out one `reload` that
 * keeps its identity for the room's life, so every other part of the room can take it and name it
 * in its effects.
 */
import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { loadProjectRoom } from "../pane/load-room.ts";
import { createRoomReloader } from "./room-reload.ts";

// The stream says when the room moved. This read covers what it cannot see,
// such as a coordinator run replaced while its old stream stays quiet.
const FALLBACK_RELOAD_MS = 30_000;
// No coordinator's stream announces the next one binding, so an unbound room reads again until it does.
const BIND_POLL_MS = 1_000;
// A handoff binds within seconds; past this the room starts the coordinator itself, so a start the
// hub could not make shows its refusal instead of an endless thinking mark.
const BIND_WAIT_MS = 15_000;
// After a run closes, the mirror's commit can trail its last frame.
const SETTLE_RELOAD_MS = [1_000, 3_000, 7_000, 15_000];

/** Reads the room on request, throttled, and on a slow fallback tick. */
export function useRoomReload(projectId: string, status: string): () => void {
  const queryClient = useQueryClient();
  const reloadRef = useRef<() => void>(() => {});

  useEffect(() => {
    const reloader = createRoomReloader(() =>
      loadProjectRoom(projectId, queryClient, status === "active"),
    );
    reloadRef.current = reloader.request;
    const timer = setInterval(reloader.request, FALLBACK_RELOAD_MS);
    return () => {
      clearInterval(timer);
      reloader.dispose();
      reloadRef.current = () => {};
    };
  }, [projectId, queryClient, status]);
  // Asks whichever reader is current when it is called, so its identity never changes.
  return useCallback(() => reloadRef.current(), []);
}

/**
 * The plan and who is at work are read with the room, so a run parking on an approval, or
 * leaving one, reads the room again for its step to say so.
 */
export function useReloadOnHold(awaitingApproval: string, reload: () => void) {
  useEffect(() => {
    reload();
  }, [awaitingApproval, reload]);
}

/** Reads the room a few more times while a closed run's reply has not been committed. */
export function useSettleReloads(settling: boolean, reload: () => void) {
  useEffect(() => {
    if (!settling) return;
    const timers = SETTLE_RELOAD_MS.map((ms) => setTimeout(() => reload(), ms));
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [settling, reload]);
}

/** Reads an unbound room until its coordinator binds, and starts one itself after a while. */
export function useBindPoll(
  awaitingBind: boolean,
  reload: () => void,
  startCoordinator: () => Promise<void>,
) {
  useEffect(() => {
    if (!awaitingBind) return;
    const timer = setInterval(() => reload(), BIND_POLL_MS);
    const fallback = setTimeout(() => void startCoordinator(), BIND_WAIT_MS);
    return () => {
      clearInterval(timer);
      clearTimeout(fallback);
    };
  }, [awaitingBind, reload]);
}
