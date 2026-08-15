import WebSocket from 'ws'

const port = process.argv[2] ?? '9223'
const expression = process.argv[3]
if (expression === undefined) throw new Error('Usage: node scripts/cdp-eval.mjs <port> <expression>')
const pages = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json())
const page = pages.find(candidate => candidate.type === 'page')
if (page === undefined) throw new Error('No renderer page is available')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.once('open', resolve)
  socket.once('error', reject)
})
const id = 1
socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
const result = await new Promise((resolve, reject) => {
  socket.on('message', data => {
    const value = JSON.parse(String(data))
    if (value.id !== id) return
    if (value.error !== undefined) reject(new Error(value.error.message))
    else resolve(value)
  })
  socket.once('error', reject)
})
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
socket.close()
