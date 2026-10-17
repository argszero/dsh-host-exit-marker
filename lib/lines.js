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
/**
 * Render one log line.
 * @param at - when the line is written.
 * @param event - the event name, first after the timestamp.
 * @param fields - `key=value` pairs, in the order given.
 * @returns one newline-terminated line.
 */
export function formatLine(at, event, fields = {}) {
    const rendered = Object.entries(fields).map(([key, value]) => `${key}=${renderValue(value)}`);
    return `${at.toISOString()} ${event}${rendered.length === 0 ? '' : ` ${rendered.join(' ')}`}\n`;
}
/**
 * Render one value so the line stays one line and one field.
 *
 * A value with whitespace in it (a path with a space, say) is quoted, because an
 * unquoted one would silently split into two fields for anyone parsing by eye.
 * @param value - the value to render.
 * @returns the value as it appears in the line.
 */
export function renderValue(value) {
    const text = String(value);
    return /[\s"\\]/.test(text) ? JSON.stringify(text) : text;
}
/**
 * Decide what a predecessor's record says about the instance that found it.
 * @param record - the record read from the `hosts/` directory.
 * @param selfPid - this instance's own process id.
 * @param isAlive - liveness test, so a test can answer without a real process.
 * @returns `self` for this very instance, `other` for a running peer, `dead`
 *   when nothing with that pid is running any more.
 */
export function classifyPredecessor(record, selfPid, isAlive) {
    if (record.pid === selfPid)
        return 'self';
    return isAlive(record.pid) ? 'other' : 'dead';
}
/**
 * Whether a process id is in use.
 *
 * `kill(pid, 0)` is the portable liveness probe: it delivers no signal, and it
 * answers `ESRCH` for an id nothing owns. `EPERM` means the process exists and
 * belongs to somebody else — alive, and not ours to signal.
 * @param pid - the process id to test.
 * @returns whether a process with that id exists.
 */
export function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0)
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (error) {
        return error.code === 'EPERM';
    }
}
/**
 * Seconds elapsed since an instant, rounded down, for the `uptime` field.
 * @param startedAt - the instant to measure from.
 * @param now - the instant to measure to.
 * @returns whole seconds, never negative.
 */
export function uptimeSeconds(startedAt, now) {
    return Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
}
/**
 * The line a boot writes when it finds that its predecessor never said goodbye.
 * @param record - the predecessor's record.
 * @param lastAliveMs - the record's mtime in milliseconds, when it could be read.
 * @returns the fields for the `died-without-exit` line.
 */
export function deathFields(record, lastAliveMs) {
    return {
        pid: record.pid,
        host: record.hostId,
        started: record.startedAt,
        // `unknown` rather than a guess: the heartbeat is what would date the death,
        // and a record whose mtime is unreadable is a record nobody refreshed.
        lastAlive: lastAliveMs === undefined ? 'unknown' : new Date(lastAliveMs).toISOString(),
    };
}
