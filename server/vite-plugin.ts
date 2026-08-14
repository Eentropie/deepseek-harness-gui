import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { PluginController, PluginControlError } from './plugin-control.ts'

const BODY_LIMIT = 16 * 1024

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > BODY_LIMIT) throw new PluginControlError(413, '请求体过大')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new PluginControlError(400, '请求体不是有效 JSON')
  }
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function pluginControlPlugin(): Plugin {
  const controller = new PluginController()

  const middleware = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: (error?: unknown) => void,
  ): Promise<void> => {
    const path = new URL(request.url || '/', 'http://workbench.local').pathname
    if (!path.startsWith('/workbench/plugins')) {
      next()
      return
    }
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      send(response, 403, { error: '插件控制仅允许本机访问' })
      return
    }

    try {
      if (request.method === 'GET' && path === '/workbench/plugins') {
        send(response, 200, await controller.list())
        return
      }
      if (request.method === 'POST' && path === '/workbench/plugins/toggle') {
        if (request.headers['x-dsh-workbench'] !== '1') {
          throw new PluginControlError(403, '缺少本机 DeepSeek Harness 请求标记')
        }
        const body = await readJson(request)
        if (typeof body !== 'object' || body === null) throw new PluginControlError(400, '请求字段无效')
        const { entryId, enabled } = body as { entryId?: unknown; enabled?: unknown }
        if (typeof entryId !== 'string' || typeof enabled !== 'boolean') {
          throw new PluginControlError(400, 'entryId 和 enabled 字段无效')
        }
        send(response, 200, await controller.toggle(entryId, enabled))
        return
      }
      send(response, 405, { error: 'Method not allowed' })
    } catch (reason) {
      const status = reason instanceof PluginControlError ? reason.status : 500
      send(response, status, { error: messageOf(reason) })
    }
  }

  const install = (middlewares: { use: (handler: typeof middleware) => void }): void => {
    middlewares.use(middleware)
  }

  return {
    name: 'deepseek-workbench-plugin-control',
    configureServer(server) {
      install(server.middlewares)
    },
    configurePreviewServer(server) {
      install(server.middlewares)
    },
  }
}
