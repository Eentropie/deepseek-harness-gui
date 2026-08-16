import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pathBelongsToRoot, sanitizedTerminalEnvironment } from './terminal-policy.ts'

describe('terminal environment policy', () => {
  it('preserves toolchain variables and removes inherited credentials', () => {
    const result = sanitizedTerminalEnvironment({
      PATH: '/usr/bin',
      JAVA_HOME: '/opt/java',
      DEEPSEEK_API_KEY: 'deepseek-secret',
      GITHUB_TOKEN: 'github-secret',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      GOOGLE_APPLICATION_CREDENTIALS: '/tmp/google.json',
    })

    expect(result).toEqual({ PATH: '/usr/bin', JAVA_HOME: '/opt/java' })
  })

  it('accepts the workspace itself and descendants without accepting sibling prefixes', () => {
    const root = resolve('fixture-workspace')
    expect(pathBelongsToRoot(root, root)).toBe(true)
    expect(pathBelongsToRoot(root, resolve(root, 'src', 'App.tsx'))).toBe(true)
    expect(pathBelongsToRoot(root, resolve(`${root}-copy`, 'src'))).toBe(false)
    expect(pathBelongsToRoot(root, resolve(root, '..'))).toBe(false)
  })
})
