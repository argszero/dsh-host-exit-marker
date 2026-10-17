import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyPredecessor,
  deathFields,
  defaultExitCode,
  formatLine,
  isProcessAlive,
  renderValue,
  uptimeSeconds,
} from '../lib/index.js'

const AT = new Date('2026-10-17T15:30:00.000Z')

describe('formatLine', () => {
  it('writes a timestamp, the event and its fields in order', () => {
    assert.equal(formatLine(AT, 'start', { pid: 12, host: 'ab' }), '2026-10-17T15:30:00.000Z start pid=12 host=ab\n')
  })

  it('writes an event with no fields without a trailing space', () => {
    assert.equal(formatLine(AT, 'unmount'), '2026-10-17T15:30:00.000Z unmount\n')
  })

  it('renders booleans as words', () => {
    assert.equal(formatLine(AT, 'x', { live: false }), '2026-10-17T15:30:00.000Z x live=false\n')
  })
})

describe('renderValue', () => {
  it('leaves a value without whitespace bare', () => {
    assert.equal(renderValue('ab12'), 'ab12')
    assert.equal(renderValue(7), '7')
  })

  it('quotes a value carrying whitespace, so one field stays one field', () => {
    assert.equal(renderValue('/Users/a b/logs'), '"/Users/a b/logs"')
  })

  it('quotes and escapes a value carrying a quote or a backslash', () => {
    assert.equal(renderValue('a"b'), '"a\\"b"')
    assert.equal(renderValue('a\\b'), '"a\\\\b"')
  })
})

describe('classifyPredecessor', () => {
  const record = { pid: 99, hostId: 'h', startedAt: AT.toISOString() }

  it('calls its own record self', () => {
    assert.equal(classifyPredecessor(record, 99, () => true), 'self')
    assert.equal(classifyPredecessor(record, 99, () => false), 'self')
  })

  it('calls a running peer other', () => {
    assert.equal(classifyPredecessor(record, 1, () => true), 'other')
  })

  it('calls a record whose process is gone dead', () => {
    assert.equal(classifyPredecessor(record, 1, () => false), 'dead')
  })
})

describe('isProcessAlive', () => {
  it('finds this process', () => {
    assert.equal(isProcessAlive(process.pid), true)
  })

  it('rejects an id nothing owns, and every nonsense id', () => {
    assert.equal(isProcessAlive(2 ** 22 + 12345), false)
    for (const pid of [0, -1, 1.5, Number.NaN]) assert.equal(isProcessAlive(pid), false)
  })
})

describe('uptimeSeconds', () => {
  it('counts whole seconds', () => {
    assert.equal(uptimeSeconds(new Date('2026-10-17T15:00:00Z'), new Date('2026-10-17T15:01:30.999Z')), 90)
  })

  it('never reports a negative uptime when the clock steps backwards', () => {
    assert.equal(uptimeSeconds(new Date('2026-10-17T15:01:30Z'), new Date('2026-10-17T15:00:00Z')), 0)
  })
})

describe('deathFields', () => {
  const record = { pid: 99, hostId: 'h', startedAt: '2026-10-17T15:00:00.000Z' }

  it('carries the instance identity and the last time it was seen alive', () => {
    assert.deepEqual(deathFields(record, Date.parse('2026-10-17T15:20:00.000Z')), {
      pid: 99,
      host: 'h',
      started: '2026-10-17T15:00:00.000Z',
      lastAlive: '2026-10-17T15:20:00.000Z',
    })
  })

  it('says unknown rather than guessing when the record has no readable mtime', () => {
    assert.equal(deathFields(record, undefined).lastAlive, 'unknown')
  })
})

describe('defaultExitCode', () => {
  it('reports what a shell would have reported for the signal', () => {
    assert.deepEqual([defaultExitCode('SIGHUP'), defaultExitCode('SIGINT'), defaultExitCode('SIGTERM')], [129, 130, 143])
  })
})
