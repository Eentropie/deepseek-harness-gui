export type GreetingPeriod = 'early' | 'morning' | 'afternoon' | 'evening' | 'late'

const GREETINGS: Record<GreetingPeriod, readonly string[]> = {
  early: [
    'Early start. What shall we uncover?',
    'The day is new. Where should we begin?',
    'A quiet start is good for deep thinking.',
    'What is worth exploring first today?',
  ],
  morning: [
    'Good morning. What should we reason through?',
    'Ready for a clear first step?',
    "Let's turn this morning's idea into something real.",
    'Where should we dive deep this morning?',
  ],
  afternoon: [
    'Good afternoon. What should we solve next?',
    "Let's take the next problem apart.",
    'What deserves a deeper look this afternoon?',
    'Ready to move the work forward?',
  ],
  evening: [
    'Good evening. What should we build together?',
    "Let's make this evening's idea concrete.",
    'What should we refine before the day winds down?',
    'Ready for one more deep dive?',
  ],
  late: [
    "Still thinking? Let's work it through.",
    "Late-night idea? Let's make it precise.",
    'One more problem worth solving?',
    "Let's give that thought a clearer shape.",
  ],
}

const GREETINGS_ZH: Record<GreetingPeriod, readonly string[]> = {
  early: ['清晨适合深思。今天先探索什么？', '新的一天，从哪个问题开始？', '安静的清晨，适合把想法理清。'],
  morning: ['早上好。今天先推演什么？', '准备好从清晰的第一步开始了吗？', '把今早的想法变成现实吧。'],
  afternoon: ['下午好。接下来解决什么？', '把下一个问题逐层拆开吧。', '今天下午，什么值得再深入一点？'],
  evening: ['晚上好。我们一起构建什么？', '把今晚的想法做得更具体吧。', '天色渐晚，还有什么值得打磨？'],
  late: ['还在思考？我们一起理清它。', '深夜的想法，值得做得更精确。', '再解决一个值得解决的问题？'],
}

export function greetingPeriod(date: Date): GreetingPeriod {
  const hour = date.getHours()
  if (hour >= 5 && hour < 9) return 'early'
  if (hour >= 9 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'late'
}

export function chooseGreeting(
  date: Date,
  previous?: string,
  random: () => number = Math.random,
  locale: 'en' | 'zh' = 'en',
): string {
  const pool = (locale === 'zh' ? GREETINGS_ZH : GREETINGS)[greetingPeriod(date)]
  const choices = pool.filter(greeting => greeting !== previous)
  const available = choices.length === 0 ? pool : choices
  const index = Math.min(available.length - 1, Math.floor(Math.max(0, random()) * available.length))
  return available[index] ?? pool[0] ?? 'What should we explore?'
}

export function greetingsFor(period: GreetingPeriod): readonly string[] {
  return GREETINGS[period]
}
