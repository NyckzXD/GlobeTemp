import assert from 'node:assert/strict';
import { test } from 'node:test';

import { statusFor } from '../../static/js/ui/status.js';

const now = Date.UTC(2026, 10, 2, 12);
const base = {
    source: 'open-meteo', refreshing: false, retrying: false,
    interval: 90, last_update: now / 1000 - 60
};

test('dado real e recente: live', () => {
    assert.equal(statusFor(base, now), 'live');
});

test('atualizando tem prioridade sobre tudo', () => {
    assert.equal(statusFor({ ...base, refreshing: true, source: 'synthetic' }, now), 'updating');
});

test('estimativa por latitude: estimated', () => {
    assert.equal(statusFor({ ...base, source: 'synthetic', retrying: true }, now), 'estimated');
});

test('em backoff após erro: retrying', () => {
    assert.equal(statusFor({ ...base, retrying: true }, now), 'retrying');
});

test('dado real muito mais velho que o intervalo: stale', () => {
    const old = now / 1000 - 90 * 60 * 2;
    assert.equal(statusFor({ ...base, last_update: old }, now), 'stale');
});
