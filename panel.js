const { Card, Btn, Row, Select, Seg, Switch } = ui
const sources = [{ value: 'konachan', label: 'Konachan' }, { value: 'yandere', label: 'Yande.re' }]

function fieldControl(field, values, change) {
  const { key, type, label, options, min, max } = field
  const value = values[key]
  const placeholder = values[`${key}Set`] ? '已保存（不改就留空）' : field.placeholder
  if (type === 'switch') return h(Switch, { on: Boolean(value), onChange: change, title: label })
  if (type === 'select') return h(Select, { value, options, onChange: change, ariaLabel: label })
  if (type === 'multi-select') {
    const selected = Array.isArray(value) ? value : [value || 's']
    return h('div', { role: 'group', 'aria-label': label, style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
      ...options.map(option => {
        const checked = selected.includes(option.value)
        return h('label', { key: option.value }, h('input', { type: 'checkbox', checked, disabled: checked && selected.length === 1,
          onChange: () => change(checked ? selected.filter(item => item !== option.value) : [...selected, option.value]),
        }), ' ', option.label)
      }))
  }
  const props = { value: value ?? '', placeholder, 'aria-label': label, onChange: e => {
    const next = e.target.value
    change(type === 'number' && next !== '' ? Number(next) : next)
  } }
  if (type === 'textarea') return h('textarea', { ...props, className: 'ab-textarea' })
  return h('input', { ...props, type, min, max, className: 'ab-input', autoComplete: type === 'password' ? 'off' : undefined })
}

return function DailyArtPanel({ settings, draftSettings, setSettings }) {
  const [schema, setSchema] = React.useState(null)
  const [error, setError] = React.useState('')
  const [source, setSource] = React.useState('konachan')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState(null)

  React.useEffect(() => {
    let alive = true
    call('/settings-schema').then(data => {
      if (!alive) return
      if (data.ok) setSchema(data)
      else setError(data.message || '读取推图配置失败')
    }).catch(() => { if (alive) setError('读取推图配置失败') })
    return () => { alive = false }
  }, [])

  const proxyChanged = draftSettings.konachanProxyUrl === null || Boolean(draftSettings.konachanProxyUrl?.trim())
  const hasDraftKey = Boolean(draftSettings.konachanApiKey?.trim())
  const isKonachan = source === 'konachan'

  async function test() {
    setBusy(true)
    setResult(null)
    try {
      const credentials = isKonachan ? { konachanUsername: draftSettings.konachanUsername || '', konachanApiKey: draftSettings.konachanApiKey || '' } : {}
      setResult(await call(isKonachan ? '/test-konachan' : '/test-yandere', credentials))
    } catch {
      setResult({ ok: false, message: '无法连接 Aurabot 检测接口' })
    } finally { setBusy(false) }
  }

  const row = (field, values, change) => h(Row, { key: field.key, label: field.label, hint: field.hint }, fieldControl(field, values, change))
  const setShared = (key, value) => setSettings({ [key]: value })
  const setSourceField = (key, value) => isKonachan ? setShared(key, value) : setSettings({ yandere: { ...draftSettings.yandere, [key]: value } })
  const clear = (key) => { setSettings({ [key]: null, [`${key}Set`]: false }); setResult(null) }

  if (!schema) return h(Card, { title: '每日推图' }, error || '正在加载配置…')
  const values = isKonachan ? draftSettings : { ...schema.scheduleDefaults, ...draftSettings.yandere }
  const fields = schema.scheduleFields.map(field => field.key === 'pushRating'
    ? { ...field, options: schema.ratings[source], hint: isKonachan ? '当前 Konachan 安全站点仅返回 Safe。' : '可多选，图片匹配任一勾选分级即可。默认 Safe。' }
    : field)

  return h(React.Fragment, null,
    h(Card, { title: '共用网络设置', desc: 'Konachan 和 Yande.re 共用此代理。修改后点页面底部的「保存设置」。' },
      row(schema.proxyField, draftSettings, value => setShared(schema.proxyField.key, value)),
      (settings.konachanProxyUrlSet || proxyChanged) && draftSettings.konachanProxyUrl !== null
        ? h(Btn, { small: true, onClick: () => clear('konachanProxyUrl') }, '清除代理') : null,
      proxyChanged ? h('div', { className: 'ab-small ab-muted' }, '代理设置有改动，请先保存再检测。') : null),
    h(Card, { title: '图源配置', desc: '每个图源单独保存时间、张数、白名单和筛选条件。' },
      h(Seg, { value: source, options: sources, disabled: busy, onChange: value => { setSource(value); setResult(null) } }),
      ...fields.map(field => row(field, values, value => setSourceField(field.key, value))),
      ...(isKonachan ? schema.accountFields.map(field => row(field, draftSettings, value => setShared(field.key, value))) : []),
      isKonachan && (settings.konachanApiKeySet || hasDraftKey) && draftSettings.konachanApiKey !== null
        ? h(Btn, { small: true, onClick: () => clear('konachanApiKey') }, '清除密钥') : null,
      isKonachan && settings.konachanApiKeySet && !hasDraftKey && draftSettings.konachanApiKey !== null
        ? h('div', { className: 'ab-small ab-muted' }, '密钥不会回填。要用密钥检测，请再输入一次。') : null,
      h(Btn, { small: true, disabled: busy || proxyChanged, onClick: test }, busy ? '检测中…' : '检测连接'),
      result && (result.ok
        ? h('div', { className: 'ab-small' }, h('div', null, `${result.proxyConfigured ? '使用代理' : '直连'} · ${result.authenticatedRequest ? '优先尝试输入的密钥' : '公开接口'}`),
          ...result.results.map(item => h('div', { key: item.host }, `${item.host} · ${item.message}`,
            item.fallbackReason ? h('div', null, `已回退到公开接口（${item.fallbackReason}）`) : null,
            item.image ? h('div', null, item.image.message) : null)))
        : h('div', { className: 'ab-note err' }, result.message || '检测失败')),
    ),
  )
}
