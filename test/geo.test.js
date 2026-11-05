import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angleError, bearing, clampPos, distance, mapSpan, norm360 } from '../public/shared/geo.js';

const campus = { type: 'latlng', bounds: { sw: { lat: 34.05, lng: -117.83 }, ne: { lat: 34.065, lng: -117.81 } } };

test('angleError is the shortest difference, 0–180', () => {
  assert.equal(angleError(10, 350), 20);
  assert.equal(angleError(350, 10), 20);
  assert.equal(angleError(0, 180), 180);
  assert.equal(angleError(90, 90), 0);
  assert.equal(angleError(-90, 270), 0);
  assert.equal(norm360(-30), 330);
});

test('haversine distance, compass bearing, play-area size and clamping', () => {
  const a = { lat: 34.058, lng: -117.82 };
  const d = distance(campus, a, { lat: 34.059, lng: -117.82 });
  assert.ok(Math.abs(d - 111.2) < 0.5, `0.001° of latitude ≈ 111 m, got ${d}`);
  assert.ok(bearing(campus, a, { lat: 34.059, lng: -117.82 }) < 0.01);
  assert.ok(Math.abs(bearing(campus, a, { lat: 34.058, lng: -117.819 }) - 90) < 0.1);
  assert.ok(mapSpan(campus) > 2000 && mapSpan(campus) < 2500);
  assert.deepEqual(clampPos(campus, { lat: 40, lng: -120 }), { lat: 34.065, lng: -117.83 });
});
