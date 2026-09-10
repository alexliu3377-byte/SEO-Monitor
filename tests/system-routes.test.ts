import assert from 'node:assert/strict'
import test from 'node:test'
import { contentSystemPath, legacyContentRedirect } from '../lib/system-routes'

test('content system paths keep the dashboard under one namespace', () => {
  assert.equal(contentSystemPath('/'), '/content')
  assert.equal(contentSystemPath('/task-groups'), '/content/task-groups')
  assert.equal(contentSystemPath('settings'), '/content/settings')
})

test('legacy content routes preserve deep path segments when redirected', () => {
  assert.equal(legacyContentRedirect('/group-report'), '/content/group-report')
  assert.equal(
    legacyContentRedirect('/task-groups/8ad7a844-22d7-4fc8-b805-866e99413ca0'),
    '/content/task-groups/8ad7a844-22d7-4fc8-b805-866e99413ca0'
  )
})

test('system, API and already-prefixed paths are not legacy routes', () => {
  assert.equal(legacyContentRedirect('/'), null)
  assert.equal(legacyContentRedirect('/content/research'), null)
  assert.equal(legacyContentRedirect('/app-updates'), null)
  assert.equal(legacyContentRedirect('/api/sites'), null)
})
