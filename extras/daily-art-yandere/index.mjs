export default {
  id: 'daily-art-yandere',
  name: 'Yande.re 推图',
  version: '1.0.0',
  api: 1,
  panel: 'panel.js',
  description: '独立设置 Yande.re 的定时推送和代理。QQ 中使用「yande找图」。',
  defaults: {
    enabled: false, pushTimes: '09:00\n17:00', pushCount: 5, groupWhitelist: '', privateWhitelist: '', yandereProxyUrl: '',
    pushMinScore: 31, pushMaxScore: '', pushTags: '', pushExcludeTags: '', pushRating: 's',
    pushMinWidth: 0, pushMinHeight: 0, pushOrientation: 'any', pushSort: 'newest', pushAdvanced: '',
  },
  settings: [
    { key: 'enabled', label: '开启 Yande.re 定时推送', type: 'switch', hint: '开启后会向下方名单补发当天已错过的时段。' },
    { key: 'pushTimes', label: '每日推送时间（北京时间）', type: 'textarea', placeholder: '09:00\n17:00', hint: '24 小时制 HH:mm。每行一个，也可用逗号分隔。留空使用默认时间。' },
    { key: 'pushCount', label: '每批图片数', type: 'number', min: 1, max: 10, hint: '每批 1–10 张，留空使用 5 张。' },
    { key: 'groupWhitelist', label: '群聊推送白名单', type: 'textarea', hint: '填写 QQ 群号，每行一个，也可用逗号分隔。' },
    { key: 'privateWhitelist', label: '私聊推送白名单', type: 'textarea', hint: '填写接收推送的 QQ 号，每行一个，也可用逗号分隔。' },
    { key: 'yandereProxyUrl', label: 'Yande.re 代理地址', type: 'password', placeholder: 'http://host.docker.internal:7890', hint: 'API 和图片下载共用。未设置时直连，保存后再检测。' },
    { key: 'pushMinScore', label: '最低评分', type: 'number', hint: '包含该分数，留空使用 31。' },
    { key: 'pushMaxScore', label: '最高评分', type: 'number', hint: '包含该分数，留空不限制。' },
    { key: 'pushTags', label: '包含标签', type: 'textarea', placeholder: 'hatsune_miku, landscape', hint: '最多 5 个英文标签，需全部匹配。空格、换行或逗号分隔。' },
    { key: 'pushExcludeTags', label: '排除标签', type: 'textarea', hint: '最多 5 个英文标签，匹配任意一个即跳过。' },
    { key: 'pushRating', label: '内容分级', type: 'select', options: [{ value: 's', label: 'Safe（s）' }] },
    { key: 'pushMinWidth', label: '最小宽度（px）', type: 'number', min: 0 },
    { key: 'pushMinHeight', label: '最小高度（px）', type: 'number', min: 0 },
    { key: 'pushOrientation', label: '画幅', type: 'select', options: [
      { value: 'any', label: '不限' }, { value: 'landscape', label: '横图' }, { value: 'portrait', label: '竖图' }, { value: 'square', label: '方图' },
    ] },
    { key: 'pushSort', label: '排序方式', type: 'select', options: [
      { value: 'newest', label: '最新优先' }, { value: 'oldest', label: '最早优先' },
      { value: 'score', label: '评分从高到低' }, { value: 'score_asc', label: '评分从低到高' },
      { value: 'resolution', label: '分辨率从高到低' }, { value: 'resolution_asc', label: '分辨率从低到高' },
    ] },
    { key: 'pushAdvanced', label: 'Yande.re 高级筛选', type: 'textarea', placeholder: 'ratio:16:9 mpixels:2.5..', hint: '可用 id、width、height、mpixels、ratio、date、parent、user、source、md5、vote。宽高不能与上方相应的下限重复。' },
  ],
  setup(api) {
    api.route('/test-connection', req => {
      if (req.method !== 'POST') return { ok: false, message: '请使用面板的检测按钮' }
      const dailyArt = api.use('daily-art')
      return dailyArt?.probeYandere?.() ?? { ok: false, message: '请安装并启用 daily-art 1.7.0 或以上版本' }
    })
    return { settings: api.settings }
  },
}
