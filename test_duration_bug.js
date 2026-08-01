// Test durationParser bug
const DURATION_UNITS = {
  ms: 1,
  s: 1000,
  m: 1000 * 60,
  h: 1000 * 60 * 60,
  d: 1000 * 60 * 60 * 24,
};

function parseDuration(durationStr) {
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
    const unit = match[3];
    totalMilliseconds += value * DURATION_UNITS[unit];
    totalMatchedChars += match[0].replace(/\s+/g, '').length;
  }

  const sanitized = trimmed.replace(/\s+/g, '');
  if (totalMatchedChars !== sanitized.length) {
    return null;
  }

  return totalMilliseconds;
}

// Test cases
console.log("Test: '5m 30s':", parseDuration("5m 30s"));  // Should be 330000
console.log("Test: '5m  30s':", parseDuration("5m  30s")); // double space
console.log("Test: '5m 30s extra':", parseDuration("5m 30s extra")); // invalid suffix
console.log("Test: '5m-30s':", parseDuration("5m-30s")); // hyphen (invalid)
