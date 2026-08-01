// Checking the histogram binning logic bug
const values = [1, 2, 3, 4, 5];
const min = 1, max = 5, binCount = 2;

// Standard approach: values should be in range [min, max)
// For the edge case where v === max:
// If we do Math.floor((v - min) / size):
// Math.floor((5 - 1) / 2) = Math.floor(2) = 2, but only indices 0,1 exist!

const size = (max - min) / binCount;
console.log("Size:", size);

for(const v of values) { 
  const i = Math.max(0, Math.min(binCount-1, Math.floor((v-min)/size)));
  console.log(`Value ${v}: index ${i} (clamped to max ${binCount-1})`);
}

// The bug: When v=max (5), we get index 2, which is clamped to binCount-1=1.
// This means the max value gets placed in the second-to-last bin instead of the last bin.
// This is actually OK for [low, high) binning, but let's verify edge case.

// What if we have exactly 2 bins and values [0,1,2]?
console.log("\n--- Edge case: bins [0,1], [1,2] ---");
const values2 = [0, 1, 2];
const min2 = 0, max2 = 2, binCount2 = 2;
const size2 = (max2 - min2) / binCount2;
for(const v of values2) { 
  const i = Math.max(0, Math.min(binCount2-1, Math.floor((v-min2)/size2)));
  console.log(`Value ${v}: bin index ${i}`);
}
