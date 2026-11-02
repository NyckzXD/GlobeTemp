import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    LUT_SIZE, PALETTES, SCALE_MAX, SCALE_MIN, getLUT, interpolateColor, lutIndex
} from '../../static/js/palettes.js';

test('todas as paletas cobrem a escala inteira, em ordem crescente', () => {
    for (const [id, { stops }] of Object.entries(PALETTES)) {
        assert.equal(stops[0].t, SCALE_MIN, id);
        assert.equal(stops.at(-1).t, SCALE_MAX, id);
        for (let i = 1; i < stops.length; i++) assert.ok(stops[i].t > stops[i - 1].t, id);
    }
});

test('interpolateColor satura nas pontas e acerta as paradas', () => {
    const { stops } = PALETTES.viridis;
    assert.deepEqual(interpolateColor(-999, 'viridis'), stops[0].c);
    assert.deepEqual(interpolateColor(999, 'viridis'), stops.at(-1).c);
    assert.deepEqual(interpolateColor(stops[3].t, 'viridis'), stops[3].c);
});

test('interpolateColor interpola linearmente entre paradas', () => {
    const { stops } = PALETTES.magma;
    const mid = (stops[0].t + stops[1].t) / 2;
    const expected = stops[0].c.map((v, i) => Math.round((v + stops[1].c[i]) / 2));
    assert.deepEqual(interpolateColor(mid, 'magma'), expected);
});

test('thermal é divergente: frio azul, quente vermelho', () => {
    const [rCold, , bCold] = interpolateColor(-30, 'thermal');
    const [rHot, , bHot] = interpolateColor(40, 'thermal');
    assert.ok(bCold > rCold);
    assert.ok(rHot > bHot);
});

test('paleta desconhecida cai na padrão', () => {
    assert.deepEqual(interpolateColor(12, 'nope'), interpolateColor(12, 'thermal'));
});

test('LUT tem o tamanho certo e lutIndex respeita os limites', () => {
    assert.equal(getLUT('plasma').length, LUT_SIZE * 3);
    assert.equal(lutIndex(-1000), 0);
    assert.equal(lutIndex(1000), LUT_SIZE - 1);
    assert.equal(lutIndex(SCALE_MIN), 0);
});
