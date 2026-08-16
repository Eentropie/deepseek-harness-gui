import { isAbsolute, relative, sep } from 'node:path'

const SENSITIVE_ENVIRONMENT_NAME = /(?:^|_)(?:API_?KEY|ACCESS_?KEY|AUTH|BEARER|CREDENTIALS?|PASSWORD|PASSWD|PRIVATE_?KEY|SECRET|SESSION|TOKEN)(?:_|$)/i

/** Check path containment without accepting sibling prefixes such as workspace-copy. */
export function pathBelongsToRoot(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
}

/** Preserve normal developer-tool configuration while withholding inherited credentials. */
export function sanitizedTerminalEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([name]) => {
    if (SENSITIVE_ENVIRONMENT_NAME.test(name)) return false
    return name !== 'GOOGLE_APPLICATION_CREDENTIALS'
  }))
}
