import type { Token } from './types';

/**
 * Compute the average consultation duration (in minutes) from the last 5
 * completed tokens for a session, ordered by consult_ended_at desc.
 * Returns null if there are no completed consultations yet.
 */
export function averageConsultDurationMinutes(tokens: Token[]): number | null {
  const completed = tokens
    .filter((t) => t.status === 'completed' && t.consult_started_at && t.consult_ended_at)
    .sort((a, b) => (b.consult_ended_at! > a.consult_ended_at! ? 1 : -1))
    .slice(0, 5);

  if (completed.length === 0) return null;

  const totalMs = completed.reduce((sum, t) => {
    const start = new Date(t.consult_started_at!).getTime();
    const end = new Date(t.consult_ended_at!).getTime();
    return sum + (end - start);
  }, 0);

  return totalMs / completed.length / 60000;
}

/**
 * Estimate wait time for a patient's token number.
 * Returns minutes (0 if currently being served or already past).
 * Uses avgDuration if available, otherwise a 10-minute default.
 */
export function estimateWaitMinutes(
  myToken: number,
  currentToken: number,
  avgDuration: number | null,
): number {
  const diff = myToken - currentToken;
  if (diff <= 0) return 0;
  const perToken = avgDuration ?? 10;
  return Math.max(1, Math.round(diff * perToken));
}

export function formatWaitTime(minutes: number): string {
  if (minutes <= 0) return 'Now serving';
  if (minutes < 60) return `~${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `~${h} hr ${m} min` : `~${h} hr`;
}
