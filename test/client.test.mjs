import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Load the built bundle the way dsh does: through its module loader envelope,
// with every `require` answered by an empty stub (no React is needed here).
const loadClient = () => {
  let exports
  globalThis.window = { __ModuleLoader__: { load: ({ factory }) => (exports = factory(() => ({}))) } }
  new Function(readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8'))()
  delete globalThis.window
  return exports
}
const { onPath, nextWord, normalizeDraft } = loadClient()

test('onPath accepts a prefix of the suggestion, ignoring case', () => {
  assert.equal(onPath('', 'yes, go ahead', true), true)
  assert.equal(onPath('yes', 'yes, go ahead', true), true)
  assert.equal(onPath('Yes, Go', 'yes, go ahead', true), true)
  assert.equal(onPath('no', 'yes, go ahead', true), false)
})

test('onPath lets the draft run ahead only while streaming', () => {
  assert.equal(onPath('yes, go ahead and', 'yes, go', false), true)
  assert.equal(onPath('yes, go ahead and', 'yes, go', true), false)
})

test('nextWord takes one word plus what follows it', () => {
  assert.equal(nextWord('run the tests'), 'run ')
  assert.equal(nextWord(', then commit'), ', then ')
  assert.equal(nextWord('tests'), 'tests')
})

test('normalizeDraft turns non-breaking spaces into plain ones', () => {
  assert.equal(normalizeDraft('a b'), 'a b')
})
