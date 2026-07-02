/**
 * Formats a number to a string with a maximum number of decimal places.
 * Does not add trailing zeros to integers.
 * Returns the original value as a string if it's not a valid number.
 * @param value The value to format.
 * @param decimalPlaces The maximum number of decimal places.
 * @returns The formatted string.
 */
export const formatNumber = (value: any, decimalPlaces: number): string => {
  // BigInt: format without precision loss — always an integer, no fractional part.
  if (typeof value === 'bigint') return value.toString();

  const num = Number(value);
  // Return non-numeric types as-is
  if (typeof value === 'boolean' || isNaN(num) || value === null || value === undefined) {
    return String(value);
  }

  // Use Intl.NumberFormat for robust, locale-aware formatting
  // that correctly handles maximum fraction digits without adding unnecessary zeros.
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: decimalPlaces,
    useGrouping: false // Avoid commas in numbers for data tables
  }).format(num);
};
