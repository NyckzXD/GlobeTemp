import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildGrid, cubicWeights, frameAt, packFrames, sampleTemp } from '../../static/js/grid.js';

// Grade de 30° como a do servidor (polos e ±180° inclusos), dois horários
const LATS = [-90, -60, -30, 0, 30, 60, 90];
const LNGS = Array.from({ length: 13 }, (_, i) => -180 + i * 30);
const TIMES = ['2026-11-02T17:00', '2026-11-02T18:00'];
const H0 = Date.parse('2026-11-02T17:00Z');

function makeGrid(fns) {
    return buildGrid({
        lats: LATS,
        lngs: LNGS,
        times: TIMES.slice(0, fns.length),
        values: fns.map((f) => LATS.flatMap((lat) => LNGS.map((lng) => f(lat, lng))))
    });
}

const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('buildGrid deriva eixos, passo e horários em ms', () => {
    const g = makeGrid([() => 0]);
    assert.equal(g.step, 30);
    assert.equal(g.nLat, 7);
    assert.equal(g.nLng, 13);
    assert.deepEqual(g.times, [H0]);
    assert.equal(g.frames[0].length, 7 * 13);
});

test('pesos de Catmull-Rom somam 1 e passam pelos nós', () => {
    for (const t of [0, 0.25, 0.5, 0.9]) near(cubicWeights(t).reduce((a, b) => a + b), 1);
    cubicWeights(0).forEach((w, i) => near(w, i === 1 ? 1 : 0));
});

test('sampleTemp devolve os valores da grade nos nós', () => {
    const f = (lat, lng) => Math.sin(lat / 20) * 10 + Math.cos(lng / 40) * 5;
    const g = makeGrid([f]);
    for (const lat of LATS) for (const lng of LNGS) near(sampleTemp(g, lat, lng), f(lat, lng));
});

test('sampleTemp reproduz funções lineares na latitude (longe dos polos)', () => {
    const g = makeGrid([(lat) => lat / 2]);
    for (const lat of [-45, -12.5, 7, 44]) near(sampleTemp(g, lat, 33), lat / 2);
});

test('a longitude dá a volta em ±180° sem costura', () => {
    const f = (lat, lng) => Math.cos((lng * Math.PI) / 180) * 10;
    const g = makeGrid([f]);
    near(sampleTemp(g, 10, 179.9), sampleTemp(g, 10, -180.1), 1e-2);
    near(sampleTemp(g, 10, 540), sampleTemp(g, 10, 180));
});

test('t fracionário mistura dois horários linearmente', () => {
    const g = makeGrid([() => 10, () => 20]);
    near(sampleTemp(g, 0, 0, 0), 10);
    near(sampleTemp(g, 0, 0, 0.25), 12.5);
    near(sampleTemp(g, 0, 0, 1), 20);
    near(sampleTemp(g, 0, 0, 5), 20);  // satura no último horário
});

test('frameAt converte instante em posição na série e satura nas pontas', () => {
    const g = makeGrid([() => 0, () => 0]);
    assert.equal(frameAt(g, H0 - 1e6), 0);
    near(frameAt(g, H0 + 30 * 60 * 1000), 0.5);
    assert.equal(frameAt(g, H0 + 1e9), 1);
});

test('packFrames empilha os horários em linhas da textura', () => {
    const g = makeGrid([() => 1, () => 2]);
    const data = packFrames(g);
    const size = g.nLat * g.nLng;
    assert.equal(data.length, size * 2);
    assert.equal(data[size - 1], 1);
    assert.equal(data[size], 2);
});
