# @argszero/dsh-host-exit-marker

Leave a record when a dsh host process dies.

A dsh **mitigation** for [discussion #10022](https://github.com/deepseek-ai/deepseek-harness/discussions/10022):
from the outside, a crash, a quit and a `SIGTERM` are indistinguishable — and
none of them is written down anywhere.

> **This is a mitigation, not the fix.** Making a silent exit *loud* on stderr is
> a decision the host has to take about itself, and the second half of the same
> report — warning-class plugin errors held only in a 64 KB in-memory ring — is a
> host-logging surface rather than a process one. A plugin can neither change the
> host's exit policy nor read that ring. What it can do is leave a file behind,
> and that is what this package does.

## The defect, in the source

Two ways to lose the end of a host's life, both silent:

1. **A signalled exit looks exactly like a clean one.** `apps/cli/src/profile-boot.ts:307`
   registers `process.on('SIGTERM', () => { interrupt(0) })`, and `interrupt`
   disposes the tree and then calls `process.exit(0)`
   (`apps/cli/src/process-shutdown.ts`, with `PROCESS_SHUTDOWN_TIMEOUT_MS = 5_000`
   as its grace period). The desktop shell kills the host with `SIGTERM` on quit
   and on invalid IPC (`apps/desktop/src/host-process.ts:209`, `:296`), so
   `exit 0` is the outcome both of being asked to stop and of finishing work.
   `SIGHUP` is not registered at all, so it default-terminates — equally silent.
   Nothing records either.
2. **A death no handler can see.** `SIGKILL`, a native crash, a power cut: no
   listener is called, so by construction there is no trace at all.

The reporter's own workaround is a small host plugin that appends a timestamped
line on `SIGTERM`/`SIGHUP`. This package is that workaround, published and
installable, plus the half a signal listener cannot reach.

## Install and mount

```sh
npm install @argszero/dsh-host-exit-marker
```

The package carries a `dsh.bundle.patch` entry, so mounting it is the whole of
the configuration:

```yaml
- insert:
    - id: host-exit-marker
      name: '@argszero/dsh-host-exit-marker'
```

It belongs in a **long-lived host** profile — the desktop host or `dsh web` —
because a record is only meaningful for a process that lives long enough to be
missed. No service is injected: `process` and the filesystem are not cordis
services, so there is nothing to wait for, and the marker is in force from the
moment the fiber activates — including the startup window in which
`profile-boot` has already armed its own signal handlers.

## What it records

One line per event, appended to `<dsh home>/logs/host-exit.log` — the same
`~/.dsh/logs` directory the desktop host already writes `startup-*.log` into:

```
2026-10-17T15:26:34.543Z start pid=47991 host=cce30dd1 node=v26.5.0 startedAt=2026-10-17T15:26:34.542Z
2026-10-17T16:02:11.870Z signal signal=SIGTERM pid=47991 host=cce30dd1 uptime=2137 others=1
```

| event | written when | notable fields |
|---|---|---|
| `start` | the plugin mounts | `pid`, `host`, `node`, `startedAt` |
| `signal` | a configured signal arrives, **before** anything else reacts | `signal`, `uptime`, `others` |
| `exit` | the process ends with the plugin still mounted | `code`, `uptime` |
| `unmount` | the plugin is disposed | `uptime` |
| `died-without-exit` | **a later boot** finds this instance's record orphaned | `pid`, `host`, `started`, `lastAlive` |

`others` is how many listeners something else had registered for that signal.
Zero means nothing else in the process would have acted on it — see below.

A value containing whitespace is quoted, so one line is always one record:

```
2026-10-17T16:02:11.870Z signal signal=SIGTERM dir="/Users/me/.dsh/my logs" others=1
```

### The death no handler can see

Each running instance keeps one record under `logs/hosts/`, refreshed by an
unref'd heartbeat (30 s by default). When a process dies in a way that runs no
handler, the record stays behind — and the **next** boot is the only thing that
can still read it:

```
2026-10-17T17:41:02.001Z died-without-exit pid=47991 host=cce30dd1 started=2026-10-17T15:26:34.542Z lastAlive=2026-10-17T17:40:31.004Z
```

`lastAlive` dates the death to within one heartbeat. When the record's mtime
cannot be read it says `unknown` rather than guessing: a record nobody refreshed
is a record nobody can date.

## Why it re-raises the signal

Node removes a signal's **default action** the moment that signal has a listener.
A plugin that only listened would therefore turn `SIGHUP` from "terminate" into
"ignore" — the host would survive a hangup it used to die of. So when a signal
arrives and `others` is zero, the plugin removes its own listener, re-raises the
signal against itself, and the process dies exactly as it did before, one
`signal=SIGHUP` line richer.

This is the one place the plugin touches behaviour, and it deliberately restores
what it displaced rather than introducing anything new. Where the default action
cannot be restored (`process.kill` throws), the process exits with the status a
shell would report for that signal — 129, 130 or 143.

The re-raise is proven against real child processes in `test/witness.spec.mjs`:
a child with nothing else listening dies of `SIGTERM` and of `SIGHUP` with no
exit status, and the line is on disk before it goes.

## Configuration

Every field is optional; `{}` is a valid mount.

| field | default | meaning |
|---|---|---|
| `enabled` | `true` | turn the plugin off without unmounting it — records nothing, registers nothing |
| `dir` | `$DSH_EXIT_MARKER_DIR`, else `<dsh home>/logs` | where `host-exit.log` and `hosts/` live |
| `signals` | `SIGTERM`, `SIGINT`, `SIGHUP` | which signals to record |
| `heartbeatMs` | `30000` | how often a live record's mtime is refreshed; `0` disables it |
| `log` | `warn` | `silent`, `warn` or `debug` — this plugin says nothing when it works |

```yaml
- id: host-exit-marker
  name: '@argszero/dsh-host-exit-marker'
  config:
    dir: /var/log/dsh
    signals: [SIGTERM, SIGHUP]
```

A configuration that cannot work throws at mount rather than at the first
signal: a marker that silently recorded nothing would be worse than no marker.
A bad *write*, on the other hand, never throws — a marker that turned a clean
shutdown into a noisy one would be worse still — and is reported once through
the logger instead of on every attempt.

## What it does not do

- It does not change the exit status, the shutdown path, the fatal policy or any
  other listener. The vendor handlers still run, in the same order.
- It cannot make an exit loud. No plugin can: the quiet `exit(0)` is the host's
  own decision, taken in `apps/cli`.
- It does not read the 64 KB in-memory warning ring from #10022's second defect.
- It does not touch the session log, the workspace or any other dsh state. It
  writes two things, both under `dir`.

## Requirements

Node `^22.19 || >=24`. Zero runtime dependencies; the only peer is
`@deepseek-ai/cordis`.

## License

MIT.
