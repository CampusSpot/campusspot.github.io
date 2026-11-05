import { test } from 'node:test';
import assert from 'node:assert/strict';
import config from '../public/shared/scoring.config.js';
import { maxScore, positionScale, scoreGuess } from '../public/shared/scoring.js';

// A play area 0.01° tall and 0 wide: its diagonal is exactly that many degrees of latitude.
const area = { type: 'latlng', bounds: { sw: { lat: 34.05, lng: -117.82 }, ne: { lat: 34.06, lng: -117.82 } } };
const truth = { pos: { lat: 34.055, lng: -117.82 }, heading: 90 };
const METERS_PER_DEG = (6371008.8 * Math.PI) / 180;
const north = meters => ({ lat: truth.pos.lat + meters / METERS_PER_DEG, lng: truth.pos.lng });

test('perfect guess scores the max', () => {
  const s = scoreGuess({ map: area, truth, guess: truth, difficulty: 'easy' });
  assert.equal(s.position, 5000);
  assert.equal(s.direction, 5000);
  assert.equal(s.total, 10000);
  assert.equal(s.max, 10000);
});

test('position: 5000 × exp(−d / scale), scale from map size and difficulty', () => {
  const scale = positionScale(area, 'easy');
  assert.ok(Math.abs(scale - 0.01 * METERS_PER_DEG * config.position.scaleFraction) < 1e-6);
  const s = scoreGuess({ map: area, truth, guess: { pos: north(scale), heading: 90 }, difficulty: 'easy' });
  assert.equal(s.position, Math.round(5000 / Math.E));
  assert.ok(positionScale(area, 'impossible') > scale, 'harder rounds are more forgiving on distance');
});

test('direction: 5000 × (1 − angleError / 180), using the shortest angle', () => {
  const at = heading => scoreGuess({ map: area, truth, guess: { pos: truth.pos, heading }, difficulty: 'easy' });
  assert.equal(at(180).direction, 2500);
  assert.equal(at(270).direction, 0);
  assert.equal(at(0).direction, 2500);
  assert.equal(at(45).angleError, 45);
});

test('difficulty multiplier applies to the total', () => {
  const s = scoreGuess({ map: area, truth, guess: truth, difficulty: 'night' });
  assert.equal(s.multiplier, config.difficulties.night.multiplier);
  assert.equal(s.total, Math.round(10000 * s.multiplier));
  assert.equal(s.max, maxScore('night'));
  const off = scoreGuess({ map: area, truth, guess: truth, difficulty: 'night' }, { ...config, useDifficultyMultiplier: false });
  assert.equal(off.total, 10000);
});
