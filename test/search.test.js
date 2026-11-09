import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { registerSearch } from '../lib/search.mjs'

test('requests retain original rating and sender through queueing, replay, selection and revocation', async () => {
  const cfg = { enabled: true, ownerQQ: '11', allow: { groups: ['20', '21'], private: ['22'] } }
  const settings = { allowPrivateWhitelistSearch: true }
  const replies = [], sends = [], queries = []
  let handler, resolveFirst
  const first = new Promise(resolve => { resolveFirst = resolve })
  registerSearch({
    config: () => cfg, settings: () => settings, log: {}, onDispose() {}, on(_event, fn) { handler = fn },
    ask: ({ text }) => text === '普通图' ? first : Promise.resolve('{"intent":"search","rating":"e","chatId":"private:other","count":1}'),
    reply: async (msg, text) => replies.push([msg.messageId, text]),
    core: { hub: { sendSegments: async (id, data, _note, opts) => {
      if (opts.isCurrent()) sends.push([id, Buffer.from(data[0].data.file.slice(9), 'base64').toString()])
      return { message_id: 1 }
    } } },
  }, {
    search: async ({ rating }) => {
      queries.push(rating)
      return [{ url: rating, rating, score: 31, width: 10, height: 10, tags: [], post_url: 'https://yande.re/post/show/1' }]
    },
    download: async url => { if (url === 'q') cfg.allow.groups = []; return Buffer.from(url) },
  })
  const message = (messageId, text, userId = '11', groupId = '20') => ({ kind: 'group', chatId: `group:${groupId}`, groupId, userId, messageId, text })
  const wait = async (predicate) => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(5) }
    assert.fail('队列未完成')
  }
  const safe = message('1', 'yande找图 普通图')
  assert.equal(await handler(safe), true)
  await handler(message('2', 'yande找图 rating:e 先列候选'))
  await handler(safe)
  resolveFirst('{"intent":"search","rating":"e","source":"konachan"}')
  await wait(() => replies.length === 2)
  assert.deepEqual(queries, ['s', 'e'])
  assert.deepEqual(sends, [['group:20', 's']])
  await handler(message('3', 'yande找图 rating:e 发第1张', '12'))
  await handler(message('4', 'yande找图 rating:e 发第1张', '11', '21'))
  await wait(() => replies.length === 4)
  assert.equal(sends.length, 1)
  await handler(message('5', 'yande找图 rating:e 发第1张'))
  await wait(() => replies.length === 5)
  assert.deepEqual(sends.at(-1), ['group:20', 'e'])
  await handler(message('6', 'yande找图 rating:q 横图'))
  await wait(() => cfg.allow.groups.length === 0)
  assert.equal(sends.length, 2)
  settings.allowPrivateWhitelistSearch = false
  assert.equal(await handler({ kind: 'private', chatId: 'private:22', userId: '22', messageId: '7', text: 'yande找图 横图' }), false)
})
