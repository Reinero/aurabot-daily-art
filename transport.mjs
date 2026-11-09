import { Agent, request } from 'node:https'
import { Readable } from 'node:stream'

export const konachanProxy = settings => String(settings.konachanProxyUrl ?? '').trim()

export function validateKonachanProxy(value) {
  if (!value) return
  let url
  try { url = new URL(value) } catch { throw new Error('代理地址格式不正确，请填写完整的 HTTP 或 HTTPS 地址') }
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('代理地址须为 http:// 或 https://，不带路径、查询参数或片段')
  }
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 24 || (major === 24 && minor < 5)) throw new Error('代理功能需要 Node.js 24.5 或更高版本')
}

export async function requestKonachan(url, { proxyUrl = '', signal } = {}) {
  const target = new URL(url)
  if (!['https://konachan.net', 'https://konachan.com'].includes(target.origin) || target.username || target.password) {
    throw new Error('请求地址不属于 Konachan')
  }
  validateKonachanProxy(proxyUrl)
  // 独立 Agent，空配置也不继承全局代理。连接失败时不绕过配置的代理。
  const agent = new Agent({ proxyEnv: proxyUrl ? { https_proxy: proxyUrl } : {} })
  return new Promise((resolve, reject) => {
    const req = request(target, { agent, signal, headers: { 'accept-encoding': 'identity' } }, res => {
      try {
        const status = res.statusCode
        const body = [204, 205, 304].includes(status) ? null : Readable.toWeb(res)
        if (!body) res.resume()
        resolve(new Response(body, { status, headers: res.headers }))
      } catch (error) {
        res.destroy()
        reject(error)
      }
    })
    req.on('close', () => agent.destroy())
    req.on('error', reject)
    req.end()
  })
}
