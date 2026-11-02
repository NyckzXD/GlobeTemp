import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeArcs, topologyLines } from '../../static/js/topology.js';

test('decodeArcs desfaz o delta e a quantização', () => {
    const topology = {
        transform: { scale: [0.5, 2], translate: [-10, 20] },
        arcs: [[[0, 0], [2, 1], [2, -1]]]
    };
    assert.deepEqual(decodeArcs(topology), [[[-10, 20], [-9, 22], [-8, 20]]]);
});

test('arcos compartilhados viram fronteira; os demais, costa', () => {
    // Dois quadrados lado a lado: o arco 1 é a divisa entre eles
    const topology = {
        arcs: [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[2, 0], [2, 1]]],
        objects: {
            countries: {
                type: 'GeometryCollection',
                geometries: [
                    { type: 'Polygon', arcs: [[0, 1]] },
                    { type: 'MultiPolygon', arcs: [[[~1, 2]]] }
                ]
            }
        }
    };
    const { coasts, borders } = topologyLines(topology, 'countries');
    assert.deepEqual(borders, [topology.arcs[1]]);
    assert.deepEqual(coasts, [topology.arcs[0], topology.arcs[2]]);
});
