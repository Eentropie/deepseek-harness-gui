import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'activity'
  | 'agent'
  | 'brain'
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'copy'
  | 'document'
  | 'edit'
  | 'folder'
  | 'folder-plus'
  | 'lock'
  | 'moon'
  | 'more'
  | 'panel-left'
  | 'panel-right'
  | 'paperclip'
  | 'plus'
  | 'plug'
  | 'refresh'
  | 'search'
  | 'send'
  | 'settings'
  | 'sparkles'
  | 'stop'
  | 'sun'
  | 'terminal'
  | 'trash'
  | 'x'

const drawings: Record<IconName, ReactNode> = {
  activity: <><path d="M3 12h3l2-6 4 12 2-6h7" /></>,
  agent: <><circle cx="12" cy="7" r="2.5" /><circle cx="6" cy="16.5" r="2.5" /><circle cx="18" cy="16.5" r="2.5" /><path d="m10.5 9-3 5M13.5 9l3 5M8.5 16.5h7" /></>,
  brain: <><path d="M9.5 4.5A3 3 0 0 0 4 6a3 3 0 0 0 .7 5.9A3 3 0 0 0 8 17h1.5" /><path d="M14.5 4.5A3 3 0 0 1 20 6a3 3 0 0 1-.7 5.9A3 3 0 0 1 16 17h-1.5" /><path d="M9.5 4.5v15M14.5 4.5v15M7 9h2.5M14.5 9H17M7.5 14h2M14.5 14h2" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  'chevron-down': <path d="m7 10 5 5 5-5" />,
  'chevron-right': <path d="m10 7 5 5-5 5" />,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  document: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4.5" /></>,
  edit: <><path d="m4 16.5-.8 3.3 3.3-.8L18.8 6.7a2.3 2.3 0 0 0-3.3-3.3Z" /><path d="m14.5 4.5 3.3 3.3" /></>,
  folder: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />,
  'folder-plus': <><path d="M3 8A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5Z" /><path d="M12 11v5M9.5 13.5h5" /></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10M12 14v2" /></>,
  moon: <path d="M20 15.5A8.4 8.4 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  'panel-left': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  'panel-right': <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>,
  paperclip: <path d="m20.5 11.5-8.9 8.9a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2A2 2 0 0 1 6 14.8l8.5-8.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  plug: <><path d="M8 12V5M16 12V5M6 8h12v4a6 6 0 0 1-12 0ZM12 18v4" /><path d="M5 5h6M13 5h6" /></>,
  refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8.2A7 7 0 0 1 18.8 9L20 12M4 12l1.2 3A7 7 0 0 0 18 15.8" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2Z" /><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7Z" /><path d="m5 13 .8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8Z" /></>,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14" /><path d="M10 11v6M14 11v6" /></>,
  x: <path d="M6 6l12 12M18 6 6 18" />,
}

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 16, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {drawings[name]}
    </svg>
  )
}
