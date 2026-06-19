// utils/durationParser.ts
const DURATION_UNITS: { [key: string]: number } = {
  ms: 1,
  s: 1000,
  m: 1000 * 60,
  h: 1000 * 60 * 60,
  d: 1000 * 60 * 60 * 24,
};

/**
 * Parses a duration string (e.g., "5m 30s 100ms") into milliseconds.
 * Returns null if the format is invalid.
 * @param durationStr The string to parse.
 * @returns The total milliseconds, or null if invalid.
 */
export const parseDuration = (durationStr: string): number | null => {
  const trimmed = durationStr.trim().toLowerCase();
  if (!trimmed) return null;

  // If it's just a number, assume it's milliseconds
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return parseFloat(trimmed);
  }

  const regex = /(\d+(\.\d+)?)\s*(ms|s|m|h|d)/g;
  let totalMilliseconds = 0;
  let match;
  let totalMatchedChars = 0;

  // Loop through all matches of "value unit" pairs
  while ((match = regex.exec(trimmed)) !== null) {
    const value = parseFloat(match[1]);
    const unit = match[3] as keyof typeof DURATION_UNITS;
    totalMilliseconds += value * DURATION_UNITS[unit];
    totalMatchedChars += match[0].replace(/\s+/g, '').length;
  }

  const sanitized = trimmed.replace(/\s+/g, '');
  if (totalMatchedChars !== sanitized.length) {
    return null;
  }

  return totalMilliseconds > 0 ? totalMilliseconds : null;
};
