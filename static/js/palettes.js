// Escalas de cor do mapa de calor. Módulo puro (sem DOM): também roda nos testes do Node.

// Faixa de temperatura que as escalas cobrem; fora dela a cor satura nas pontas
export const SCALE_MIN = -40;
export const SCALE_MAX = 50;

function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Paradas igualmente espaçadas em [from, to]
function evenStops(hexes, from = SCALE_MIN, to = SCALE_MAX) {
    return hexes.map((hex, i) => ({
        t: from + (i / (hexes.length - 1)) * (to - from),
        c: hexToRgb(hex)
    }));
}

// Mapas do matplotlib (amostrados a cada 10%): perceptualmente uniformes, legíveis em escala
// de cinza. Cividis foi desenhado para quem tem deficiência na percepção de vermelho/verde.
const VIRIDIS = ['#440154', '#482475', '#414487', '#355f8d', '#2a788e', '#21918c',
                 '#22a884', '#44bf70', '#7ad151', '#bddf26', '#fde725'];
const PLASMA  = ['#0d0887', '#41049d', '#6a00a8', '#8f0da4', '#b12a90', '#cc4778',
                 '#e16462', '#f2844b', '#fca636', '#fcce25', '#f0f921'];
const MAGMA   = ['#000004', '#140e36', '#3b0f70', '#641a80', '#8c2981', '#b73779',
                 '#de4968', '#f7705c', '#fe9f6d', '#fecf92', '#fcfdbf'];
const CIVIDIS = ['#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8779',
                 '#a69d75', '#c4b56c', '#e4cf5b', '#fee838'];

// Divergente (ColorBrewer RdYlBu) com o centro em 0 °C: azul abaixo, vermelho acima
const THERMAL = [
    ...evenStops(['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf'], SCALE_MIN, 0),
    ...evenStops(['#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'], 10, SCALE_MAX)
];

export const PALETTES = {
    thermal: { label: 'Térmica (divergente em 0 °C)', atmosphere: '#1a3a6b', stops: THERMAL },
    viridis: { label: 'Viridis', atmosphere: '#1f3d5c', stops: evenStops(VIRIDIS) },
    cividis: { label: 'Cividis (segura para daltônicos)', atmosphere: '#1c2e4a', stops: evenStops(CIVIDIS) },
    plasma:  { label: 'Plasma', atmosphere: '#2d0059', stops: evenStops(PLASMA) },
    magma:   { label: 'Magma', atmosphere: '#4a1030', stops: evenStops(MAGMA) }
};

export const DEFAULT_PALETTE = 'thermal';

export function interpolateColor(temp, palette) {
    const stops = (PALETTES[palette] || PALETTES[DEFAULT_PALETTE]).stops;
    if (temp <= stops[0].t) return stops[0].c;
    const last = stops[stops.length - 1];
    if (temp >= last.t) return last.c;
    let i = 0;
    while (temp > stops[i + 1].t) i++;
    const a = stops[i], b = stops[i + 1];
    const f = (temp - a.t) / (b.t - a.t);
    return [
        Math.round(a.c[0] + (b.c[0] - a.c[0]) * f),
        Math.round(a.c[1] + (b.c[1] - a.c[1]) * f),
        Math.round(a.c[2] + (b.c[2] - a.c[2]) * f)
    ];
}

export function cssColor(temp, palette) {
    const [r, g, b] = interpolateColor(temp, palette);
    return `rgb(${r}, ${g}, ${b})`;
}

// Tabela de cores pré-calculada por paleta (evita alocação por pixel)
export const LUT_SIZE = 512;
const lutCache = new Map();

export function getLUT(palette) {
    if (!lutCache.has(palette)) {
        const lut = new Uint8ClampedArray(LUT_SIZE * 3);
        for (let k = 0; k < LUT_SIZE; k++) {
            const t = SCALE_MIN + (k / (LUT_SIZE - 1)) * (SCALE_MAX - SCALE_MIN);
            lut.set(interpolateColor(t, palette), k * 3);
        }
        lutCache.set(palette, lut);
    }
    return lutCache.get(palette);
}

// Índice da LUT para uma temperatura, saturando nas pontas da escala
export function lutIndex(temp) {
    const k = ((temp - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * (LUT_SIZE - 1);
    return Math.min(LUT_SIZE - 1, Math.max(0, k | 0));
}
