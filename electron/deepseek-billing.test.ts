import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const safeStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn(() => Buffer.from('encrypted')),
  decryptString: vi.fn(() => 'sk-legacy-key-1234567890'),
}))

vi.mock('electron', () => ({ safeStorage }))

import { DeepSeekBillingService } from './deepseek-billing.ts'

let temporaryRoot: string | undefined
const previousEnvironmentKey = process.env['DEEPSEEK_API_KEY']

afterEach(async () => {
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
  if (previousEnvironmentKey === undefined) delete process.env['DEEPSEEK_API_KEY']
  else process.env['DEEPSEEK_API_KEY'] = previousEnvironmentKey
  vi.restoreAllMocks()
})

describe('DeepSeek billing credential migration', () => {
  it('moves a legacy encrypted credential into the branded app directory', async () => {
    delete process.env['DEEPSEEK_API_KEY']
    temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-billing-'))
    const legacyFile = join(temporaryRoot, 'DeepSeek Workbench', 'billing-credentials.json')
    const currentFile = join(temporaryRoot, 'DeepSeek Harness', 'billing-credentials.json')
    await mkdir(join(temporaryRoot, 'DeepSeek Workbench'), { recursive: true })
    await writeFile(legacyFile, JSON.stringify({ version: 1, encryptedKey: 'legacy-ciphertext' }))

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      is_available: true,
      balance_infos: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    const snapshot = await new DeepSeekBillingService(currentFile, [legacyFile]).snapshot()

    expect(snapshot.configured).toBe(true)
    expect(snapshot.source).toBe('secure-storage')
    expect(snapshot.balanceAvailable).toBe(true)
    expect(await readFile(currentFile, 'utf8')).toContain('legacy-ciphertext')
    await expect(stat(legacyFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
