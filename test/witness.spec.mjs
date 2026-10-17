/**
 * The witness: a real child process, a real signal, and the files it leaves.
 *
 * Every other spec injects the process object, because a fake is the only way to
 * pin *what* was registered. This one exists because two claims cannot be checked
 * against a fake at all:
 *
 * 1. **The default action is restored.** Node stops applying a signal's default
 *    behaviour the moment the signal has a listener, so a plugin that only
 *    listened would turn `SIGHUP` from "terminate" into "ignore" and keep the
 *    host alive forever. Only a real process shows which of the two happened.
 * 2. **The line is on disk before the process dies.** A fake listener is called
 *    back synchronously and proves nothing about ordering against a death the
 *    kernel performs.
 *
 * And the case no handler can reach: a `SIGKILL` leaves the liveness record
 * behind, so the next boot is the only thing that can report it.
 *
 * @module test/witness
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, describe, it } from 'node:test'

import { installProcessMarker, resolveConfig } from '../lib/index.js'
import { readLog } from './harness.mjs'

const ENTRY = pathToFileURL(join(import.meta.dirname, '..', 'lib', 'index.js')).href

/**
 * Write the program a witness child runs: mount the marker, then say it is ready.
 * @param dir - the marker directory to record into.
 * @returns the path of the program, inside `dir`.
 */
function writeChild(dir) {
  const path = join(dir, 'child.mjs')
  writeFileSync(path, `
import { apply } from ${JSON.stringify(ENTRY)}
const silence = { warn() {}, debug() {} }
apply({ logger: silence, effect: register => register(() => () => {}) }, { dir: ${JSON.stringify(dir)} })
// Node unrefs its signal handles, so handlers alone do not keep a process
// alive; a real host is busy for its own reasons, and this stands in for that.
setTimeout(() => {}, 60000)
process.stdout.write('ready\\n')
`)
  return path
}

/**
 * Start a witness child and resolve once it says it is ready.
 * @param program - the path of the program to run.
 * @returns the child, already past its mount.
 */
function startChild(program) {
  const child = spawn(process.execPath, [program], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr.resume()
  const ready = new Promise((resolve, reject) => {
    let seen = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      seen += chunk
      if (seen.includes('ready\n')) resolve(child)
    })
    child.once('exit', (code, signal) => reject(
      new Error(`child exited before mounting: code=${code} signal=${signal}`),
    ))
  })
  return { child, ready }
}

/** Wait for a child to leave, as `{ code, signal }`. */
function leave(child) {
  return new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
}

describe('a real host process', () => {
  const scratch = []
  const makeDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-exit-marker-witness-'))
    scratch.push(dir)
    return dir
  }
  after(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }) })

  it('writes the line before a SIGTERM nothing else handles, and still dies of it', async () => {
    const dir = makeDir()
    const { child, ready } = startChild(writeChild(dir))
    await ready
    const gone = leave(child)
    child.kill('SIGTERM')
    const { code, signal } = await gone

    // The default action is what happened: killed by the signal, no exit status,
    // and therefore no `exit` line — the plugin changed nothing but the record.
    assert.equal(signal, 'SIGTERM')
    assert.equal(code, null)
    const lines = readLog(dir)
    const recorded = lines.find(line => line.event === 'signal')
    assert.ok(recorded, lines.map(line => line.raw).join('\n'))
    assert.equal(recorded.fields.signal, 'SIGTERM')
    assert.equal(recorded.fields.others, '0')
    assert.equal(recorded.fields.pid, String(child.pid))
    assert.equal(lines.some(line => line.event === 'exit'), false)
  })

  it('restores the default action for SIGHUP, which nothing in the child handles', async () => {
    const dir = makeDir()
    const { child, ready } = startChild(writeChild(dir))
    await ready
    const gone = leave(child)
    child.kill('SIGHUP')
    const { signal } = await gone

    // Without the re-raise this would hang: one listener is all it takes to turn
    // SIGHUP into an ignored signal, and nothing else in the child listens.
    assert.equal(signal, 'SIGHUP')
    assert.equal(readLog(dir).find(line => line.event === 'signal').fields.signal, 'SIGHUP')
  })

  it('leaves a record behind when killed outright, and the next boot reports it', async () => {
    const dir = makeDir()
    const { child, ready } = startChild(writeChild(dir))
    await ready
    const gone = leave(child)
    child.kill('SIGKILL')
    await gone

    // SIGKILL runs no handler at all, so the record the child wrote is still
    // there — and it is the only trace that process can leave.
    const hosts = join(dir, 'hosts')
    const name = readdirSync(hosts).find(entry => entry.startsWith(`${child.pid}-`))
    assert.ok(name, `no liveness record for pid ${child.pid}`)
    assert.equal(JSON.parse(readFileSync(join(hosts, name), 'utf8')).pid, child.pid)

    const handle = installProcessMarker({
      config: resolveConfig({ dir, log: 'silent', heartbeatMs: 0 }),
      report: () => {},
    })
    try {
      assert.deepEqual(handle.reported, [child.pid])
      const death = readLog(dir).filter(line => line.event === 'died-without-exit').at(-1)
      assert.equal(death.fields.pid, String(child.pid))
      assert.match(death.fields.lastAlive, /^\d{4}-\d\d-\d\dT/u)
      // Reported once: the record is gone, so a second boot has nothing to say.
      assert.equal(readdirSync(hosts).some(entry => entry.startsWith(`${child.pid}-`)), false)
    } finally {
      handle.uninstall()
    }
  })
})
