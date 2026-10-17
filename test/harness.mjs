/**
 * Shared fixtures: a temp directory that cleans up after itself, a process object
 * that records what was registered instead of acting on it, and a way to read the
 * log back as records.
 *
 * The plugin's outward surface is the files it leaves plus the listeners it
 * registers, so the fakes stay small on purpose — the places where a real process
 * and a real signal *are* the point live in `witness.spec.mjs`.
 *
 * @module test/harness
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A directory under the OS temp root, removed by the returned disposer. */
export function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-exit-marker-'))
  return { dir, remove: () => { rmSync(dir, { recursive: true, force: true }) } }
}

/** Every `host-exit.log` line in `dir`, split into timestamp / event / fields. */
export function readLog(dir) {
  let text
  try {
    text = readFileSync(join(dir, 'host-exit.log'), 'utf8')
  } catch {
    return []
  }
  return text.split('\n').filter(line => line !== '').map((line) => {
    const [at, event, ...rest] = line.split(' ')
    const fields = {}
    for (const token of rest) {
      const equals = token.indexOf('=')
      fields[token.slice(0, equals)] = token.slice(equals + 1)
    }
    return { at, event, fields, raw: line }
  })
}

/** The events in `dir`'s log, in order. */
export function events(dir) {
  return readLog(dir).map(line => line.event)
}

/** The one record for `event`, asserting there is exactly one. */
export function onlyRecord(dir, event) {
  const found = readLog(dir).filter(line => line.event === event)
  if (found.length !== 1) throw new Error(`expected one ${event} record, got ${found.length}`)
  return found[0]
}

/**
 * A cordis-shaped process object: registers listeners, reports counts, and
 * records the signals it was asked to raise.
 * @param options - the pid, and whether `kill` should throw.
 */
export function fakeProcess(options = {}) {
  const base = options.pid ?? 4242
  /** @type {Map<string, Function[]>} */
  const listeners = new Map()
  const killed = []
  const list = (event) => {
    if (!listeners.has(event)) listeners.set(event, [])
    return listeners.get(event)
  }
  const proc = {
    pid: base,
    killed,
    uptime: () => 12.5,
    on(event, listener) { list(event).push(listener); return proc },
    prependListener(event, listener) { list(event).unshift(listener); return proc },
    removeListener(event, listener) {
      const current = list(event)
      const at = current.indexOf(listener)
      if (at >= 0) current.splice(at, 1)
      return proc
    },
    listenerCount(event) { return list(event).length },
    kill(pid, signal) {
      killed.push({ pid, signal })
      if (options.killThrows !== undefined) throw options.killThrows
      return true
    },
  }
  /** Fire one event's listeners in the order the process would run them. */
  proc.emit = (event, ...args) => {
    for (const listener of [...list(event)]) listener(...args)
  }
  /** Whether any listener is still registered for `event`. */
  proc.has = event => list(event).length > 0
  return proc
}
