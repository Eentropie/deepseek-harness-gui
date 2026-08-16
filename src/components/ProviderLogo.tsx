import antGroupMark from '@lobehub/icons-static-svg/icons/antgroup.svg?raw'
import azureAiMark from '@lobehub/icons-static-svg/icons/azureai.svg?raw'
import bedrockMark from '@lobehub/icons-static-svg/icons/bedrock.svg?raw'
import cerebrasMark from '@lobehub/icons-static-svg/icons/cerebras.svg?raw'
import cloudflareMark from '@lobehub/icons-static-svg/icons/cloudflare.svg?raw'
import claudeMark from '@lobehub/icons-static-svg/icons/claude.svg?raw'
import cohereMark from '@lobehub/icons-static-svg/icons/cohere.svg?raw'
import copilotMark from '@lobehub/icons-static-svg/icons/githubcopilot.svg?raw'
import deepseekMark from '@lobehub/icons-static-svg/icons/deepseek.svg?raw'
import fireworksMark from '@lobehub/icons-static-svg/icons/fireworks.svg?raw'
import geminiMark from '@lobehub/icons-static-svg/icons/gemini.svg?raw'
import groqMark from '@lobehub/icons-static-svg/icons/groq.svg?raw'
import huggingFaceMark from '@lobehub/icons-static-svg/icons/huggingface.svg?raw'
import kimiMark from '@lobehub/icons-static-svg/icons/kimi.svg?raw'
import minimaxMark from '@lobehub/icons-static-svg/icons/minimax.svg?raw'
import mistralMark from '@lobehub/icons-static-svg/icons/mistral.svg?raw'
import moonshotMark from '@lobehub/icons-static-svg/icons/moonshot.svg?raw'
import nvidiaMark from '@lobehub/icons-static-svg/icons/nvidia.svg?raw'
import ollamaMark from '@lobehub/icons-static-svg/icons/ollama.svg?raw'
import opencodeMark from '@lobehub/icons-static-svg/icons/opencode.svg?raw'
import openrouterMark from '@lobehub/icons-static-svg/icons/openrouter.svg?raw'
import perplexityMark from '@lobehub/icons-static-svg/icons/perplexity.svg?raw'
import qwenMark from '@lobehub/icons-static-svg/icons/qwen.svg?raw'
import togetherMark from '@lobehub/icons-static-svg/icons/together.svg?raw'
import vercelMark from '@lobehub/icons-static-svg/icons/vercel.svg?raw'
import vertexAiMark from '@lobehub/icons-static-svg/icons/vertexai.svg?raw'
import vllmMark from '@lobehub/icons-static-svg/icons/vllm.svg?raw'
import workersAiMark from '@lobehub/icons-static-svg/icons/workersai.svg?raw'
import xaiMark from '@lobehub/icons-static-svg/icons/xai.svg?raw'
import xiaomiMimoMark from '@lobehub/icons-static-svg/icons/xiaomimimo.svg?raw'
import zaiMark from '@lobehub/icons-static-svg/icons/zai.svg?raw'
import { Icon } from './Icon.tsx'

interface ProviderLogoProps {
  provider?: string
  name?: string
  size?: number
  className?: string
}

interface BrandMatch {
  pattern: RegExp
  id: string
  label: string
  asset: string
}

/**
 * Provider marks are the original monochrome vendor silhouettes from Lobe Icons.
 * Only presentation is normalized here: currentColor, transparent background,
 * and a common square footprint. Product-specific matches must precede vendors.
 */
const BRAND_MATCHES: BrandMatch[] = [
  { pattern: /\bcloudflare[ -]?workers(?:[ -]?ai)?\b|\bworkers[ -]?ai\b/, id: 'workers-ai', label: 'Cloudflare Workers AI', asset: workersAiMark },
  { pattern: /\b(?:google[ -]?vertex|vertex[ -]?ai)\b/, id: 'vertex-ai', label: 'Google Vertex AI', asset: vertexAiMark },
  { pattern: /\b(?:azure[ -]?openai|azure[ -]?ai)\b/, id: 'azure-ai', label: 'Azure AI', asset: azureAiMark },
  { pattern: /\b(?:github[ -]?copilot|copilot)\b/, id: 'github-copilot', label: 'GitHub Copilot', asset: copilotMark },
  { pattern: /\b(?:amazon|aws|bedrock)\b/, id: 'amazon-bedrock', label: 'Amazon Bedrock', asset: bedrockMark },
  { pattern: /\b(?:ant[ -]?ling|antling|ant[ -]?group)\b/, id: 'ant-group', label: 'Ant Group Ling', asset: antGroupMark },
  { pattern: /\b(?:claude|anthropic)\b/, id: 'claude', label: 'Claude', asset: claudeMark },
  { pattern: /\bcloudflare\b/, id: 'cloudflare', label: 'Cloudflare', asset: cloudflareMark },
  { pattern: /\b(?:hugging[ -]?face|huggingface)\b/, id: 'hugging-face', label: 'Hugging Face', asset: huggingFaceMark },
  { pattern: /\b(?:kimi(?:[ -]?coding)?)\b/, id: 'kimi', label: 'Kimi', asset: kimiMark },
  { pattern: /\b(?:moonshot(?:ai)?)\b/, id: 'moonshot-ai', label: 'Moonshot AI', asset: moonshotMark },
  { pattern: /\b(?:gemini|google)\b/, id: 'google-gemini', label: 'Google Gemini', asset: geminiMark },
  { pattern: /\bdeepseek\b|深度求索/, id: 'deepseek', label: 'DeepSeek', asset: deepseekMark },
  { pattern: /\bminimax\b/, id: 'minimax', label: 'MiniMax', asset: minimaxMark },
  { pattern: /\bmistral\b/, id: 'mistral', label: 'Mistral AI', asset: mistralMark },
  { pattern: /\bnvidia\b/, id: 'nvidia', label: 'NVIDIA', asset: nvidiaMark },
  { pattern: /\bopenrouter\b/, id: 'openrouter', label: 'OpenRouter', asset: openrouterMark },
  { pattern: /\b(?:qwen|alibaba|dashscope)\b/, id: 'qwen', label: 'Qwen', asset: qwenMark },
  { pattern: /\bvercel\b/, id: 'vercel', label: 'Vercel', asset: vercelMark },
  { pattern: /\b(?:xiaomi|mimo)\b/, id: 'xiaomi-mimo', label: 'Xiaomi MiMo', asset: xiaomiMimoMark },
  { pattern: /\bollama\b/, id: 'ollama', label: 'Ollama', asset: ollamaMark },
  { pattern: /\bvllm\b/, id: 'vllm', label: 'vLLM', asset: vllmMark },
  { pattern: /\bperplexity\b/, id: 'perplexity', label: 'Perplexity', asset: perplexityMark },
  { pattern: /\bcerebras\b/, id: 'cerebras', label: 'Cerebras', asset: cerebrasMark },
  { pattern: /\bfireworks\b/, id: 'fireworks-ai', label: 'Fireworks AI', asset: fireworksMark },
  { pattern: /\bgroq\b/, id: 'groq', label: 'Groq', asset: groqMark },
  { pattern: /\b(?:together|togetherai)\b/, id: 'together-ai', label: 'Together AI', asset: togetherMark },
  { pattern: /\b(?:xai|grok)\b/, id: 'xai', label: 'xAI', asset: xaiMark },
  { pattern: /\b(?:zai|zhipu|glm)\b/, id: 'zai', label: 'Z.ai', asset: zaiMark },
  { pattern: /\bcohere\b/, id: 'cohere', label: 'Cohere', asset: cohereMark },
  { pattern: /\bopencode\b/, id: 'opencode', label: 'OpenCode', asset: opencodeMark },
]

function identity(provider: string | undefined, name: string | undefined): string {
  return `${provider ?? ''} ${name ?? ''}`.trim().toLowerCase().replaceAll('_', ' ').replaceAll('/', ' ')
}

function OfficialBrandMark({ asset, size }: { asset: string; size: number }) {
  return (
    <span
      className="provider-logo-brand-mark"
      style={{ width: size, height: size }}
      data-brand-shape="official"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: asset }}
    />
  )
}

function GptOriginalMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" data-brand-shape="original" aria-hidden="true">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654 2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  )
}

export function ProviderLogo({ provider, name, size = 18, className }: ProviderLogoProps) {
  const value = identity(provider, name)
  const fallbackLabel = name ?? provider ?? 'Model API'
  const classes = ['provider-logo', className].filter(Boolean).join(' ')

  const brand = BRAND_MATCHES.find(candidate => candidate.pattern.test(value))
  if (brand !== undefined) {
    return (
      <span className={classes} data-provider-logo={brand.id} style={{ width: size, height: size }} role="img" aria-label={brand.label}>
        <OfficialBrandMark asset={brand.asset} size={size} />
      </span>
    )
  }

  if (/\b(?:codex|chatgpt|openai|gpt(?:-[0-9])?)\b/.test(value)) {
    return (
      <span className={classes} data-provider-logo="harness-chatgpt" style={{ width: size, height: size }} role="img" aria-label="ChatGPT">
        <GptOriginalMark size={size} />
      </span>
    )
  }

  return (
    <span className={classes} data-provider-logo="api-generic" style={{ width: size, height: size }} role="img" aria-label={fallbackLabel}>
      <Icon name="brain" size={size} />
    </span>
  )
}
