// Grade horária de temperatura e interpolação. Módulo puro (sem DOM): também roda nos testes
// do Node. O shader do globo (heatmap.js) faz exatamente a mesma conta na GPU; o tooltip usa
// esta versão, então os dois mostram o mesmo valor.

// Converte o `grid` de /api/data: eixos uniformes, um Float32Array por horário
export function buildGrid({ lats, lngs, times, values }) {
    if (lats.length < 2 || lngs.length < 2) throw new Error('grid needs at least 2 x 2 points');
    return {
        lats,
        lngs,
        lat0: lats[0],
        lng0: lngs[0],
        step: lats[1] - lats[0],
        nLat: lats.length,
        nLng: lngs.length,
        // Horários UTC do Open-Meteo ("2026-11-02T17:00") em milissegundos
        times: times.map((t) => Date.parse(`${t}Z`)),
        frames: values.map((v) => Float32Array.from(v))
    };
}

// Posição fracionária na série (0 = primeiro horário) para um instante; satura nas pontas
export function frameAt(grid, ms) {
    const { times } = grid;
    if (ms <= times[0]) return 0;
    const last = times.length - 1;
    if (ms >= times[last]) return last;
    let i = 0;
    while (times[i + 1] <= ms) i++;
    return i + (ms - times[i]) / (times[i + 1] - times[i]);
}

// Pesos de Catmull-Rom: passa pelos nós e reproduz funções lineares exatamente
export function cubicWeights(t) {
    const t2 = t * t, t3 = t2 * t;
    return [
        -0.5 * t3 + t2 - 0.5 * t,
        1.5 * t3 - 2.5 * t2 + 1,
        -1.5 * t3 + 2 * t2 + 0.5 * t,
        0.5 * t3 - 0.5 * t2
    ];
}

// Bicúbica num horário. A longitude dá a volta (a última coluna repete a primeira, ±180°);
// a latitude satura nos polos.
function bicubic(grid, frame, lat, lng) {
    const { lat0, lng0, step, nLat, nLng } = grid;
    const period = nLng - 1;
    const gy = Math.min(nLat - 1, Math.max(0, (lat - lat0) / step));
    const gx = (((lng - lng0) / step) % period + period) % period;
    const iy = Math.min(nLat - 2, Math.floor(gy)), ix = Math.floor(gx);
    const wy = cubicWeights(gy - iy), wx = cubicWeights(gx - ix);

    let sum = 0;
    for (let a = 0; a < 4; a++) {
        const row = Math.min(nLat - 1, Math.max(0, iy - 1 + a)) * nLng;
        let rowSum = 0;
        for (let b = 0; b < 4; b++) {
            const col = (((ix - 1 + b) % period) + period) % period;
            rowSum += frame[row + col] * wx[b];
        }
        sum += rowSum * wy[a];
    }
    return sum;
}

// Temperatura num ponto e num instante da série (`t` fracionário mistura dois horários)
export function sampleTemp(grid, lat, lng, t = 0) {
    const last = grid.frames.length - 1;
    const tc = Math.min(last, Math.max(0, t));
    const f0 = Math.floor(tc), f1 = Math.min(last, f0 + 1), mix = tc - f0;
    const v0 = bicubic(grid, grid.frames[f0], lat, lng);
    return mix > 0 ? v0 + (bicubic(grid, grid.frames[f1], lat, lng) - v0) * mix : v0;
}

// Todos os horários num só bloco (horário k ocupa as linhas k·nLat .. k·nLat + nLat - 1):
// é a textura que o shader lê com texelFetch.
export function packFrames(grid) {
    const size = grid.nLat * grid.nLng;
    const data = new Float32Array(size * grid.frames.length);
    grid.frames.forEach((frame, k) => data.set(frame, k * size));
    return data;
}
