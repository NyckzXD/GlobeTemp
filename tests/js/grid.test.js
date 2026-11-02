import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bracket, buildGrid, colorize, interpolateField, sampleTemp } from '../../static/js/grid.js';
import { getLUT, lutIndex } from '../../static/js/palettes.js';

// Grade 3 x 3 em que temp = lat + lng/10 (bilinear reproduz funções lineares exatamente)
const LATS = [-90, 0, 90];
const LNGS = [-180, 0, 180];
const f = (lat, lng) => lat + lng / 10;
const points = LATS.flatMap((lat) => LNGS.map((lng) => ({ lat, lng, temp: f(lat, lng) })));
const grid = buildGrid(points);

test('bracket encontra o intervalo e limita às pontas', () => {
    const arr = [-90, -30, 30, 90];
    assert.equal(bracket(arr, -100), 0);
    assert.equal(bracket(arr, -30), 1);
    assert.equal(bracket(arr, 0), 1);
    assert.equal(bracket(arr, 90), 3);
    assert.equal(bracket(arr, 200), 3);
});

test('buildGrid ordena os eixos independentemente da ordem dos pontos', () => {
    const g = buildGrid([...points].reverse());
    assert.deepEqual(g.lats, LATS);
    assert.deepEqual(g.lngs, LNGS);
    assert.equal(g.T[2][0], f(90, -180));
});

test('sampleTemp devolve os valores da grade nos nós', () => {
    for (const p of points) assert.ok(Math.abs(sampleTemp(grid, p.lat, p.lng) - p.temp) < 1e-4);
});

test('sampleTemp interpola entre os nós', () => {
    for (const [lat, lng] of [[45, 90], [-12.5, -33], [80, 170]]) {
        assert.ok(Math.abs(sampleTemp(grid, lat, lng) - f(lat, lng)) < 1e-4, `${lat},${lng}`);
    }
});

test('interpolateField bate com sampleTemp no centro de cada pixel', () => {
    const w = 8, h = 4;
    const field = interpolateField(grid, w, h);
    assert.equal(field.length, w * h);
    for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
            const lat = 90 - ((py + 0.5) / h) * 180;
            const lng = -180 + ((px + 0.5) / w) * 360;
            assert.ok(Math.abs(field[py * w + px] - sampleTemp(grid, lat, lng)) < 1e-3);
        }
    }
});

test('colorize pinta cada pixel com a cor da LUT e alfa opaco', () => {
    const field = Float32Array.from([-40, 0, 25, 50]);
    const rgba = colorize(field, 'viridis', new Uint8ClampedArray(16));
    const lut = getLUT('viridis');
    field.forEach((t, i) => {
        const k = lutIndex(t) * 3;
        assert.deepEqual([...rgba.slice(i * 4, i * 4 + 4)], [lut[k], lut[k + 1], lut[k + 2], 255]);
    });
});
