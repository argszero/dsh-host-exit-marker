/**
 * The two pure halves of the marker: how one log line is written, and how a
 * predecessor's liveness record is classified.
 *
 * Everything here is a function of its arguments — no clock, no filesystem, no
 * `process` — which is what lets the suite pin the format and the classification
 * without waiting for a signal or for a death.
 *
 * @module @argszero/dsh-host-exit-marker/lines
 */
/** One live instance, as recorded while it runs. */
export interface LiveRecord {
    /** OS process id of the instance that wrote the record. */
    readonly pid: number;
    /** Random identity for this instance, so a recycled pid is not mistaken for it. */
    readonly hostId: string;
    /** When the instance started, ISO 8601. */
    readonly startedAt: string;
}
/** What a predecessor's record means for the instance that finds it. */
export type Predecessor = 'dead' | 'self' | 'other';
/** Values a line may carry; every value is rendered `key=value`. */
export type LineFieldValue = string | number | boolean;
/**
 * Render one log line.
 * @param at - when the line is written.
 * @param event - the event name, first after the timestamp.
 * @param fields - `key=value` pairs, in the order given.
 * @returns one newline-terminated line.
 */
export declare function formatLine(at: Date, event: string, fields?: Readonly<Record<string, LineFieldValue>>): string;
/**
 * Render one value so the line stays one line and one field.
 *
 * A value with whitespace in it (a path with a space, say) is quoted, because an
 * unquoted one would silently split into two fields for anyone parsing by eye.
 * @param value - the value to render.
 * @returns the value as it appears in the line.
 */
export declare function renderValue(value: LineFieldValue): string;
/**
 * Decide what a predecessor's record says about the instance that found it.
 * @param record - the record read from the `hosts/` directory.
 * @param selfPid - this instance's own process id.
 * @param isAlive - liveness test, so a test can answer without a real process.
 * @returns `self` for this very instance, `other` for a running peer, `dead`
 *   when nothing with that pid is running any more.
 */
export declare function classifyPredecessor(record: LiveRecord, selfPid: number, isAlive: (pid: number) => boolean): Predecessor;
/**
 * Whether a process id is in use.
 *
 * `kill(pid, 0)` is the portable liveness probe: it delivers no signal, and it
 * answers `ESRCH` for an id nothing owns. `EPERM` means the process exists and
 * belongs to somebody else — alive, and not ours to signal.
 * @param pid - the process id to test.
 * @returns whether a process with that id exists.
 */
export declare function isProcessAlive(pid: number): boolean;
/**
 * Seconds elapsed since an instant, rounded down, for the `uptime` field.
 * @param startedAt - the instant to measure from.
 * @param now - the instant to measure to.
 * @returns whole seconds, never negative.
 */
export declare function uptimeSeconds(startedAt: Date, now: Date): number;
/**
 * The line a boot writes when it finds that its predecessor never said goodbye.
 * @param record - the predecessor's record.
 * @param lastAliveMs - the record's mtime in milliseconds, when it could be read.
 * @returns the fields for the `died-without-exit` line.
 */
export declare function deathFields(record: LiveRecord, lastAliveMs: number | undefined): Record<string, LineFieldValue>;
//# sourceMappingURL=lines.d.ts.map