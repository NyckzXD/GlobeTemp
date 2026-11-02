// Grade de temperatura e interpolação. Módulo puro (sem DOM): também roda nos testes do Node.

import { getLUT, lutIndex } from './palettes.js';

// Busca binária: maior índice i com arr[i] <= v (limitado à faixa válida)
export function bracket(arr, v) {
    if (v <= arr[0]) return 0;
    const last = arr.length - 1;
    if (v >= arr[last]) return last;
    let lo = 0, hi = last;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] <= v) lo = mid; else hi = mid;
    }
    return lo;
}

// Grade de temperatura derivada dos pontos (sem supor passo/deslocamento)
export function buildGrid(points) {
    const latSet = new Set(), lngSet = new Set();
    for (const p of points) { latSet.add(p.lat); lngSet.add(p.lng); }
    const lats = [...latSet].sort((a, b) => a - b); // crescente: sul -> norte
    const lngs = [...lngSet].sort((a, b) => a - b); // crescente: oeste -> leste

    const idxLat = new Map(lats.map((v, i) => [v, i]));
    const idxLng = new Map(lngs.map((v, i) => [v, i]));

    // Matriz 2D de temperatura T[índiceLat][índiceLng]
    const T = lats.map(() => new Float32Array(lngs.length));
    for (const p of points) {
        T[idxLat.get(p.lat)][idxLng.get(p.lng)] = p.temp;
    }
    return { lats, lngs, T };
}

// Célula do eixo que contém v: índices vizinhos e a fração entre eles
export function axisCell(axis, v) {
    const i0 = bracket(axis, v);
    const i1 = Math.min(i0 + 1, axis.length - 1);
    const lo = axis[i0], hi = axis[i1];
    return [i0, i1, hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0];
}

function bilinear(rowLo, rowHi, j0, j1, fx, fy) {
    return rowLo[j0] * (1 - fx) * (1 - fy)
         + rowLo[j1] * fx       * (1 - fy)
         + rowHi[j0] * (1 - fx) * fy
         + rowHi[j1] * fx       * fy;
}

// Temperatura interpolada num ponto qualquer: o mesmo valor que o mapa pinta ali
export function sampleTemp(grid, lat, lng) {
    const [i0, i1, fy] = axisCell(grid.lats, lat);
    const [j0, j1, fx] = axisCell(grid.lngs, lng);
    return bilinear(grid.T[i0], grid.T[i1], j0, j1, fx, fy);
}

// Campo de temperatura interpolado para uma imagem equiretangular width × height
// (linha 0 = +90°, coluna 0 = -180°), amostrado no centro de cada pixel.
export function interpolateField(grid, width, height) {
    const { lats, lngs, T } = grid;

    // Pré-calcula, por coluna, o intervalo de longitude + a fração
    const colLo = new Int32Array(width);
    const colHi = new Int32Array(width);
    const colFrac = new Float32Array(width);
    for (let px = 0; px < width; px++) {
        const lng = -180 + ((px + 0.5) / width) * 360;
        [colLo[px], colHi[px], colFrac[px]] = axisCell(lngs, lng);
    }

    const field = new Float32Array(width * height);
    for (let py = 0; py < height; py++) {
        const lat = 90 - ((py + 0.5) / height) * 180;
        const [i0, i1, fy] = axisCell(lats, lat);
        const rowLo = T[i0], rowHi = T[i1];
        const base = py * width;
        for (let px = 0; px < width; px++) {
            field[base + px] = bilinear(rowLo, rowHi, colLo[px], colHi[px], colFrac[px], fy);
        }
    }
    return field;
}

// Pinta o campo em `rgba` (Uint8ClampedArray de 4 × pixels) com a paleta escolhida.
// Separado da interpolação: trocar de paleta só refaz este passo.
export function colorize(field, palette, rgba) {
    const lut = getLUT(palette);
    for (let i = 0, o = 0; i < field.length; i++, o += 4) {
        const k = lutIndex(field[i]) * 3;
        rgba[o]     = lut[k];
        rgba[o + 1] = lut[k + 1];
        rgba[o + 2] = lut[k + 2];
        rgba[o + 3] = 255;
    }
    return rgba;
}
