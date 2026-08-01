// Test histogram with NaN values
const values = [NaN, 1, 2, 3];
const filtered = values.filter(v => !isNaN(v));

console.log("Filtered values:", filtered);  // [1, 2, 3]

let min = filtered[0], max = filtered[0];
for (let i = 1; i < filtered.length; i++) {
  if (filtered[i] < min) min = filtered[i];
  if (filtered[i] > max) max = filtered[i];
}

console.log("Min:", min, "Max:", max);
