const { Card, Btn } = ui

return function KonachanConnection({ settings, draftSettings, setSettings }) {
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState(null)
  const hasDraftKey = Boolean(draftSettings.konachanApiKey?.trim())
  const proxyChanged = draftSettings.konachanProxyUrl === null || Boolean(draftSettings.konachanProxyUrl?.trim())

  async function test() {
    setBusy(true)
    setResult(null)
    try {
      setResult(await call('/test-konachan', {
        konachanUsername: draftSettings.konachanUsername || '',
        konachanApiKey: draftSettings.konachanApiKey || '',
      }))
    } catch {
      setResult({ ok: false, message: '无法连接 Aurabot 检测接口' })
    } finally {
      setBusy(false)
    }
  }

  return h(Card, { title: '检测 Konachan 连接', desc: '用已保存的代理设置测试作品列表和样图下载。到「系统 → 日志」查看 HTTP 状态、Ray ID 和失败阶段。' },
    h(Btn, { small: true, disabled: busy || proxyChanged, onClick: test }, busy ? '检测中…' : '检测连接'),
    (settings.konachanProxyUrlSet || proxyChanged) && draftSettings.konachanProxyUrl !== null ? h(Btn, {
      small: true, disabled: busy, onClick: () => {
        setSettings({ konachanProxyUrl: null, konachanProxyUrlSet: false })
        setResult(null)
      },
    }, '清除代理') : null,
    proxyChanged ? h('div', { className: 'ab-small ab-muted' }, '代理设置有改动，请先保存再检测。') : null,
    (settings.konachanApiKeySet || hasDraftKey) && draftSettings.konachanApiKey !== null ? h(Btn, {
      small: true, disabled: busy, onClick: () => {
        setSettings({ konachanApiKey: null, konachanApiKeySet: false })
        setResult(null)
      },
    }, '清除密钥') : null,
    draftSettings.konachanApiKey === null ? h('div', { className: 'ab-small ab-muted' }, '保存设置后切回公开接口。') : null,
    settings.konachanApiKeySet && !hasDraftKey && draftSettings.konachanApiKey !== null
      ? h('div', { className: 'ab-small ab-muted' }, '已保存的密钥不会回填。要重新检测密钥，请再输入一次。') : null,
    result && (result.ok
      ? h('div', { className: 'ab-small' },
        h('div', null, `${result.proxyConfigured ? '使用代理' : '直连'} · ${result.authenticatedRequest ? '优先尝试输入的密钥' : '公开接口'}`),
        ...result.results.map(item => h('div', { key: item.host }, `${item.host} · ${item.message}`,
          item.fallbackReason ? h('div', null, `已回退到公开接口（${item.fallbackReason}）`) : null,
          item.image ? h('div', null, item.image.message) : null)))
      : h('div', { className: 'ab-note err' }, result.message || '检测失败')),
  )
}
