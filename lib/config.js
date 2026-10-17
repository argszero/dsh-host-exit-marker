/**
 * Configuration for `@argszero/dsh-host-exit-marker`.
 *
 * The plugin has one job and therefore very little to configure: where the
 * marker files live, which signals to record, and how loud to be. Every field is
 * defaulted, so `{}` is a valid mount.
 *
 * @module @argszero/dsh-host-exit-marker/config
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
/** The signals recorded when the mount names none. */
export const DEFAULT_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'];
/** The default heartbeat: thirty seconds of silence still dates the death. */
export const DEFAULT_HEARTBEAT_MS = 30_000;
/** Mount-time failure of the configuration itself (never of a filesystem write). */
export class HostExitMarkerConfigError extends Error {
    name = 'HostExitMarkerConfigError';
}
const LEVELS = ['silent', 'warn', 'debug'];
const SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'];
/**
 * The directory `~/.dsh` resolves to on this host.
 * @returns the harness home directory, or the OS home when the harness has none.
 */
export function defaultDshHome() {
    return process.env.DSH_HOME ?? join(homedir(), '.dsh');
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
export function resolveConfig(raw = {}) {
    if (typeof raw !== 'object' || raw === null) {
        throw new HostExitMarkerConfigError('configuration must be an object');
    }
    if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
        throw new HostExitMarkerConfigError('enabled must be a boolean');
    }
    if (raw.dir !== undefined && (typeof raw.dir !== 'string' || raw.dir.trim() === '')) {
        throw new HostExitMarkerConfigError('dir must be a non-empty string');
    }
    if (raw.log !== undefined && !LEVELS.includes(raw.log)) {
        throw new HostExitMarkerConfigError(`log must be one of ${LEVELS.join(', ')}`);
    }
    if (raw.heartbeatMs !== undefined
        && (typeof raw.heartbeatMs !== 'number' || !Number.isFinite(raw.heartbeatMs) || raw.heartbeatMs < 0)) {
        throw new HostExitMarkerConfigError('heartbeatMs must be a finite number of milliseconds, 0 to disable');
    }
    const signals = raw.signals ?? DEFAULT_SIGNALS;
    if (!Array.isArray(signals) || signals.some(signal => !SIGNALS.includes(signal))) {
        throw new HostExitMarkerConfigError(`signals must be a list drawn from ${SIGNALS.join(', ')}`);
    }
    const dir = raw.dir ?? process.env.DSH_EXIT_MARKER_DIR ?? join(defaultDshHome(), 'logs');
    return {
        enabled: raw.enabled ?? true,
        dir,
        // Deduplicated and ordered as declared, so one signal is never recorded twice.
        signals: [...new Set(signals)],
        heartbeatMs: raw.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
        log: raw.log ?? 'warn',
    };
}
