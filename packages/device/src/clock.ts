/** Time and timers behind an interface so the state machines are testable without waiting. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

interface Timer {
  id: number;
  at: number;
  every: number | null;
  fn: () => void;
}

/** Deterministic clock: time only moves when `advance` is called. Useful in tests and mocks. */
export class FakeClock implements Clock {
  private t: number;
  private nextId = 1;
  private timers: Timer[] = [];

  constructor(start = 1_700_000_000_000) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ id, at: this.t + ms, every: null, fn });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.timers = this.timers.filter((x) => x.id !== h);
  }
  setInterval(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.push({ id, at: this.t + ms, every: ms, fn });
    return id;
  }
  clearInterval(h: unknown): void {
    this.clearTimeout(h);
  }

  /** Runs every timer that falls due within `ms`, in time order, then lands on now + ms. */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers
        .filter((x) => x.at <= end)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.t = due.at;
      if (due.every === null) this.timers = this.timers.filter((x) => x !== due);
      else due.at += due.every;
      due.fn();
    }
    this.t = end;
  }

  /**
   * Like `advance`, but lets promises settle after every timer, so code that awaits inside a
   * timer callback (reconnect attempts) behaves as it would in a real browser.
   */
  async advanceAsync(ms: number): Promise<void> {
    const end = this.t + ms;
    const settle = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    for (;;) {
      const due = this.timers
        .filter((x) => x.at <= end)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.t = due.at;
      if (due.every === null) this.timers = this.timers.filter((x) => x !== due);
      else due.at += due.every;
      due.fn();
      await settle();
    }
    this.t = end;
    await settle();
  }

  get pendingTimers(): number {
    return this.timers.length;
  }
}
