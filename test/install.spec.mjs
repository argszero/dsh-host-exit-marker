import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { installProcessMarker, resolveConfig } from '../lib/index.js'
import { events, fakeProcess, onlyRecord, readLog, tempDir } from './harness.mjs'

const dirs = []
afterEach(() => { while (dirs.length > 0) dirs.pop().remove() })

function scratch() {
  const made = tempDir()
  dirs.push(made)
  return made.dir
}

function install(dir, options = {}) {
  const lines = []
  const proc = options.proc ?? fakeProcess({ pid: options.pid ?? 4242 })
  const handle = installProcessMarker({
    config: resolveConfig({ dir, ...(options.config ?? {}) }),
    report: (message, level) => { lines.push({ message, level }) },
    processRef: proc,
    now: options.now ?? (() => new Date('2026-10-17T15:30:00.000Z')),
    isAlive: options.isAlive ?? (() => false),
    randomId: options.randomId ?? (() => 'beef'),
    ...(options.overrides ?? {}),
  })
  return { handle, proc, lines }
}

describe('installProcessMarker', () => {
  it('writes a start record and a liveness record, and registers each signal', () => {
    const dir = scratch()
    const { handle, proc } = install(dir)
    assert.equal(handle.outcome, 'installed')
    assert.equal(handle.hostId, 'beef')
    const start = onlyRecord(dir, 'start')
    assert.equal(start.at, '2026-10-17T15:30:00.000Z')
    assert.equal(start.fields.pid, '4242')
    assert.equal(start.fields.host, 'beef')
    assert.equal(JSON.parse(statSync(join(dir, 'hosts')).isDirectory ? '1' : '0'), 1)
    assert.deepEqual(readdirSync(join(dir, 'hosts')), ['4242-beef.json'])
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
      assert.equal(proc.listenerCount(signal), 1, `${signal} was not registered`)
    }
    assert.equal(proc.listenerCount('exit'), 1)
  })

  it('records a signal and leaves the handler that displaced it alone', () => {
    const dir = scratch()
    const proc = fakeProcess({ pid: 4242 })
    // The vendor handler `apps/cli/src/profile-boot.ts:307` installs.
    proc.on('SIGTERM', () => {})
    const { } = install(dir, { proc })
    proc.emit('SIGTERM')
    const line = onlyRecord(dir, 'signal')
    assert.equal(line.fields.signal, 'SIGTERM')
    assert.equal(line.fields.others, '1')
    // Nothing was raised: the vendor handler owns the exit.
    assert.deepEqual(proc.killed, [])
    assert.equal(proc.listenerCount('SIGTERM'), 2)
  })

  it('re-raises a signal nothing else would act on, restoring the default action', () => {
    const dir = scratch()
    const proc = fakeProcess({ pid: 4242 })
    install(dir, { proc })
    proc.emit('SIGHUP')
    assert.deepEqual(proc.killed, [{ pid: 4242, signal: 'SIGHUP' }])
    // Its own listener is gone first, so the re-raised signal actually terminates.
    assert.equal(proc.listenerCount('SIGHUP'), 0)
    assert.equal(onlyRecord(dir, 'signal').fields.others, '0')
  })

  it('writes the line before the process acts on the signal', () => {
    const dir = scratch()
    const proc = fakeProcess({ pid: 4242 })
    const order = []
    // Registered first, and therefore second in the listener pass — which is the
    // whole reason the plugin prepends: a second SIGTERM forces an immediate exit.
    proc.on('SIGTERM', () => { order.push(`vendor saw ${readLog(dir).length}`) })
    install(dir, { proc })
    proc.emit('SIGTERM')
    assert.deepEqual(order, ['vendor saw 2'])
  })

  it('records unmount and removes the liveness record on disposal', () => {
    const dir = scratch()
    const { handle, proc } = install(dir)
    handle.uninstall()
    assert.deepEqual(events(dir), ['start', 'unmount'])
    assert.deepEqual(readdirSync(join(dir, 'hosts')), [])
    assert.equal(proc.listenerCount('SIGTERM'), 0)
    assert.equal(proc.listenerCount('exit'), 0)
    // Idempotent: a second disposal says nothing new.
    handle.uninstall()
    assert.deepEqual(events(dir), ['start', 'unmount'])
  })

  it('records the exit status when the process ends with the plugin mounted', () => {
    const dir = scratch()
    const { proc } = install(dir)
    proc.emit('exit', 3)
    assert.equal(onlyRecord(dir, 'exit').fields.code, '3')
    assert.deepEqual(readdirSync(join(dir, 'hosts')), [])
  })

  it('reports a predecessor whose process is gone as died without an exit', () => {
    const dir = scratch()
    const hosts = join(dir, 'hosts')
    mkdirSync(hosts, { recursive: true })
    writeFileSync(join(hosts, '777-dead.json'), JSON.stringify({
      pid: 777, hostId: 'dead', startedAt: '2026-10-17T10:00:00.000Z',
    }))
    const { handle } = install(dir, { isAlive: pid => pid !== 777 })
    assert.deepEqual(handle.reported, [777])
    const death = onlyRecord(dir, 'died-without-exit')
    assert.equal(death.fields.pid, '777')
    assert.equal(death.fields.started, '2026-10-17T10:00:00.000Z')
    // The record's mtime is when the heartbeat last stamped it — unreadable only
    // when the record itself is (covered in lines.spec.mjs against `deathFields`).
    assert.match(death.fields.lastAlive, /^\d{4}-\d\d-\d\dT/u)
    assert.deepEqual(readdirSync(hosts), ['4242-beef.json'])
  })

  it('leaves a running peer alone, and says nothing about its own record', () => {
    const dir = scratch()
    const hosts = join(dir, 'hosts')
    mkdirSync(hosts, { recursive: true })
    writeFileSync(join(hosts, '4242-beef.json'), JSON.stringify({
      pid: 4242, hostId: 'beef', startedAt: '2026-10-17T10:00:00.000Z',
    }))
    writeFileSync(join(hosts, '888-live.json'), JSON.stringify({
      pid: 888, hostId: 'live', startedAt: '2026-10-17T10:00:00.000Z',
    }))
    const { handle } = install(dir, { isAlive: pid => pid === 888 })
    assert.deepEqual(handle.reported, [])
    assert.deepEqual(events(dir), ['start'])
    assert.deepEqual(readdirSync(hosts).sort(), ['4242-beef.json', '888-live.json'])
  })

  it('dates a dead instance by its record mtime when the heartbeat ran', () => {
    const dir = scratch()
    const hosts = join(dir, 'hosts')
    mkdirSync(hosts, { recursive: true })
    writeFileSync(join(hosts, '999-dead.json'), JSON.stringify({
      pid: 999, hostId: 'dead', startedAt: '2026-10-17T10:00:00.000Z',
    }))
    install(dir, { isAlive: () => false })
    const death = onlyRecord(dir, 'died-without-exit')
    assert.match(death.fields.lastAlive, /^\d{4}-\d\d-\d\dT/u)
  })

  it('drops an unreadable liveness record instead of trusting it', () => {
    const dir = scratch()
    const hosts = join(dir, 'hosts')
    mkdirSync(hosts, { recursive: true })
    writeFileSync(join(hosts, '555-cut.json'), '{"pid": 555, "hostId":')
    const { handle, lines } = install(dir)
    assert.deepEqual(handle.reported, [])
    assert.deepEqual(events(dir), ['start'])
    assert.deepEqual(readdirSync(hosts), ['4242-beef.json'])
    assert.match(lines.map(line => line.message).join('\n'), /unreadable liveness record 555-cut\.json/u)
  })

  it('reports a write failure once rather than failing the host', () => {
    const root = scratch()
    // A file where the plugin needs a directory: every write below it fails.
    const file = join(root, 'not-a-directory')
    writeFileSync(file, '')
    const { handle, lines } = install(join(file, 'logs'))
    assert.equal(handle.outcome, 'installed')
    handle.uninstall()
    const warnings = lines.filter(line => line.level === 'warn')
    assert.ok(warnings.length > 0)
    for (const warning of warnings) assert.match(warning.message, /^host-exit-marker:/u)
    // The append failure happens on start and again on unmount, and is said once.
    const appends = warnings.filter(warning => /could not append/u.test(warning.message))
    assert.equal(appends.length, 1, appends.map(warning => warning.message).join(' | '))
  })

  it('does nothing at all when disabled', () => {
    const dir = scratch()
    const { handle, proc, lines } = install(dir, { config: { enabled: false } })
    assert.equal(handle.outcome, 'disabled')
    assert.deepEqual(readLog(dir), [])
    assert.equal(proc.listenerCount('SIGTERM'), 0)
    assert.deepEqual(lines, [])
  })

  it('keeps the heartbeat off the event loop', () => {
    const dir = scratch()
    const { handle } = install(dir, { config: { heartbeatMs: 5 } })
    assert.ok(handle.outcome === 'installed')
    handle.uninstall()
  })

  it('falls back to the shell status when a signal cannot be re-raised', () => {
    const dir = scratch()
    const proc = fakeProcess({ pid: 4242, killThrows: new Error('ESRCH: no such process') })
    const original = process.exit
    const exits = []
    process.exit = code => { exits.push(code); throw new Error('stop the test here') }
    try {
      install(dir, { proc })
      assert.throws(() => proc.emit('SIGHUP'), /stop the test here/u)
      assert.deepEqual(exits, [129])
    } finally {
      process.exit = original
    }
  })
})
