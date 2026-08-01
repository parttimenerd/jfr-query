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

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return parseFloat(trimmed);
  }

  const regex = /(\d+(\.\d+)?)\s*(ms|s|m|h|d)/g;
  let totalMilliseconds = 0;
  let match;
  let totalMatchedChars = 0;

  while ((match = regex.exec(trimmed)) !== null) {
    const value = parseFloat(match[1]);
    const unit = match[3];
    totalMilliseconds += value * DURATION_UNITS[unit];
    totalMatchedChars += match[0].replace(/\s+/g, '').length;
  }

  const sanitized = trimmed.replace(/\s+/g, '');
  if (totalMatchedChars !== sanitized.length) {
    console.log("Failed validation:");
    console.log("  Input:", durationStr);
    console.log("  Trimmed:", trimmed);
    console.log("  Sanitized:", sanitized);
    console.log("  Total matched chars:", totalMatchedChars);
    console.log("  Sanitized length:", sanitized.length);
    return null;
  }

  return totalMilliseconds;
}

// Test: "5" -> should be 5ms (just a number)
console.log("'5' ->", parseDuration("5"));

// Test: " 5 " -> should be 5ms (with spaces)
console.log("' 5 ' ->", parseDuration(" 5 "));

// Test: "5m" -> should be 300000ms
console.log("'5m' ->", parseDuration("5m"));

// Test edge case: leading/trailing spaces with units
console.log("' 5m ' ->", parseDuration(" 5m "));

// The bug: spaces at the end
console.log("'5m 30s ' ->", parseDuration("5m 30s "));
