import assert from 'node:assert/strict';
import { test } from 'node:test';

import { relativeLabel } from '../../static/js/ui/timeline.js';

const now = Date.UTC(2026, 10, 2, 12, 10);
const HOUR = 3600 * 1000;

test('horário dentro da mesma hora: Now', () => {
    assert.equal(relativeLabel(now - 10 * 60 * 1000, now), 'Now');
});

test('previsão e passado em horas', () => {
    assert.equal(relativeLabel(now + 3 * HOUR, now), '+3 h');
    assert.equal(relativeLabel(now - 2 * HOUR, now), '−2 h');
});
