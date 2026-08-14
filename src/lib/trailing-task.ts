interface Flight {
  queued: boolean
  task: () => Promise<void>
  promise: Promise<void>
}

/** Collapse a burst into one active task followed by at most the latest trailing task. */
export class TrailingTask<Key> {
  private readonly flights = new Map<Key, Flight>()

  run(key: Key, task: () => Promise<void>): Promise<void> {
    const existing = this.flights.get(key)
    if (existing !== undefined) {
      existing.queued = true
      existing.task = task
      return existing.promise
    }

    const flight = {
      queued: false,
      task,
      promise: Promise.resolve(),
    }
    flight.promise = (async () => {
      do {
        flight.queued = false
        await flight.task()
      } while (flight.queued)
    })().finally(() => {
      if (this.flights.get(key) === flight) this.flights.delete(key)
    })
    this.flights.set(key, flight)
    return flight.promise
  }
}
