/**
 * Configuration for `@argszero/dsh-host-exit-marker`.
 *
 * The plugin has one job and therefore very little to configure: where the
 * marker files live, which signals to record, and how loud to be. Every field is
 * defaulted, so `{}` is a valid mount.
 *
 * @module @argszero/dsh-host-exit-marker/config
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** How much of this plugin's own commentary reaches the log. */
export type MarkerLogLevel = 'silent' | 'warn' | 'debug'

/** One signal this plugin records before the process acts on it. */
export type MarkerSignal = 'SIGTERM' | 'SIGINT' | 'SIGHUP'

/** The signals recorded when the mount names none. */
export const DEFAULT_SIGNALS: readonly MarkerSignal[] = ['SIGTERM', 'SIGINT', 'SIGHUP']

/** How the mounted plugin behaves. */
export interface HostExitMarkerConfig {
  /**
   * Turn the plugin off without unmounting it. A disabled mount records nothing
   * and registers nothing, which is what makes it safe to leave in a profile.
   */
  readonly enabled?: boolean
  /**
   * Directory for `host-exit.log` and the `hosts/` liveness records. Defaults to
   * `$DSH_EXIT_MARKER_DIR`, then `<dsh home>/logs` — the same `~/.dsh/logs`
   * directory the desktop host already writes `startup-*.log` into.
   */
  readonly dir?: string
  /** Signals to record. Defaults to SIGTERM, SIGINT and SIGHUP. */
  readonly signals?: readonly MarkerSignal[]
  /**
   * How often a live record's mtime is refreshed, in milliseconds; `0` disables
   * the heartbeat. The heartbeat is what lets the next boot say *when* a dead
   * instance was last alive, instead of only that it died.
   */
  readonly heartbeatMs?: number
  /** Chatter level. Defaults to `warn`: this plugin says nothing when it works. */
  readonly log?: MarkerLogLevel
}

/** Configuration after defaults are applied. */
export interface ResolvedHostExitMarkerConfig {
  readonly enabled: boolean
  readonly dir: string
  readonly signals: readonly MarkerSignal[]
  readonly heartbeatMs: number
  readonly log: MarkerLogLevel
}

/** The default heartbeat: thirty seconds of silence still dates the death. */
export const DEFAULT_HEARTBEAT_MS = 30_000

/** Mount-time failure of the configuration itself (never of a filesystem write). */
export class HostExitMarkerConfigError extends Error {
  override readonly name = 'HostExitMarkerConfigError'
}

const LEVELS: readonly MarkerLogLevel[] = ['silent', 'warn', 'debug']
const SIGNALS: readonly MarkerSignal[] = ['SIGTERM', 'SIGINT', 'SIGHUP']

/**
 * The directory `~/.dsh` resolves to on this host.
 * @returns the harness home directory, or the OS home when the harness has none.
 */
export function defaultDshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/**
 * Apply defaults and reject a configuration that cannot work.
 *
 * A bad configuration throws here rather than at the first signal: a marker
 * that silently recorded nothing would be worse than no marker at all, and the
 * one thing this plugin must never do is fail *during* a shutdown.
 * @param raw - the mounted configuration, `{}` when omitted.
 * @returns the resolved configuration.
 * @throws HostExitMarkerConfigError when a field is present but unusable.
 */
export function resolveConfig(raw: HostExitMarkerConfig = {}): ResolvedHostExitMarkerConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new HostExitMarkerConfigError('configuration must be an object')
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    throw new HostExitMarkerConfigError('enabled must be a boolean')
  }
  if (raw.dir !== undefined && (typeof raw.dir !== 'string' || raw.dir.trim() === '')) {
    throw new HostExitMarkerConfigError('dir must be a non-empty string')
  }
  if (raw.log !== undefined && !LEVELS.includes(raw.log)) {
    throw new HostExitMarkerConfigError(`log must be one of ${LEVELS.join(', ')}`)
  }
  if (raw.heartbeatMs !== undefined
    && (typeof raw.heartbeatMs !== 'number' || !Number.isFinite(raw.heartbeatMs) || raw.heartbeatMs < 0)) {
    throw new HostExitMarkerConfigError('heartbeatMs must be a finite number of milliseconds, 0 to disable')
  }
  const signals = raw.signals ?? DEFAULT_SIGNALS
  if (!Array.isArray(signals) || signals.some(signal => !SIGNALS.includes(signal))) {
    throw new HostExitMarkerConfigError(`signals must be a list drawn from ${SIGNALS.join(', ')}`)
  }
  const dir = raw.dir ?? process.env.DSH_EXIT_MARKER_DIR ?? join(defaultDshHome(), 'logs')
  return {
    enabled: raw.enabled ?? true,
    dir,
    // Deduplicated and ordered as declared, so one signal is never recorded twice.
    signals: [...new Set(signals)],
    heartbeatMs: raw.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
    log: raw.log ?? 'warn',
  }
}
