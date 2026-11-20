import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PLAYERS,
  fillTemplate,
  isFullUrlTemplate,
  matchesTemplate,
  stripOriginFromTemplate,
} from '../src/shared/types.ts';

test('fillTemplate substitutes {id}, {tmdb}, {s}, {e} accurately', () => {
  assert.equal(fillTemplate('/film/{id}', { id: '24417' }), 'film/24417');
  assert.equal(
    fillTemplate('/tvs/{id}/{s}/{e}', { id: '9650', s: 2, e: 5 }),
    'tvs/9650/2/5'
  );
  assert.equal(
    fillTemplate('https://player.example.com/v/{tmdb}?s={s}&e={e}', {
      id: '123',
      tmdb: '550',
      s: 1,
      e: 3,
    }),
    'https://player.example.com/v/550?s=1&e=3'
  );
});

test('fillTemplate rejects missing or non-numeric placeholders', () => {
  assert.equal(fillTemplate('/film/{id}', { id: 'abc' }), null);
  assert.equal(fillTemplate('/film/{tmdb}', { id: '24417', tmdb: null }), null);
  assert.equal(fillTemplate('   ', { id: '24417' }), null);
});

test('isFullUrlTemplate & stripOriginFromTemplate handle absolute vs relative templates', () => {
  assert.equal(isFullUrlTemplate('https://embed.example.com/film/{id}'), true);
  assert.equal(isFullUrlTemplate('/film/{id}'), false);
  assert.equal(
    stripOriginFromTemplate('https://embed.example.com/film/{id}', 'https://embed.example.com/'),
    '/film/{id}'
  );
  assert.equal(
    stripOriginFromTemplate('https://other.example.com/film/{id}', 'https://embed.example.com'),
    'https://other.example.com/film/{id}'
  );
});

test('matchesTemplate validates upstream relative watch paths', () => {
  assert.equal(matchesTemplate(DEFAULT_PLAYERS.player_guest_film, 'film/24417'), true);
  assert.equal(matchesTemplate(DEFAULT_PLAYERS.player_guest_film, 'film/abc'), false);
  assert.equal(matchesTemplate(DEFAULT_PLAYERS.player_guest_serie, 'tvs/9650/1/4'), true);
  assert.equal(matchesTemplate('https://external.example.com/film/{id}', 'film/24417'), false);
});
