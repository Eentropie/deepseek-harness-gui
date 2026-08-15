import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import { normalizeDeepSeekBalance, validateDeepSeekApiKey } from '../server/billing-protocol.ts'
import type { DeepSeekBillingSnapshot } from '../src/lib/types.ts'

interface KeyState {
  configured: boolean
  key?: string
  source?: 'environment' | 'secure-storage'
  writable: boolean
  error?: string
}

function isMissingFile(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'ENOENT'
}

export class DeepSeekBillingService {
  constructor(private readonly credentialsFile: string) {}

  async snapshot(): Promise<DeepSeekBillingSnapshot> {
    const updatedAt = Date.now()
    const state = await this.keyState()
    const base = {
      configured: state.configured,
      ...(state.source === undefined ? {} : { source: state.source }),
      writable: state.writable,
      balances: [],
      updatedAt,
    }
    if (state.error !== undefined) return { ...base, error: state.error }
    if (state.key === undefined) return base
    try {
      const response = await fetch('https://api.deepseek.com/user/balance', {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${state.key}`,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
      })
      if (!response.ok) throw new Error(`DeepSeek balance request failed (HTTP ${response.status})`)
      const balance = normalizeDeepSeekBalance(await response.json() as unknown)
      return {
        ...base,
        balanceAvailable: balance.available,
        balances: balance.balances,
      }
    } catch (reason) {
      const message = reason instanceof Error && reason.message.startsWith('DeepSeek ')
        ? reason.message
        : 'DeepSeek balance request could not be completed'
      return { ...base, error: message }
    }
  }

  async setKey(value: string): Promise<DeepSeekBillingSnapshot> {
    if (process.env['DEEPSEEK_API_KEY']?.trim()) {
      throw new Error('The environment-owned DeepSeek API key cannot be replaced here')
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Operating-system secure credential storage is unavailable')
    }
    const key = validateDeepSeekApiKey(value)
    const encryptedKey = safeStorage.encryptString(key).toString('base64')
    await mkdir(dirname(this.credentialsFile), { recursive: true, mode: 0o700 })
    const temporaryFile = `${this.credentialsFile}.${randomUUID()}.tmp`
    await writeFile(temporaryFile, JSON.stringify({ version: 1, encryptedKey }), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporaryFile, this.credentialsFile)
    return this.snapshot()
  }

  async removeKey(): Promise<DeepSeekBillingSnapshot> {
    if (process.env['DEEPSEEK_API_KEY']?.trim()) {
      throw new Error('The environment-owned DeepSeek API key cannot be removed here')
    }
    try {
      await unlink(this.credentialsFile)
    } catch (reason) {
      if (!isMissingFile(reason)) throw reason
    }
    return this.snapshot()
  }

  private async keyState(): Promise<KeyState> {
    const environmentKey = process.env['DEEPSEEK_API_KEY']?.trim()
    if (environmentKey !== undefined && environmentKey !== '') {
      try {
        return {
          configured: true,
          key: validateDeepSeekApiKey(environmentKey),
          source: 'environment',
          writable: false,
        }
      } catch {
        return {
          configured: true,
          source: 'environment',
          writable: false,
          error: 'The environment-owned DeepSeek API key has an invalid format',
        }
      }
    }
    if (!safeStorage.isEncryptionAvailable()) {
      return {
        configured: false,
        writable: false,
        error: 'Operating-system secure credential storage is unavailable',
      }
    }
    try {
      const stored = JSON.parse(await readFile(this.credentialsFile, 'utf8')) as { encryptedKey?: unknown }
      if (typeof stored.encryptedKey !== 'string') throw new Error('Stored billing credential is invalid')
      const key = validateDeepSeekApiKey(safeStorage.decryptString(Buffer.from(stored.encryptedKey, 'base64')))
      return { configured: true, key, source: 'secure-storage', writable: true }
    } catch (reason) {
      if (isMissingFile(reason)) return { configured: false, writable: true }
      return {
        configured: false,
        writable: true,
        error: 'The saved DeepSeek billing credential could not be decrypted',
      }
    }
  }
}
