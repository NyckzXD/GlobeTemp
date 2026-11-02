import { PALETTES, SCALE_MAX, SCALE_MIN, cssColor } from '../palettes.js';

const TICKS = [-40, -20, 0, 20, 40];
const position = (t) => `${((t - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100}%`;

// Preenche o <select> de escalas a partir de PALETTES (fonte única das opções)
export function fillPaletteSelect(select, current) {
    select.replaceChildren(...Object.entries(PALETTES).map(([id, { label }]) => {
        const option = new Option(label, id);
        option.selected = id === current;
        return option;
    }));
}

export function renderLegend(palette) {
    const stops = [];
    for (let t = SCALE_MIN; t <= SCALE_MAX; t += 5) {
        stops.push(`${cssColor(t, palette)} ${position(t)}`);
    }
    document.getElementById('legend-bar').style.background = `linear-gradient(90deg, ${stops.join(', ')})`;

    document.getElementById('legend-ticks').replaceChildren(...TICKS.map((t) => {
        const span = document.createElement('span');
        span.textContent = `${t}°`;
        span.style.left = position(t);
        return span;
    }));
}
