const { Card, Btn } = ui

return function YandereConnection({ settings, draftSettings, setSettings }) {
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState(null)
  const proxyChanged = draftSettings.yandereProxyUrl === null || Boolean(draftSettings.yandereProxyUrl?.trim())

  async function test() {
    setBusy(true)
    setResult(null)
    try { setResult(await call('/test-connection', {})) }
    catch { setResult({ ok: false, message: '无法连接 Aurabot 检测接口' }) }
    finally { setBusy(false) }
  }

  return h(Card, { title: '检测 Yande.re 连接', desc: '使用保存的 Yande.re 代理检测作品列表和样图下载。' },
    h(Btn, { small: true, disabled: busy || proxyChanged, onClick: test }, busy ? '检测中…' : '检测连接'),
    (settings.yandereProxyUrlSet || proxyChanged) && draftSettings.yandereProxyUrl !== null ? h(Btn, {
      small: true, disabled: busy, onClick: () => {
        setSettings({ yandereProxyUrl: null, yandereProxyUrlSet: false })
        setResult(null)
      },
    }, '清除代理') : null,
    proxyChanged ? h('div', { className: 'ab-small ab-muted' }, '代理设置有改动，请先保存再检测。') : null,
    result && (result.ok
      ? h('div', { className: 'ab-small' }, h('div', null, result.proxyConfigured ? '使用代理' : '直连'),
        ...result.results.map(item => h('div', { key: item.host }, `${item.host} · ${item.message}`,
          item.image ? h('div', null, item.image.message) : null)))
      : h('div', { className: 'ab-note err' }, result.message || '检测失败')),
  )
}
