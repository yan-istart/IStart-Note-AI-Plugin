import { ScheduleTrigger } from "./types";

/**
 * Determine whether a task is due and calculate the next run time.
 */
export class NextRunCalculator {
  /** Check if the task should fire now. */
  isDue(trigger: ScheduleTrigger, lastRunAt: string | undefined, now: Date): boolean {
    switch (trigger.type) {
      case "on-startup":
        // Fire once per session — if never run this session
        return !lastRunAt;

      case "interval": {
        if (!lastRunAt) return true;
        const elapsed = now.getTime() - new Date(lastRunAt).getTime();
        return elapsed >= trigger.minutes * 60_000;
      }

      case "daily": {
        const [h, m] = trigger.time.split(":").map(Number);
        if (now.getHours() < h || (now.getHours() === h && now.getMinutes() < m)) return false;
        if (!lastRunAt) return true;
        const lastDate = new Date(lastRunAt).toDateString();
        return lastDate !== now.toDateString();
      }

      case "weekly": {
        if (now.getDay() !== trigger.weekday) return false;
        const [h, m] = trigger.time.split(":").map(Number);
        if (now.getHours() < h || (now.getHours() === h && now.getMinutes() < m)) return false;
        if (!lastRunAt) return true;
        const elapsed = now.getTime() - new Date(lastRunAt).getTime();
        return elapsed >= 6 * 24 * 60 * 60_000; // at least 6 days since last
      }
    }
  }

  /** Calculate the next scheduled run (for display). */
  getNextRun(trigger: ScheduleTrigger, now: Date): Date {
    switch (trigger.type) {
      case "on-startup":
        return now; // always "next startup"

      case "interval": {
        return new Date(now.getTime() + trigger.minutes * 60_000);
      }

      case "daily": {
        const [h, m] = trigger.time.split(":").map(Number);
        const next = new Date(now);
        next.setHours(h, m, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        return next;
      }

      case "weekly": {
        const [h, m] = trigger.time.split(":").map(Number);
        const next = new Date(now);
        const diff = (trigger.weekday - now.getDay() + 7) % 7;
        next.setDate(now.getDate() + diff);
        next.setHours(h, m, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 7);
        return next;
      }
    }
  }
}
