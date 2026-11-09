import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openVault, registerAdmin } from '../lib/admin.mjs'

test('migration separates credentials and does not resurrect an explicitly cleared secret', t => {
  const dir = mkdtempSync(join(tmpdir(), 'daily-art-vault-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const legacy = { ext: { 'daily-art': { konachanApiKey: 'fixture-key', konachanProxyUrl: 'http://user:pass@localhost:80', enabled: true } } }
  const api = { dataDir: name => join(dir, name), settings: () => legacy.ext['daily-art'] }
  const vault = openVault(api)
  assert.deepEqual(vault.migrate(legacy).ext['daily-art'], { enabled: true })
  assert.equal(JSON.parse(readFileSync(join(dir, 'credentials.json'), 'utf8')).konachanApiKey, 'fixture-key')
  vault.save({ konachanApiKey: '' })
  const reopened = openVault(api)
  reopened.migrate(legacy)
  assert.equal(reopened.settings().konachanApiKey, '')
})

test('owner-private pairing is single-use, protected, bounded, expires and revokes on owner change', async t => {
  const routes = new Map()
  const cfg = { ownerQQ: '11' }
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  let code, finishProbe
  const events = new Map()
  const probe = new Promise(resolve => { finishProbe = resolve })
  const api = { config: () => cfg, log: {}, route: (name, fn) => routes.set(name, fn),
    onDispose() {}, on: (event, fn) => events.set(event, fn), sendSegments: async (_, data) => {
      code = /[a-f0-9]{48}$/.exec(data[0].data.text)[0]
      return { message_id: 1 }
    } }
  const patch = []
  registerAdmin(api, { settings: () => ({}), status: () => ({}), save: value => patch.push(value) }, { probe: () => probe })
  const handler = events.get('message')
  const request = (path, body, headers = {}) => routes.get(path)({ method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost', ...headers },
    async *[Symbol.asyncIterator]() { yield JSON.stringify(body) } })
  const owner = { userId: '11', kind: 'private', chatId: 'private:11', text: '每日推图配对' }
  assert.equal(await handler({ ...owner, kind: 'group' }), false)
  assert.equal(await handler({ ...owner, userId: '12' }), false)
  assert.equal((await request('/credentials', { konachanApiKey: 'other' })).ok, false)
  await handler(owner)
  now += 120_001
  assert.equal((await request('/pair', { code })).ok, false)
  await handler(owner)
  assert.equal((await request('/pair', { code }, { origin: 'https://evil.example' })).ok, false)
  const paired = await request('/pair', { code })
  assert.equal(paired.ok, true)
  assert.equal((await request('/pair', { code })).ok, false)
  const { token } = paired
  assert.equal((await request('/credentials', { token, konachanApiKey: 'x'.repeat(5000) })).ok, false)
  assert.equal((await request('/credentials', { token, konachanApiKey: 'fixture' })).ok, true)
  assert.deepEqual(patch, [{ konachanApiKey: 'fixture' }])
  const active = request('/connection-test', { token, source: 'yandere' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await request('/connection-test', { token, source: 'yandere' })).ok, false)
  cfg.ownerQQ = '12'
  events.get('config')()
  finishProbe([])
  assert.equal((await active).ok, false)
  assert.equal((await request('/credentials', { token, konachanApiKey: '' })).ok, false)
  cfg.ownerQQ = '11'
  events.get('config')()
  assert.equal((await request('/credentials', { token })).ok, false)
  await handler(owner)
  const fresh = await request('/pair', { code })
  assert.equal(fresh.ok, true)
  now += 900_001
  assert.equal((await request('/credentials', { token: fresh.token })).ok, false)
})
