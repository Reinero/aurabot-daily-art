import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { normalize, publicConfig, registerSecretField } from '../src/core/config.js'
import { createFakeDsh } from './helpers/fake-dsh.js'

test('daily-art credentials stay masked before any module is loaded', () => {
  const raw = normalize({ safeMode: true, modules: { 'daily-art': { enabled: false } }, ext: {
    'daily-art': { konachanApiKey: 'dummy-api-key', konachanProxyUrl: 'http://dummy-proxy:8888' },
    'daily-art-yandere': { yandereProxyUrl: 'http://dummy-legacy-proxy:8888' },
  } })
  const published = publicConfig(raw).ext
  assert.equal(published['daily-art'].konachanApiKey, '')
  assert.equal(published['daily-art'].konachanProxyUrl, '')
  assert.equal(published['daily-art-yandere'].yandereProxyUrl, '')
  assert.equal(published['daily-art'].konachanApiKeySet, true)
  registerSecretField(['ext', 'daily-art', 'konachanApiKey'])
  assert.equal(publicConfig(raw).ext['daily-art'].konachanApiKeySet, true)
})

test('daily-art diagnostics enforce host auth, body limit and single-flight', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-daily-art-host-'))
  const previous = process.env.AURABOT_DATA_DIR
  const previousPassword = process.env.AURABOT_PANEL_PASSWORD
  process.env.AURABOT_DATA_DIR = dir
  process.env.AURABOT_PANEL_PASSWORD = 'test-panel-password'
  const proxy = createServer()
  const sockets = new Set()
  let connected
  const began = new Promise(resolve => { connected = resolve })
  proxy.on('connect', (_req, socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
    connected()
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const fake = createFakeDsh({ brain: async () => '' })
  t.after(() => {
    for (const socket of sockets) socket.destroy()
    proxy.close()
    fake.dispose()
    if (previous === undefined) delete process.env.AURABOT_DATA_DIR
    else process.env.AURABOT_DATA_DIR = previous
    if (previousPassword === undefined) delete process.env.AURABOT_PANEL_PASSWORD
    else process.env.AURABOT_PANEL_PASSWORD = previousPassword
    rmSync(dir, { recursive: true, force: true })
  })
  mkdirSync(join(dir, 'modules'), { recursive: true })
  cpSync(fileURLToPath(new URL('../modules/daily-art', import.meta.url)), join(dir, 'modules', 'daily-art'), { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ enabled: false, ext: {
    'daily-art': { konachanProxyUrl: `http://127.0.0.1:${proxy.address().port}` },
  } }))
  const { apply } = await import('../src/host.js')
  const api = apply(fake.ctx)
  await api.ready
  const path = '/ext/daily-art/test-yandere'
  const headers = { authorization: `Basic ${Buffer.from('admin:test-panel-password').toString('base64')}` }
  assert.equal((await fake.call(path, {}, {}, '127.0.0.1')).status, 401)
  assert.equal((await fake.call(path, {}, headers, '203.0.113.7')).status, 403)
  assert.equal((await fake.call(path, { oversized: 'x'.repeat(4096) }, headers)).status, 413)
  // 前一个请求读完超限正文后也进入冷却窗口。
  await new Promise(resolve => setTimeout(resolve, 2050))
  const inFlight = fake.call(path, {}, headers)
  try {
    await began
    assert.equal((await fake.call(path, {}, headers)).status, 429)
  } finally {
    for (const socket of sockets) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
  }
  const completed = await inFlight
  assert.equal(completed.status, 200)
  assert.equal(completed.json().results[0].ok, false)
})
