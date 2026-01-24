export interface SemverParts {
  major: number;
  minor: number;
}

/**
 * Parse a semver string and extract major.minor parts.
 * Returns { major: 0, minor: 0 } for invalid inputs.
 */
export function parseSemverMajorMinor(version: string | undefined | null): SemverParts {
  const parts = String(version || '')
    .split('.')
    .map((p) => Number(p));

  const major = Number.isFinite(parts[0]) ? parts[0] : 0;
  const minor = Number.isFinite(parts[1]) ? parts[1] : 0;

  return { major, minor };
}
