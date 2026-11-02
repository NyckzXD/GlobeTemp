import { getData, postSettings } from './api.js';
import { FORCE_POLL_MS, FORCE_POLL_TIMEOUT_MS, MIN_REFETCH_MS, RETRY_ON_ERROR_MS } from './config.js';
import { createGlobe, loadBorders } from './globe.js';
import { createHeatmapLayer } from './heatmap.js';
import { DEFAULT_PALETTE, PALETTES } from './palettes.js';
import { fillPaletteSelect, renderLegend } from './ui/legend.js';
import { initPanel } from './ui/panel.js';
import { setStatus, statusFor, updateObservedAt, updateStats } from './ui/status.js';
import { initTooltip } from './ui/tooltip.js';

const PALETTE_KEY = 'globetemp.palette';

// ─── Estado ───────────────────────────────────────────────────────────────────
const state = {
    palette: DEFAULT_PALETTE,
    interval: 90,
    lastUpdate: 0,         // ms
    renderedUpdate: null,  // last_update da textura atual (evita re-renderizar à toa)
    nextUpdate: Date.now(),
    countdownId: null
};

try {
    const saved = localStorage.getItem(PALETTE_KEY);
    if (saved && PALETTES[saved]) state.palette = saved;
} catch { /* storage bloqueado */ }

// ─── Globo e camadas ──────────────────────────────────────────────────────────
const container = document.getElementById('globe-container');
const world = createGlobe(container);
const heatmap = createHeatmapLayer(world);
loadBorders(world);
initTooltip(world, container, () => heatmap.grid, () => state.palette);
initPanel();

// ─── Busca e atualização ──────────────────────────────────────────────────────
async function refresh() {
    let data;
    try {
        data = await getData();
    } catch (err) {
        console.error('Failed to fetch data', err);
        setStatus('offline');
        state.nextUpdate = Date.now() + RETRY_ON_ERROR_MS;
        startCountdown();
        return null;
    }

    state.interval = data.interval;
    state.lastUpdate = data.last_update * 1000;
    // Nunca agenda a próxima busca para "agora": é o que causava o loop de requisições
    state.nextUpdate = Math.max(data.next_update * 1000, Date.now() + MIN_REFETCH_MS);

    if (state.renderedUpdate !== data.last_update) {
        heatmap.setPoints(data.points, state.palette);
        state.renderedUpdate = data.last_update;
    }

    setStatus(statusFor(data));
    updateObservedAt(data);
    updateStats(data.stats);

    const slider = document.getElementById('interval-slider');
    slider.min = data.interval_min;
    slider.max = data.interval_max;
    slider.value = state.interval;
    document.getElementById('interval-display').textContent = state.interval;

    startCountdown();
    return data;
}

function startCountdown() {
    clearInterval(state.countdownId);
    const tick = () => {
        const remaining = Math.max(0, state.nextUpdate - Date.now());
        const total = state.interval * 60 * 1000;
        const progress = Math.max(0, Math.min(100, (remaining / total) * 100));

        document.getElementById('update-progress').style.width = `${progress}%`;
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        document.getElementById('countdown-timer').textContent =
            `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

        if (remaining <= 0) {
            clearInterval(state.countdownId);
            state.countdownId = null;
            refresh();
        }
    };
    tick();
    state.countdownId = setInterval(tick, 1000);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pede a atualização e espera o servidor terminar de buscar os dados novos
async function forceUpdate() {
    const btn = document.getElementById('force-update-btn');
    const icon = btn.querySelector('.fa-rotate');
    const label = btn.querySelector('.btn-label');
    btn.disabled = true;
    icon.classList.add('loading');
    try {
        const result = await postSettings({ action: 'force_update' });
        if (result.refresh === 'cooldown') {
            const m = Math.floor(result.retry_after / 60);
            const s = String(result.retry_after % 60).padStart(2, '0');
            label.textContent = `Try again in ${m}:${s}`;
            await sleep(3000);
            return;
        }
        const before = state.lastUpdate;
        const deadline = Date.now() + FORCE_POLL_TIMEOUT_MS;
        setStatus('updating');
        while (Date.now() < deadline) {
            await sleep(FORCE_POLL_MS);
            const data = await refresh();
            if (data && !data.refreshing && data.last_update * 1000 !== before) break;
        }
    } catch (err) {
        console.error('Failed to force update', err);
    } finally {
        label.textContent = 'Force Update';
        icon.classList.remove('loading');
        btn.disabled = false;
    }
}

// ─── Controles ────────────────────────────────────────────────────────────────
function applyPalette(palette) {
    state.palette = palette;
    world.atmosphereColor(PALETTES[palette].atmosphere);
    renderLegend(palette);
    heatmap.setPalette(palette);
}

const paletteSelect = document.getElementById('theme-selector');
fillPaletteSelect(paletteSelect, state.palette);
paletteSelect.addEventListener('change', (e) => {
    applyPalette(e.target.value);
    try { localStorage.setItem(PALETTE_KEY, e.target.value); } catch { /* storage bloqueado */ }
});

const slider = document.getElementById('interval-slider');
slider.addEventListener('input', (e) => {
    document.getElementById('interval-display').textContent = e.target.value;
});
slider.addEventListener('change', async (e) => {
    try {
        await postSettings({ interval: parseInt(e.target.value, 10) });
    } catch (err) {
        console.error('Failed to update interval', err);
    }
    refresh();  // usa o intervalo efetivo devolvido pelo servidor
});

document.getElementById('force-update-btn').addEventListener('click', forceUpdate);

// ─── Início ───────────────────────────────────────────────────────────────────
applyPalette(state.palette);
refresh();
