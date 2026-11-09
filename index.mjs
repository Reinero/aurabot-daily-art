import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { downloadKonachanImage, konachanCredentials, probeKonachan, selectKonachan } from './konachan.mjs'
import { registerImageTools } from './image-tools.mjs'
import { konachanProxy, validateKonachanProxy } from './transport.mjs'

const time = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
const hours = [9, 17]
const count = 5
const retryMs = 5 * 60_000

function clock(now) {
  const parts = Object.fromEntries(time.formatToParts(now).map(({ type, value }) => [type, value]))
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}

function qqNumbers(input) {
  return String(input ?? '').split(/[\s,，;；]+/).filter(id => /^[1-9]\d{4,14}$/.test(id))
}

function targets(settings) {
  return new Set([
    ...qqNumbers(settings.groupWhitelist).map(id => `group:${id}`),
    ...qqNumbers(settings.privateWhitelist).map(id => `private:${id}`),
  ])
}

function pushFilters(settings) {
  const tagList = value => String(value ?? '').split(/[\s,，;；]+/).filter(Boolean)
  return {
    min_score: settings.pushMinScore === '' ? 31 : settings.pushMinScore ?? 31,
    max_score: settings.pushMaxScore === '' ? undefined : settings.pushMaxScore,
    tags: tagList(settings.pushTags),
    exclude_tags: tagList(settings.pushExcludeTags),
    min_width: settings.pushMinWidth === '' ? 0 : settings.pushMinWidth ?? 0,
    min_height: settings.pushMinHeight === '' ? 0 : settings.pushMinHeight ?? 0,
    rating: settings.pushRating || 's',
    orientation: settings.pushOrientation || 'any',
    sort: settings.pushSort || 'newest',
    advanced: settings.pushAdvanced || '',
  }
}

function readState(file, day) {
  let state
  try {
    state = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return { day, used: [], slots: {} }
  }
  if (!state || typeof state.day !== 'string' || !Array.isArray(state.used) || !state.slots || typeof state.slots !== 'object') {
    throw new Error('推送记录格式不正确，已停止发送以免重复')
  }
  return state.day === day ? state : { day, used: state.used, slots: {} }
}

function writeState(file, state) {
  const temp = `${file}.tmp-${process.pid}`
  writeFileSync(temp, JSON.stringify(state), { mode: 0o600 })
  renameSync(temp, file)
}

export function startDailyArt(api, { now = Date.now, select = selectKonachan, download = downloadKonachanImage } = {}) {
  const file = api.dataDir('delivery.json')
  const shutdown = new AbortController()
  const retryAt = new Map()
  let running = false
  let lastDay = ''

  function canSend(day) {
    const cfg = api.config()
    return !shutdown.signal.aborted && clock(now()).day === day && api.settings().enabled === true && cfg.enabled && !cfg.dryRun
  }

  async function deliver(day, hour, slot, proxyUrl) {
    const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(20_000)])
    const segments = await Promise.all(slot.images.map(async ({ url }) => {
      const bytes = await download(url, { proxyUrl, signal, log: api.log, operation: 'scheduled' })
      return { type: 'image', data: { file: `base64://${bytes.toString('base64')}` } }
    }))
    for (const chatId of Object.keys(slot.recipients)) {
      if (!canSend(day) || konachanProxy(api.settings()) !== proxyUrl) return
      if (!targets(api.settings()).has(chatId)) continue
      const state = readState(file, day)
      const recipient = state.slots[hour]?.recipients[chatId]
      if (recipient !== 'pending') continue

      // 先落盘。进程若在网关回执前中断，保留 sending，避免重启后发第二遍。
      state.slots[hour].recipients[chatId] = 'sending'
      writeState(file, state)
      let status = 'pending'
      try {
        const result = await api.core.hub.sendSegments(chatId, segments, `[每日推图 ${day} ${hour}:00]`, {
          throwOnError: true,
          timeoutMs: 60_000,
          isCurrent: () => canSend(day) && konachanProxy(api.settings()) === proxyUrl && targets(api.settings()).has(chatId),
        })
        if (result?.message_id != null) status = 'sent'
        else if (result != null) status = 'uncertain'
      } catch (error) {
        const definitelyFailed = !error.uncertain && !/超时|timeout|timed?\s*out/i.test(error.message) &&
          (error.transport || error.data?.status === 'failed' || Number(error.data?.retcode || 0) !== 0)
        if (!definitelyFailed) status = 'uncertain'
        api.log.warn(`${hour}:00 → ${chatId}：${error.message}${status === 'uncertain' ? '（结果不明，跳过重发）' : '（稍后重试）'}`)
      }

      // 等回执时可能热重载或跨日，合并进最新记录，不能覆盖另一轮的进度。
      const current = readState(file, clock(now()).day)
      if (current.day === day && current.slots[hour]?.recipients[chatId] === 'sending') {
        current.slots[hour].recipients[chatId] = status
        writeState(file, current)
      }
      if (status === 'sent') api.log.info(`${hour}:00 → ${chatId}：已推送 ${count} 张图片`)
    }
  }

  async function tick() {
    const { day, hour: currentHour } = clock(now())
    if (running || !canSend(day)) return
    running = true
    try {
      if (lastDay !== day) { retryAt.clear(); lastDay = day }
      for (const hour of hours) {
        if (currentHour < hour || !canSend(day)) break
        if (now() < (retryAt.get(hour) || 0)) continue
        const settings = api.settings()
        const proxyUrl = konachanProxy(settings)
        const eligible = targets(settings)
        if (!eligible.size) continue
        const state = readState(file, day)
        let slot = state.slots[hour]
        if (slot && ![...eligible].some(id => slot.recipients[id] === 'pending')) continue
        retryAt.set(hour, now() + retryMs)
        try {
          if (!slot) {
            const filters = pushFilters(settings)
            const credentials = konachanCredentials(settings)
            const images = await select(new Set(state.used), count, { signal: shutdown.signal, filters, credentials, proxyUrl, log: api.log, operation: 'scheduled' })
            if (!canSend(day)) break
            const latest = api.settings()
            const latestCredentials = konachanCredentials(latest)
            if (proxyUrl !== konachanProxy(latest) || JSON.stringify(filters) !== JSON.stringify(pushFilters(latest)) ||
              credentials.username !== latestCredentials.username || credentials.apiKey !== latestCredentials.apiKey) {
              retryAt.delete(hour)
              continue
            }
            const recipients = [...targets(latest)]
            if (!recipients.length) continue
            const current = readState(file, day)
            slot = current.slots[hour]
            if (!slot) {
              const used = new Set(current.used)
              if (images.some(({ key }) => used.has(key))) continue
              slot = { images, recipients: Object.fromEntries(recipients.map(id => [id, 'pending'])) }
              current.slots[hour] = slot
              current.used.push(...images.map(({ key }) => key))
              writeState(file, current)
            }
          }
          await deliver(day, hour, slot, proxyUrl)
        } catch (error) {
          if (!shutdown.signal.aborted) api.log.warn(`${hour}:00 推送未完成，稍后重试：${error.message}`)
        }
      }
    } finally { running = false }
  }

  api.onDispose(() => shutdown.abort())
  api.later(0, tick)
  api.every(15_000, tick, '每日推图')
  return tick
}

export default {
  id: 'daily-art',
  name: '每日推图',
  version: '1.5.2',
  api: 1,
  panel: 'panel.js',
  description: '每天北京时间 09:00 和 17:00 定时推图，支持 QQ 会话按需找图。',
  defaults: {
    enabled: false, groupWhitelist: '', privateWhitelist: '', konachanUsername: '', konachanApiKey: '', konachanProxyUrl: '',
    pushMinScore: 31, pushMaxScore: '', pushTags: '', pushExcludeTags: '', pushRating: 's',
    pushMinWidth: 0, pushMinHeight: 0, pushOrientation: 'any', pushSort: 'newest', pushAdvanced: '',
  },
  settings: [
    { key: 'enabled', label: '开启定时推送', type: 'switch', hint: '开启后会向下方名单补发当天已错过的时段。' },
    { key: 'groupWhitelist', label: '群聊推送白名单', type: 'textarea', hint: '填 QQ 群号，每行一个，也可用逗号分隔。留空时不推送到群聊。' },
    { key: 'privateWhitelist', label: '私聊推送白名单', type: 'textarea', hint: '填接收推送的 QQ 号，每行一个，也可用逗号分隔。主人也需填写。' },
    { key: 'konachanUsername', label: 'Konachan 用户名', type: 'text', hint: '使用个人 API Key 时填写 Konachan 账号用户名。' },
    { key: 'konachanApiKey', label: 'Konachan API Key', type: 'password', hint: '留空时使用公开接口。密钥无法认证时自动回退到公开接口。已保存的密钥会隐藏。' },
    { key: 'konachanProxyUrl', label: 'Konachan 代理地址', type: 'password', placeholder: 'http://host.docker.internal:7890', hint: '定时和按需的 API 请求及图片下载共用。未设置时直连。填好后保存再检测，已保存的地址会隐藏。' },
    { key: 'pushMinScore', label: '最低评分', type: 'number', hint: '包含该分数。留空按 31 处理，即评分大于 30。' },
    { key: 'pushMaxScore', label: '最高评分', type: 'number', hint: '包含该分数。留空不限制最高分。' },
    { key: 'pushTags', label: '包含标签', type: 'textarea', placeholder: 'hatsune_miku, landscape', hint: '最多 5 个英文站点标签。图片需同时匹配，空格、换行或逗号分隔。' },
    { key: 'pushExcludeTags', label: '排除标签', type: 'textarea', placeholder: 'swimsuit, text', hint: '最多 5 个英文站点标签，命中任意一个就跳过。' },
    { key: 'pushRating', label: '内容分级（rating）', type: 'select', options: [{ value: 's', label: 'Safe（s）' }], hint: '当前使用的 Konachan 安全站点仅返回 Safe。' },
    { key: 'pushMinWidth', label: '最小宽度（px）', type: 'number', min: 0, hint: '留空或填 0 不限制。' },
    { key: 'pushMinHeight', label: '最小高度（px）', type: 'number', min: 0, hint: '留空或填 0 不限制。' },
    { key: 'pushOrientation', label: '画幅', type: 'select', options: [
      { value: 'any', label: '不限' }, { value: 'landscape', label: '横图' }, { value: 'portrait', label: '竖图' }, { value: 'square', label: '方图' },
    ] },
    { key: 'pushSort', label: '排序方式', type: 'select', options: [
      { value: 'newest', label: '最新优先' }, { value: 'oldest', label: '最早优先' },
      { value: 'score', label: '评分从高到低' }, { value: 'score_asc', label: '评分从低到高' },
      { value: 'resolution', label: '分辨率从高到低' }, { value: 'resolution_asc', label: '分辨率从低到高' },
    ] },
    { key: 'pushAdvanced', label: 'Konachan 高级筛选', type: 'textarea', placeholder: 'ratio:16:9 mpixels:2.5..', hint: '可用 id、width、height、mpixels、ratio、date、parent、user、source、md5、vote，空格或换行分隔。宽高高级条件不能与上方相应的下限同时填写。' },
  ],
  setup(api) {
    startDailyArt(api)
    registerImageTools(api)
    const shutdown = new AbortController()
    api.onDispose(() => shutdown.abort())
    api.route('/test-konachan', async req => {
      if (req.method !== 'POST') return { ok: false, message: '请使用面板的检测按钮' }
      const input = await api.core.http.body(req)
      // 检测只使用这次提交的草稿，不从存储中读取密钥。
      const credentials = konachanCredentials(input || {})
      // 代理地址只能通过管理员保存设置，检测接口不接收任意目标地址。
      const proxyUrl = konachanProxy(api.settings())
      try { validateKonachanProxy(proxyUrl) } catch (error) { return { ok: false, message: error.message } }
      const results = await probeKonachan(credentials, { signal: shutdown.signal, proxyUrl, checkImage: true, log: api.log, operation: 'connection-test', trace: true })
      return { ok: true, authenticatedRequest: Boolean(credentials.apiKey), proxyConfigured: Boolean(proxyUrl), results }
    })
  },
}
