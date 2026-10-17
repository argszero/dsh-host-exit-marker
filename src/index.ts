/**
 * `@argszero/dsh-host-exit-marker` — leave a record when a dsh host process dies.
 *
 * ## The gap
 *
 * Discussion #10022 reports two ways to lose the end of a host's life, from the
 * outside, on DSH Desktop `0.2.1-rc.2`:
 *
 * 1. **A signalled exit is indistinguishable from a clean one, and neither is
 *    recorded.** `apps/cli/src/profile-boot.ts:307` registers
 *    `process.on('SIGTERM', () => { interrupt(0) })`, and `interrupt` disposes
 *    the tree and then calls `process.exit(0)`
 *    (`packages/boot/../apps/cli/src/process-shutdown.ts` — `createProcessShutdown`,
 *    `forceExit` at exit, grace `PROCESS_SHUTDOWN_TIMEOUT_MS = 5_000`). The
 *    desktop shell kills the host with `SIGTERM` on quit and on invalid IPC
 *    (`apps/desktop/src/host-process.ts:209`, `:296`), so `exit 0` is the normal
 *    outcome of being asked to stop *and* of finishing work — nothing
 *    distinguishes them, and nothing writes either down. `SIGHUP` is not
 *    registered at all, so it default-terminates: equally silent.
 * 2. **A death no handler can see** — `SIGKILL`, a native crash, a power cut —
 *    leaves no trace anywhere by construction.
 *
 * The reporter's own workaround is a small host plugin that appends a timestamped
 * line on `SIGTERM`/`SIGHUP`. This is that, published and installable, plus the
 * one half a signal listener cannot reach:
 *
 * ## What this plugin does
 *
 * - It records a line for each configured signal, `SIGTERM`/`SIGINT`/`SIGHUP` by
 *   default, **before** anything else in the process reacts
 *   (`prependListener`, because the vendor handler begins disposal at once and a
 *   repeated signal forces an immediate exit).
 * - It restores the default action it displaced. Node removes a signal's default
 *   behaviour the moment the signal has a listener, so a plugin that only
 *   listened would quietly turn `SIGHUP` from "terminate" into "ignore". When
 *   nothing else in the process would act on the signal, the plugin re-raises it
 *   against itself, and the process dies exactly as it did before — one
 *   `signal=SIGHUP` line richer.
 * - It keeps one liveness record per running instance under `hosts/`, refreshed
 *   by an unref'd heartbeat. **The next boot reports every record whose process
 *   is gone** as `died-without-exit`, with the instance's start time and the last
 *   time it was seen alive. That is the trace of a `SIGKILL` or a crash — the
 *   case no listener can ever catch.
 * - It records `unmount` when the plugin is disposed and `exit` with the status
 *   when the process ends with the plugin still mounted.
 *
 * ## What it does not do
 *
 * It does not change the exit status, the shutdown path, the fatal policy or any
 * other listener: the vendor handlers still run, in the same order, and the
 * plugin adds only its own lines. It cannot make a silent exit *loud* on stderr
 * — that is a decision for the host, not for a plugin — and it does not address
 * #10022's second defect (warning-class plugin errors held only in a 64 KB
 * in-memory ring), which is a host-logging surface rather than a process one.
 *
 * A marker that broke the host would be worse than no marker, so every write is
 * best-effort and reported once through the logger instead of thrown.
 *
 * @module @argszero/dsh-host-exit-marker
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  resolveConfig,
  type HostExitMarkerConfig,
  type MarkerLogLevel,
  type ResolvedHostExitMarkerConfig,
} from './config.ts'
import { installProcessMarker, type MarkerHandle } from './install.ts'

export { DEFAULT_HEARTBEAT_MS, DEFAULT_SIGNALS, HostExitMarkerConfigError, defaultDshHome, resolveConfig } from './config.ts'
export type { HostExitMarkerConfig, MarkerLogLevel, MarkerSignal, ResolvedHostExitMarkerConfig } from './config.ts'
export { defaultExitCode, installProcessMarker } from './install.ts'
export type { InstallOptions, MarkerHandle, MarkerReport, ProcessLike } from './install.ts'
export { classifyPredecessor, deathFields, formatLine, isProcessAlive, renderValue, uptimeSeconds } from './lines.ts'
export type { LineFieldValue, LiveRecord, Predecessor } from './lines.ts'

/** The name cordis mounts this plugin under. */
export const name = 'host-exit-marker'

const LOG_PREFIX = 'host-exit-marker:'

/**
 * Record this process's signals and its liveness for as long as it is mounted.
 *
 * No `inject` is declared: the plugin reads `process` and the filesystem, which
 * are not cordis services, so there is nothing to wait for and the marker is in
 * force from the moment the fiber activates — including the startup window, where
 * `profile-boot` has already armed its signal handlers
 * (`apps/cli/src/profile-boot.ts:307-308`).
 * @param ctx - the plugin context; disposal is registered on it.
 * @param raw - the mounted configuration, `{}` when omitted.
 * @throws when the configuration itself is unusable, never because of a write.
 */
export function apply(ctx: Context, raw: HostExitMarkerConfig = {}): void {
  const config: ResolvedHostExitMarkerConfig = resolveConfig(raw)

  const report = (message: string, level: 'warn' | 'debug' = 'warn'): void => {
    if (config.log === 'silent') return
    const quiet: MarkerLogLevel = level === 'debug' ? 'debug' : 'warn'
    // A debug line is chatty detail; a warning is the operator's business unless
    // the operator asked for this plugin's chatter to stay off the warning log.
    if (quiet === 'debug' || config.log === 'debug') ctx.logger.debug(message)
    else ctx.logger.warn(message)
  }

  if (!config.enabled) {
    report(`${LOG_PREFIX} disabled by configuration, so this host still dies without a record`, 'debug')
    return
  }

  const handle: MarkerHandle = installProcessMarker({ config, report })

  for (const pid of handle.reported) {
    report(`${LOG_PREFIX} the previous host instance (pid ${pid}) ended without reporting an exit — `
      + 'a kill no handler can see, a native crash, or a lost machine', 'warn')
  }
  report(`${LOG_PREFIX} recording signals (${config.signals.join(', ')}) to `
    + `${config.dir}/host-exit.log as host ${handle.hostId}`, 'debug')

  ctx.effect(() => () => { handle.uninstall() }, `${LOG_PREFIX}uninstall()`)
}

export default { name, apply }
