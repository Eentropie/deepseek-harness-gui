import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProviderLogo } from './ProviderLogo.tsx'

describe('ProviderLogo', () => {
  it('uses the DeepSeek whale for DeepSeek routes', () => {
    const markup = renderToStaticMarkup(<ProviderLogo provider="deepseek-official" />)
    expect(markup).toContain('data-provider-logo="deepseek"')
    expect(markup).toContain('aria-label="DeepSeek"')
    expect(markup).toContain('data-brand-shape="official"')
  })

  it('preserves the standard GPT knot while applying monochrome Harness styling', () => {
    const markup = renderToStaticMarkup(<ProviderLogo provider="codex-cli" />)
    expect(markup).toContain('data-provider-logo="harness-chatgpt"')
    expect(markup).toContain('data-brand-shape="original"')
    expect(markup).toContain('fill="currentColor"')
    expect(markup).toContain('M22.2819 9.8211')
    expect(markup).not.toContain('<img')
  })

  it('uses the original vendor silhouette with monochrome Harness styling', () => {
    const markup = renderToStaticMarkup(<ProviderLogo provider="anthropic" />)
    expect(markup).toContain('data-provider-logo="anthropic"')
    expect(markup).toContain('data-brand-shape="official"')
    expect(markup).toContain('<title>Anthropic</title>')
    expect(markup).toContain('fill="currentColor"')
  })

  it('covers every provider currently exposed by the Host without monograms', () => {
    const providers = [
      'amazon-bedrock', 'ant-ling', 'anthropic', 'azure-openai-responses', 'cerebras',
      'cloudflare-ai-gateway', 'cloudflare-workers-ai', 'deepseek', 'fireworks', 'github-copilot',
      'google', 'google-vertex', 'groq', 'huggingface', 'kimi-coding', 'minimax', 'minimax-cn',
      'mistral', 'moonshotai', 'moonshotai-cn', 'nvidia', 'openai', 'opencode', 'opencode-go',
      'openrouter', 'qwen-token-plan', 'qwen-token-plan-cn', 'together', 'vercel-ai-gateway', 'xai',
      'xiaomi', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'zai',
      'zai-coding-cn',
    ]

    for (const provider of providers) {
      const markup = renderToStaticMarkup(<ProviderLogo provider={provider} />)
      expect(markup, provider).not.toContain('api-generic')
    }
  })

  it('uses the compatible brain glyph for unknown custom gateways', () => {
    const markup = renderToStaticMarkup(<ProviderLogo provider="private-compatible-gateway" />)
    expect(markup).toContain('data-provider-logo="api-generic"')
    expect(markup).toContain('aria-label="private-compatible-gateway"')
  })

  it('distinguishes product-level vendor marks before their parent providers', () => {
    expect(renderToStaticMarkup(<ProviderLogo provider="cloudflare-workers-ai" />)).toContain('data-provider-logo="workers-ai"')
    expect(renderToStaticMarkup(<ProviderLogo provider="cloudflare-ai-gateway" />)).toContain('data-provider-logo="cloudflare"')
    expect(renderToStaticMarkup(<ProviderLogo provider="google-vertex" />)).toContain('data-provider-logo="vertex-ai"')
    expect(renderToStaticMarkup(<ProviderLogo provider="azure-openai-responses" />)).toContain('data-provider-logo="azure-ai"')
  })
})
