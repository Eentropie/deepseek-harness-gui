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
): string {
  const pool = GREETINGS[greetingPeriod(date)]
  const choices = pool.filter(greeting => greeting !== previous)
  const available = choices.length === 0 ? pool : choices
  const index = Math.min(available.length - 1, Math.floor(Math.max(0, random()) * available.length))
  return available[index] ?? pool[0] ?? 'What should we explore?'
}

export function greetingsFor(period: GreetingPeriod): readonly string[] {
  return GREETINGS[period]
}
