/**
 * Stdio lifecycle for the MCP server.
 *
 * Claude Desktop reports "process exiting early" when this process dies on its
 * own. Two ways that happens with no stderr: the event loop drains after stdin
 * EOF (Node exits 0), and an unhandled SIGHUP (default action is terminate,
 * and 'exit' listeners do not run). Soft stdin EOF must not call
 * transport.close() — that trips the SDK onclose path and breaks one-shot
 * pipes. A dead parent is handled by the watchdog, which is unref'd so it
 * cannot by itself keep the process alive.
 */

import fs from "node:fs";

export type ParentLivenessProbe = (parentPid: number) => boolean;

/** Poll interval (ms) used when the env override is unset or invalid. */
export const DEFAULT_PARENT_WATCHDOG_MS = 30_000;

const MIN_PARENT_WATCHDOG_MS = 100;

/**
 * Parse WORDPRESS_PARENT_WATCHDOG_MS into a safe poll interval.
 *
 * Non-finite / zero / negative → default. No disable value: an unparseable
 * knob must never silently turn orphan protection off. Floored at
 * MIN_PARENT_WATCHDOG_MS so tiny inputs can't spin the CPU.
 */
export function parseWatchdogIntervalMs(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_PARENT_WATCHDOG_MS;
  return Math.max(n, MIN_PARENT_WATCHDOG_MS);
}

/**
 * Default probe: the server has been reparented away from its original parent.
 * POSIX only (Windows does not reparent orphans, so this is a no-op there).
 */
export function parentReparented(parentPid: number): boolean {
  if (process.platform === "win32") return false;
  return process.ppid !== parentPid;
}

/**
 * Poll for the original parent's death and invoke `onDead` exactly once.
 * Interval is unref'd so the watchdog alone never keeps the event loop alive.
 */
export function startParentWatchdog(
  parentPid: number,
  intervalMs: number,
  onDead: () => void,
  isParentGone: ParentLivenessProbe = parentReparented,
): NodeJS.Timeout {
  let fired = false;
  const timer = setInterval(() => {
    if (fired) return;
    if (isParentGone(parentPid)) {
      fired = true;
      onDead();
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

function writeStderr(message: string) {
  try {
    fs.writeSync(2, message.endsWith("\n") ? message : `${message}\n`);
  } catch {
    /* stderr may already be gone */
  }
}

/**
 * Install stdin/signal/parent-watchdog hooks. Call before `server.connect`.
 *
 * Returns a disposer for tests. The running server should not call it.
 * Pass `parentPid` captured before any await — `process.ppid` is dynamic.
 */
export function installStdioLifecycle(options: {
  transport: { close?: () => unknown };
  onCloseAssignable?: { onclose?: (() => void) | null };
  envName?: string;
  onShutdown?: () => void;
  parentPid?: number;
}): () => void {
  const parentPid = options.parentPid ?? process.ppid;
  let shuttingDown = false;
  // Ref'd on purpose. The watchdog timer is unref'd, and stdin stops counting
  // as an active handle once it EOFs. Without this, Node exits 0 and Claude
  // logs "transport closed unexpectedly" / "process exiting early".
  const keepalive = setInterval(() => {}, 60_000);

  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(keepalive);
    try {
      options.onShutdown?.();
    } catch {
      /* best effort */
    }
    try {
      void options.transport.close?.();
    } catch {
      /* best effort */
    }
    process.exit(code);
  };

  const onStdinQuiet = () => {};
  process.stdin.on("end", onStdinQuiet);
  process.stdin.on("close", onStdinQuiet);

  const onPipeError = (error: NodeJS.ErrnoException) => {
    if (error?.code === "EPIPE" || error?.code === "ERR_STREAM_DESTROYED")
      return;
    writeStderr(
      `[ERROR] stdio: ${error?.stack || error?.message || String(error)}`,
    );
  };
  process.stdout.on("error", onPipeError);
  process.stderr.on("error", onPipeError);

  if (options.onCloseAssignable) {
    options.onCloseAssignable.onclose = () => shutdown(0);
  }

  const onTerm = () => {
    writeStderr("[SHUTDOWN] Received SIGTERM, shutting down...");
    shutdown(0);
  };
  const onInt = () => {
    writeStderr("[SHUTDOWN] Received SIGINT, shutting down...");
    shutdown(0);
  };
  // SIGHUP's default action kills the process without running 'exit' hooks,
  // which Claude logs as a crash with an empty stderr. Ignore it while the
  // original parent is alive; the watchdog still exits after a real reparent.
  const onHup = () => {
    writeStderr(
      `[WARN] Ignoring SIGHUP (parent ${parentPid}, current ${process.ppid})`,
    );
  };
  process.on("SIGTERM", onTerm);
  process.on("SIGINT", onInt);
  process.on("SIGHUP", onHup);

  const envName = options.envName ?? "WORDPRESS_PARENT_WATCHDOG_MS";
  const watchdog = startParentWatchdog(
    parentPid,
    parseWatchdogIntervalMs(process.env[envName]),
    () => {
      writeStderr(`[SHUTDOWN] Parent ${parentPid} is gone, shutting down...`);
      shutdown(0);
    },
  );

  return () => {
    process.off("SIGTERM", onTerm);
    process.off("SIGINT", onInt);
    process.off("SIGHUP", onHup);
    clearInterval(keepalive);
    clearInterval(watchdog);
    process.stdin.off("end", onStdinQuiet);
    process.stdin.off("close", onStdinQuiet);
    process.stdout.off("error", onPipeError);
    process.stderr.off("error", onPipeError);
    if (options.onCloseAssignable?.onclose) {
      options.onCloseAssignable.onclose = null;
    }
  };
}
