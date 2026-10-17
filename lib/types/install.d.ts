/**
 * Installing the marker in a live process: the files it keeps, the signals it
 * records, and the liveness record that survives the process it describes.
 *
 * Everything that touches the world is injected — the clock, the process object
 * and the liveness probe — so the suite can drive a real temp directory without
 * signalling itself, and `witness.spec.mjs` can drive a real child.
 *
 * @module @argszero/dsh-host-exit-marker/install
 */
import type { MarkerSignal, ResolvedHostExitMarkerConfig } from './config.ts';
/** The subset of `process` this plugin uses, injectable for tests. */
export interface ProcessLike {
    readonly pid: number;
    /** Unix time the process started, from Node's own accounting. */
    uptime(): number;
    on(event: string, listener: (...args: never[]) => void): unknown;
    prependListener(event: string, listener: (...args: never[]) => void): unknown;
    removeListener(event: string, listener: (...args: never[]) => void): unknown;
    listenerCount(event: string): number;
    kill(pid: number, signal: NodeJS.Signals): boolean;
}
/** Where a line or a decision goes when this plugin has something to say. */
export type MarkerReport = (message: string, level: 'warn' | 'debug') => void;
/** The live marker's outcome. */
export interface MarkerHandle {
    readonly outcome: 'installed' | 'disabled';
    /** Directory holding `host-exit.log` and `hosts/`. */
    readonly dir: string;
    /** This instance's identity, or the empty string when disabled. */
    readonly hostId: string;
    /** The predecessors this boot reported as having died without a marker. */
    readonly reported: readonly number[];
    /** Stop recording and remove this instance's liveness record. */
    uninstall(): void;
}
/** What installation depends on. */
export interface InstallOptions {
    readonly config: ResolvedHostExitMarkerConfig;
    readonly report: MarkerReport;
    readonly processRef?: ProcessLike;
    readonly now?: () => Date;
    readonly isAlive?: (pid: number) => boolean;
    readonly randomId?: () => string;
}
/**
 * The exit status a signal would have produced had nothing handled it.
 * @param signal - the signal being re-raised.
 * @returns `128 + the signal's number`, as a shell reports it.
 */
export declare function defaultExitCode(signal: MarkerSignal): number;
/**
 * Install the marker for as long as the caller keeps the handle.
 * @param options - resolved configuration plus the injected seams.
 * @returns the handle; `uninstall()` removes every listener and the record.
 */
export declare function installProcessMarker(options: InstallOptions): MarkerHandle;
//# sourceMappingURL=install.d.ts.map