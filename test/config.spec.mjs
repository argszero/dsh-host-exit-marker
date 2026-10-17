import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_SIGNALS,
  HostExitMarkerConfigError,
  resolveConfig,
} from '../lib/index.js'

const clean = { DSH_EXIT_MARKER_DIR: undefined, DSH_HOME: undefined }

function withEnv(values, body) {
  const saved = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]))
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  try { return body() } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

describe('resolveConfig', () => {
  it('defaults every field, so an empty mount is valid', () => {
    const resolved = withEnv(clean, () => resolveConfig())
    assert.equal(resolved.enabled, true)
    assert.deepEqual(resolved.signals, [...DEFAULT_SIGNALS])
    assert.equal(resolved.heartbeatMs, DEFAULT_HEARTBEAT_MS)
    assert.equal(resolved.log, 'warn')
    assert.match(resolved.dir, /logs$/)
  })

  it('puts the log under the dsh home, beside the startup diagnostics', () => {
    const resolved = withEnv({ DSH_HOME: '/tmp/dsh-home' }, () => resolveConfig())
    assert.equal(resolved.dir, '/tmp/dsh-home/logs')
  })

  it('prefers an explicit directory over the environment', () => {
    const resolved = withEnv({ DSH_HOME: '/tmp/dsh-home', DSH_EXIT_MARKER_DIR: '/tmp/env-dir' }, () => resolveConfig())
    assert.equal(resolved.dir, '/tmp/env-dir')
    assert.equal(withEnv({ DSH_HOME: '/tmp/h', DSH_EXIT_MARKER_DIR: '/tmp/env-dir' }, () => resolveConfig({ dir: '/tmp/explicit' })).dir,
      '/tmp/explicit')
  })

  it('deduplicates the signal list and keeps the declared order', () => {
    const resolved = withEnv(clean, () => resolveConfig({ signals: ['SIGHUP', 'SIGTERM', 'SIGHUP'] }))
    assert.deepEqual(resolved.signals, ['SIGHUP', 'SIGTERM'])
  })

  it('accepts an empty signal list, which turns signal recording off', () => {
    assert.deepEqual(withEnv(clean, () => resolveConfig({ signals: [] })).signals, [])
  })

  it('accepts a zero heartbeat, which turns the heartbeat off', () => {
    assert.equal(withEnv(clean, () => resolveConfig({ heartbeatMs: 0 })).heartbeatMs, 0)
  })

  it('rejects a configuration it cannot honour', () => {
    const cases = [
      [{ enabled: 'yes' }, /enabled must be a boolean/u],
      [{ dir: '' }, /dir must be a non-empty string/u],
      [{ dir: '   ' }, /dir must be a non-empty string/u],
      [{ dir: 7 }, /dir must be a non-empty string/u],
      [{ log: 'loud' }, /log must be one of/u],
      [{ heartbeatMs: -1 }, /heartbeatMs must be/u],
      [{ heartbeatMs: Number.NaN }, /heartbeatMs must be/u],
      [{ heartbeatMs: '30' }, /heartbeatMs must be/u],
      [{ signals: ['SIGKILL'] }, /signals must be a list/u],
      [{ signals: 'SIGTERM' }, /signals must be a list/u],
    ]
    for (const [raw, pattern] of cases) {
      assert.throws(() => withEnv(clean, () => resolveConfig(raw)), error => {
        assert.ok(error instanceof HostExitMarkerConfigError, `${JSON.stringify(raw)} threw ${error.name}`)
        assert.match(error.message, pattern)
        return true
      })
    }
  })

  it('rejects a non-object configuration rather than guessing', () => {
    for (const raw of [null, 'mount-me', 3]) {
      assert.throws(() => resolveConfig(raw), HostExitMarkerConfigError)
    }
  })
})
