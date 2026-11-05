// Distances are stored in meters; each map chooses feet or meters for display.
const FT = 0.3048;
const trim = n => String(+n.toFixed(2));

/** "120 ft", "3.5 m", "0.4 ft": fewer decimals for bigger numbers. */
export function formatLength(meters, units) {
  const v = units === 'ft' ? meters / FT : meters;
  const digits = v >= 100 ? 0 : v >= 1 ? 1 : 2;
  return `${trim(+v.toFixed(digits))} ${units}`;
}
