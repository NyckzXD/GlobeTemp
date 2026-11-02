import assert from 'node:assert/strict';
import { test } from 'node:test';

import { subsolarPoint, sunDirection } from '../../static/js/sun.js';

const near = (a, b, eps) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('solstícios e equinócio: declinação', () => {
    near(subsolarPoint(Date.UTC(2026, 5, 21, 8, 24)).lat, 23.44, 0.05);   // solstício de junho
    near(subsolarPoint(Date.UTC(2026, 11, 21, 20, 50)).lat, -23.44, 0.05); // solstício de dezembro
    near(subsolarPoint(Date.UTC(2026, 2, 20, 14, 46)).lat, 0, 0.05);      // equinócio de março
});

test('meio-dia UTC: sol perto de Greenwich (equação do tempo)', () => {
    // Início de novembro o sol adianta ~16 min: ao meio-dia UTC já passou 4° a oeste
    near(subsolarPoint(Date.UTC(2026, 10, 2, 12)).lng, -4.1, 0.2);
    // Meados de fevereiro atrasa ~14 min: ainda está ~3,5° a leste
    near(subsolarPoint(Date.UTC(2026, 1, 11, 12)).lng, 3.5, 0.2);
});

test('o sol anda 15° para oeste por hora e a longitude fica em [-180, 180)', () => {
    const t = Date.UTC(2026, 10, 2, 0);
    const a = subsolarPoint(t).lng;
    near(subsolarPoint(t + 3600 * 1000).lng, a - 15, 0.05);
    for (let h = 0; h < 24; h++) {
        const { lng } = subsolarPoint(t + h * 3600 * 1000);
        assert.ok(lng >= -180 && lng < 180, String(lng));
    }
});

test('sunDirection é unitário e aponta para o ponto subsolar', () => {
    const [x, y, z] = sunDirection(Date.UTC(2026, 5, 21, 12));
    near(Math.hypot(x, y, z), 1, 1e-9);
    near(Math.asin(z) * 180 / Math.PI, 23.44, 0.05);
});
