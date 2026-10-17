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

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  classifyPredecessor,
  deathFields,
  formatLine,
  isProcessAlive,
  uptimeSeconds,
  type LineFieldValue,
  type LiveRecord,
} from './lines.ts'
import type { MarkerSignal, ResolvedHostExitMarkerConfig } from './config.ts'

/** The subset of `process` this plugin uses, injectable for tests. */
export interface ProcessLike {
  readonly pid: number
  /** Unix time the process started, from Node's own accounting. */
  uptime(): number
  on(event: string, listener: (...args: never[]) => void): unknown
  prependListener(event: string, listener: (...args: never[]) => void): unknown
  removeListener(event: string, listener: (...args: never[]) => void): unknown
  listenerCount(event: string): number
  kill(pid: number, signal: NodeJS.Signals): boolean
}

/** Where a line or a decision goes when this plugin has something to say. */
export type MarkerReport = (message: string, level: 'warn' | 'debug') => void

/** The live marker's outcome. */
export interface MarkerHandle {
  readonly outcome: 'installed' | 'disabled'
  /** Directory holding `host-exit.log` and `hosts/`. */
  readonly dir: string
  /** This instance's identity, or the empty string when disabled. */
  readonly hostId: string
  /** The predecessors this boot reported as having died without a marker. */
  readonly reported: readonly number[]
  /** Stop recording and remove this instance's liveness record. */
  uninstall(): void
}

/** What installation depends on. */
export interface InstallOptions {
  readonly config: ResolvedHostExitMarkerConfig
  readonly report: MarkerReport
  readonly processRef?: ProcessLike
  readonly now?: () => Date
  readonly isAlive?: (pid: number) => boolean
  readonly randomId?: () => string
}

/** The file the process already writes startup diagnostics into. */
const LOG_NAME = 'host-exit.log'
/** Subdirectory of one liveness record per running instance. */
const HOSTS_DIR = 'hosts'

/**
 * The exit status a signal would have produced had nothing handled it.
 * @param signal - the signal being re-raised.
 * @returns `128 + the signal's number`, as a shell reports it.
 */
export function defaultExitCode(signal: MarkerSignal): number {
  return { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal]
}

/**
 * Install the marker for as long as the caller keeps the handle.
 * @param options - resolved configuration plus the injected seams.
 * @returns the handle; `uninstall()` removes every listener and the record.
 */
export function installProcessMarker(options: InstallOptions): MarkerHandle {
  const { config, report } = options
  const proc = options.processRef ?? process
  const now = options.now ?? (() => new Date())
  const isAlive = options.isAlive ?? isProcessAlive
  const randomId = options.randomId ?? (() => randomBytes(4).toString('hex'))

  if (!config.enabled) {
    return { outcome: 'disabled', dir: config.dir, hostId: '', reported: [], uninstall() {} }
  }

  const logPath = join(config.dir, LOG_NAME)
  const hostsDir = join(config.dir, HOSTS_DIR)
  const startedAt = now()

  const append = (event: string, fields: Readonly<Record<string, LineFieldValue>> = {}): void => {
    // A marker that throws during a shutdown would turn a clean exit into a
    // noisy one, so every write is best-effort — but a failure is reported once,
    // because a marker quietly writing nothing is worse than no marker.
    try {
      appendFileSync(logPath, formatLine(now(), event, fields))
    } catch (error) {
      warnOnce(`could not append to ${logPath}: ${describe(error)}`)
    }
  }

  const warned = new Set<string>()
  const warnOnce = (message: string): void => {
    if (warned.has(message)) return
    warned.add(message)
    report(`host-exit-marker: ${message}`, 'warn')
  }

  let hostId = randomId()
  let recordPath = join(hostsDir, `${proc.pid}-${hostId}.json`)

  try {
    mkdirSync(hostsDir, { recursive: true })
  } catch (error) {
    warnOnce(`could not create ${hostsDir}: ${describe(error)}`)
  }

  const reported = reportPredecessors()
  const record: LiveRecord = { pid: proc.pid, hostId, startedAt: startedAt.toISOString() }
  writeRecord(record)
  append('start', {
    pid: proc.pid,
    host: hostId,
    node: process.version,
    // Node's own accounting, which is the only start time that survives being
    // read from outside this process.
    startedAt: record.startedAt,
  })

  const listeners = new Map<MarkerSignal, () => void>()
  for (const signal of config.signals) {
    const listener = (): void => {
      const others = Math.max(0, proc.listenerCount(signal) - 1)
      append('signal', {
        signal,
        pid: proc.pid,
        host: hostId,
        uptime: uptimeSeconds(startedAt, now()),
        // Zero means nothing else would have acted on this signal, so this
        // plugin is the only reason the process is still alive — and it must
        // restore the behaviour it displaced. See `handleSignal`.
        others,
      })
      handleSignal(signal, others)
    }
    listeners.set(signal, listener)
    // `prependListener`, not `on`: the vendor's own handler starts disposal and
    // a repeated signal forces an immediate exit, so the line has to be written
    // before anything else in the process reacts.
    try {
      proc.prependListener(signal, listener)
    } catch (error) {
      warnOnce(`could not register ${signal}: ${describe(error)}`)
    }
  }

  const onExit = (code: number | undefined): void => {
    append('exit', {
      code: code ?? 0,
      pid: proc.pid,
      host: hostId,
      uptime: uptimeSeconds(startedAt, now()),
    })
    removeRecord()
  }
  try {
    proc.on('exit', onExit)
  } catch (error) {
    warnOnce(`could not register the exit hook: ${describe(error)}`)
  }

  let heartbeat: ReturnType<typeof setInterval> | undefined
  if (config.heartbeatMs > 0) {
    heartbeat = setInterval(() => {
      try {
        const stamp = now()
        utimesSync(recordPath, stamp, stamp)
      } catch {
        // A heartbeat that cannot stamp says nothing new on every beat; the
        // next boot then reports `lastAlive=unknown`, which is honest.
      }
    }, config.heartbeatMs)
    // A marker must never be the reason a process stays alive.
    heartbeat.unref?.()
  }

  let installed = true
  return {
    outcome: 'installed',
    dir: config.dir,
    hostId,
    reported,
    uninstall(): void {
      if (!installed) return
      installed = false
      append('unmount', { pid: proc.pid, host: hostId, uptime: uptimeSeconds(startedAt, now()) })
      for (const [signal, listener] of listeners) {
        try {
          proc.removeListener(signal, listener)
        } catch { /* the process object is already beyond caring */ }
      }
      try {
        proc.removeListener('exit', onExit)
      } catch { /* as above */ }
      if (heartbeat !== undefined) clearInterval(heartbeat)
      removeRecord()
    },
  }

  /**
   * Report every record whose process is gone, then drop it.
   *
   * This is the half a signal listener cannot reach: `SIGKILL`, a native crash
   * and a power cut produce no handler call at all, so the only trace of that
   * death is a record nobody removed — and the next boot is the one that can
   * still read it.
   */
  function reportPredecessors(): number[] {
    const dead: number[] = []
    let names: string[]
    try {
      names = readdirSync(hostsDir)
    } catch {
      return dead
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const path = join(hostsDir, name)
      let previous: LiveRecord
      try {
        previous = JSON.parse(readFileSync(path, 'utf8')) as LiveRecord
      } catch {
        // A record cut short by the very crash it was meant to describe.
        warnOnce(`unreadable liveness record ${name}, removing it`)
        try { unlinkSync(path) } catch { /* nothing left to do */ }
        continue
      }
      if (classifyPredecessor(previous, proc.pid, isAlive) === 'dead') {
        let lastAliveMs: number | undefined
        try { lastAliveMs = statSync(path).mtimeMs } catch { lastAliveMs = undefined }
        append('died-without-exit', deathFields(previous, lastAliveMs))
        try { unlinkSync(path) } catch { /* a stale record is not a failure */ }
        dead.push(previous.pid)
      }
    }
    return dead
  }

  function writeRecord(live: LiveRecord): void {
    const body = JSON.stringify(live)
    const temporary = `${recordPath}.tmp`
    try {
      // Written aside and renamed: a record is read by the *next* boot, which
      // must never see a half-written one.
      writeFileSync(temporary, body)
      renameSync(temporary, recordPath)
    } catch (error) {
      warnOnce(`could not write ${recordPath}: ${describe(error)}`)
    }
  }

  function removeRecord(): void {
    try {
      if (existsSync(recordPath)) unlinkSync(recordPath)
    } catch { /* the next boot reports it as a death, which is a fair reading */ }
  }

  /**
   * Restore what registering a listener displaced.
   *
   * Node removes a signal's default action as soon as the signal has a listener,
   * so a plugin that only listens would silently turn `SIGHUP` from "terminate"
   * into "ignore" — a behaviour change, and exactly the class of silent
   * difference this plugin exists to make visible. When nothing else would act
   * on the signal, the plugin re-raises it against itself and lets the default
   * action proceed.
   * @param signal - the signal that arrived.
   * @param others - listeners registered by anything else.
   */
  function handleSignal(signal: MarkerSignal, others: number): void {
    if (others > 0) return
    const own = listeners.get(signal)
    try {
      if (own !== undefined) proc.removeListener(signal, own)
      proc.kill(proc.pid, signal)
    } catch (error) {
      warnOnce(`could not re-raise ${signal}: ${describe(error)}`)
      // The default action is unavailable, so it is reproduced: the process ends
      // with the status a shell would have reported for this signal.
      process.exit(defaultExitCode(signal))
    }
  }
}

/**
 * One line of error text, without a stack the log does not need.
 * @param error - whatever was thrown.
 * @returns a short description.
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
