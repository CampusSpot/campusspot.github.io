// Map geometry. Positions are { lat, lng } in degrees; headings are compass bearings (0° = north,
// clockwise). Game logic only calls these functions, and the database has matching SQL versions
// (supabase/schema.sql) that the tests compare against. Shared by the browser and the tests.

const EARTH_RADIUS_M = 6371008.8;
const toRad = d => (d * Math.PI) / 180;
const toDeg = r => (r * 180) / Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Normalize any angle to [0, 360). */
export const norm360 = d => ((d % 360) + 360) % 360;

/** Shortest angular difference between two headings, 0–180°. */
export function angleError(a, b) {
  const d = Math.abs(norm360(a) - norm360(b));
  return d > 180 ? 360 - d : d;
}

function haversine(a, b) {
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat), dφ = φ2 - φ1, dλ = toRad(b.lng - a.lng);
  const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** True if `p` is a well-formed position (it may still be outside the map's play area). */
export const isValidPos = (map, p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

/** Distance between two positions, in meters. */
export const distance = (map, a, b) => haversine(a, b);

/** Compass heading from `a` toward `b`, 0–360°. */
export function bearing(map, a, b) {
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat), dλ = toRad(b.lng - a.lng);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return norm360(toDeg(Math.atan2(y, x)));
}

/** Size of the play area (its diagonal), in meters. Used to scale position scoring. map.bounds = { sw, ne } */
export const mapSpan = map => haversine(map.bounds.sw, map.bounds.ne);

/** Pull a position back inside the map's play area. */
export const clampPos = (map, p) => ({
  lat: clamp(p.lat, map.bounds.sw.lat, map.bounds.ne.lat),
  lng: clamp(p.lng, map.bounds.sw.lng, map.bounds.ne.lng),
});
