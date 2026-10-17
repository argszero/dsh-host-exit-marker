/**
 * Configuration for `@argszero/dsh-host-exit-marker`.
 *
 * The plugin has one job and therefore very little to configure: where the
 * marker files live, which signals to record, and how loud to be. Every field is
 * defaulted, so `{}` is a valid mount.
 *
 * @module @argszero/dsh-host-exit-marker/config
 */
/** How much of this plugin's own commentary reaches the log. */
export type MarkerLogLevel = 'silent' | 'warn' | 'debug';
/** One signal this plugin records before the process acts on it. */
export type MarkerSignal = 'SIGTERM' | 'SIGINT' | 'SIGHUP';
/** The signals recorded when the mount names none. */
export declare const DEFAULT_SIGNALS: readonly MarkerSignal[];
/** How the mounted plugin behaves. */
export interface HostExitMarkerConfig {
    /**
     * Turn the plugin off without unmounting it. A disabled mount records nothing
     * and registers nothing, which is what makes it safe to leave in a profile.
     */
    readonly enabled?: boolean;
    /**
     * Directory for `host-exit.log` and the `hosts/` liveness records. Defaults to
     * `$DSH_EXIT_MARKER_DIR`, then `<dsh home>/logs` — the same `~/.dsh/logs`
     * directory the desktop host already writes `startup-*.log` into.
     */
    readonly dir?: string;
    /** Signals to record. Defaults to SIGTERM, SIGINT and SIGHUP. */
    readonly signals?: readonly MarkerSignal[];
    /**
     * How often a live record's mtime is refreshed, in milliseconds; `0` disables
     * the heartbeat. The heartbeat is what lets the next boot say *when* a dead
     * instance was last alive, instead of only that it died.
     */
    readonly heartbeatMs?: number;
    /** Chatter level. Defaults to `warn`: this plugin says nothing when it works. */
    readonly log?: MarkerLogLevel;
}
/** Configuration after defaults are applied. */
export interface ResolvedHostExitMarkerConfig {
    readonly enabled: boolean;
    readonly dir: string;
    readonly signals: readonly MarkerSignal[];
    readonly heartbeatMs: number;
    readonly log: MarkerLogLevel;
}
/** The default heartbeat: thirty seconds of silence still dates the death. */
export declare const DEFAULT_HEARTBEAT_MS = 30000;
/** Mount-time failure of the configuration itself (never of a filesystem write). */
export declare class HostExitMarkerConfigError extends Error {
    readonly name = "HostExitMarkerConfigError";
}
/**
 * The directory `~/.dsh` resolves to on this host.
 * @returns the harness home directory, or the OS home when the harness has none.
 */
export declare function defaultDshHome(): string;
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
export declare function resolveConfig(raw?: HostExitMarkerConfig): ResolvedHostExitMarkerConfig;
//# sourceMappingURL=config.d.ts.map