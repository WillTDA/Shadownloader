type LifetimeUnit = 'minutes' | 'hours' | 'days' | 'unlimited';

const MULTIPLIERS: Record<string, number> = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
};

/**
 * Convert a lifetime value and unit to milliseconds.
 * Returns 0 for 'unlimited' or invalid inputs.
 */
export function lifetimeToMs(value: number, unit: LifetimeUnit | string): number {
  const u = String(unit || '').toLowerCase();
  const v = Number(value);

  if (u === 'unlimited') return 0;
  if (!Number.isFinite(v) || v <= 0) return 0;

  const m = MULTIPLIERS[u];
  if (!m) return 0;

  return Math.round(v * m);
}
