// Quick test of the logic
const trimmed = "5m 30s 100ms";
const regex = /(\d+(\.\d+)?)\s*(ms|s|m|h|d)/g;
let match;
let totalMatchedChars = 0;

while ((match = regex.exec(trimmed)) !== null) {
  console.log("Match:", match[0], "Replace /\\s+/g:", match[0].replace(/\s+/g, ''));
  totalMatchedChars += match[0].replace(/\s+/g, '').length;
}

const sanitized = trimmed.replace(/\s+/g, '');
console.log("Total matched chars:", totalMatchedChars);
console.log("Sanitized string:", sanitized);
console.log("Sanitized length:", sanitized.length);
console.log("Should return:", totalMatchedChars === sanitized.length);
