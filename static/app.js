// Dados e estado
let earthData = [];
let grid = null;             // grade de temperatura usada pelo mapa e pelo tooltip
let simInterval = 90;
let currentTheme = 'thermal';
let lastUpdate = 0;
let renderedUpdate = null;   // last_update da textura atual (evita re-renderizar à toa)
let nextUpdate = Date.now();
let countdownIntervalId = null;

// Intervalo mínimo entre buscas, mesmo que o servidor anuncie um prazo no passado
const MIN_REFETCH_MS = 10 * 1000;
const RETRY_ON_ERROR_MS = 15 * 1000;
const FORCE_POLL_MS = 3 * 1000;
const FORCE_POLL_TIMEOUT_MS = 90 * 1000;

// Inicializa o globo - base mínima e limpa
const world = Globe()
    (document.getElementById('globe-container'))
    .globeImageUrl('https://unpkg.com/three-globe@2.45.6/example/img/earth-dark.jpg')
    .bumpImageUrl('https://unpkg.com/three-globe@2.45.6/example/img/earth-topology.png')
    .backgroundColor('#000000')
    .showAtmosphere(true)
    .atmosphereColor('#1a3a6b')
    .atmosphereAltitude(0.16);

// Rotação automática
world.controls().autoRotate = true;
world.controls().autoRotateSpeed = 0.35;
const controls = world.controls();
controls.addEventListener('start', () => { controls.autoRotate = false; });

// Aproxima a câmera para o planeta preencher mais a tela (sensação astronômica)
world.pointOfView({ lat: 0, lng: -60, altitude: 1.7 });

// Material da superfície: relevo do terreno (bump) + brilho sutil para parecer um planeta
const globeMat = world.globeMaterial();
globeMat.bumpScale = 6;
globeMat.shininess = 14;
try { globeMat.specular.set(0x223333); } catch (e) { /* three antigo */ }

// Iluminação: um "sol" direcional cria um terminador dia/noite em movimento e realça
// o relevo, enquanto uma luz ambiente forte mantém o lado noturno legível.
try {
    (world.lights() || []).forEach((light) => {
        if (light.type === 'AmbientLight') light.intensity = 0.75;
        else if (light.type === 'DirectionalLight') {
            light.intensity = 1.2;
            light.position.set(-1, 0.5, 1);
        }
    });
} catch (e) { /* mantém a iluminação padrão */ }

// ─── Paletas de cores ─────────────────────────────────────────────────────────

const paletteDefs = {
    thermal: [
        { t: -40, c: [31,  73, 125] },
        { t: -20, c: [44, 123, 182] },
        { t: -10, c: [116, 173, 209] },
        { t:   0, c: [171, 217, 233] },
        { t:  10, c: [145, 191, 138] },
        { t:  20, c: [215, 225,  90] },
        { t:  30, c: [253, 174,  97] },
        { t:  40, c: [230,  85,  40] },
        { t:  50, c: [165,   0,  38] }
    ],
    plasma: [
        { t: -40, c: [ 13,   8, 135] },
        { t: -10, c: [ 84,   2, 163] },
        { t:   5, c: [139,  10, 165] },
        { t:  15, c: [185,  50, 137] },
        { t:  25, c: [219,  92,  95] },
        { t:  35, c: [244, 136,  73] },
        { t:  50, c: [240, 249,  33] }
    ],
    magma: [
        { t: -40, c: [  0,   0,   4] },
        { t: -10, c: [ 51,  18,  58] },
        { t:   0, c: [120,  28,  72] },
        { t:  15, c: [189,  55,  51] },
        { t:  30, c: [237, 105,  37] },
        { t:  50, c: [253, 231, 157] }
    ],
    glacier: [
        { t: -40, c: [  8,  48, 107] },
        { t: -20, c: [ 33, 113, 181] },
        { t:   0, c: [107, 174, 214] },
        { t:  15, c: [189, 215, 231] },
        { t:  30, c: [222, 235, 247] },
        { t:  50, c: [247, 251, 255] }
    ]
};

function interpolateColor(temp, palette) {
    const stops = paletteDefs[palette] || paletteDefs.thermal;
    if (temp <= stops[0].t) return stops[0].c;
    if (temp >= stops[stops.length - 1].t) return stops[stops.length - 1].c;
    for (let i = 0; i < stops.length - 1; i++) {
        if (temp >= stops[i].t && temp <= stops[i + 1].t) {
            const f = (temp - stops[i].t) / (stops[i + 1].t - stops[i].t);
            return [
                Math.round(stops[i].c[0] + (stops[i+1].c[0] - stops[i].c[0]) * f),
                Math.round(stops[i].c[1] + (stops[i+1].c[1] - stops[i].c[1]) * f),
                Math.round(stops[i].c[2] + (stops[i+1].c[2] - stops[i].c[2]) * f)
            ];
        }
    }
    return [0, 0, 0];
}

// Tabela de cores pré-calculada por paleta (evita alocação por pixel)
const LUT_SIZE = 512;
const LUT_MIN = -60;
const LUT_MAX = 60;
const lutCache = {};

function getLUT(palette) {
    if (!lutCache[palette]) {
        const lut = new Uint8ClampedArray(LUT_SIZE * 3);
        for (let k = 0; k < LUT_SIZE; k++) {
            const t = LUT_MIN + (k / (LUT_SIZE - 1)) * (LUT_MAX - LUT_MIN);
            const [r, g, b] = interpolateColor(t, palette);
            lut[k * 3] = r; lut[k * 3 + 1] = g; lut[k * 3 + 2] = b;
        }
        lutCache[palette] = lut;
    }
    return lutCache[palette];
}

// Para as cores do tooltip
function tempToHex(temp) {
    const [r, g, b] = interpolateColor(temp, currentTheme);
    return `rgb(${r},${g},${b})`;
}

// ─── Textura do mapa de calor (canvas) ───────────────────────────────────────
// O mapa de calor é montado num canvas equiretangular e aplicado diretamente
// como textura da superfície do globo via globeImageUrl() do globe.gl. Isso garante
// alinhamento perfeito com a esfera e não precisa acessar o THREE diretamente.

const CANVAS_W = 2048;
const CANVAS_H = 1024;
const offscreenCanvas = document.createElement('canvas');
offscreenCanvas.width = CANVAS_W;
offscreenCanvas.height = CANVAS_H;
const ctx = offscreenCanvas.getContext('2d');

// Sobreposição tênue da Terra para os continentes ficarem reconhecíveis sob o mapa de calor
// Ajuste estes dois a gosto: TINT = separação terra/oceano, TEXTURE = detalhe de relevo
const EARTH_TINT_ALPHA = 0.16;
const EARTH_TEXTURE_ALPHA = 0.35;
const earthImg = new Image();
earthImg.crossOrigin = 'anonymous';
let earthImgLoaded = false;
earthImg.onload = () => {
    earthImgLoaded = true;
    if (earthData.length) applyHeatmap(earthData, currentTheme);
};
earthImg.onerror = () => { earthImgLoaded = false; };
earthImg.src = 'https://unpkg.com/three-globe@2.45.6/example/img/earth-dark.jpg';

// Fronteiras dos países como contornos vetoriais 3D nítidos (não pixelizam no zoom)
const BORDERS_URL = 'https://cdn.jsdelivr.net/gh/vasturiano/globe.gl@v2.46.2/example/datasets/ne_110m_admin_0_countries.geojson';

fetch(BORDERS_URL)
    .then(r => r.json())
    .then(geo => {
        const features = geo.features || [];
        world
            .polygonsData(features)
            .polygonCapColor(() => 'rgba(0, 0, 0, 0)')
            .polygonSideColor(() => 'rgba(0, 0, 0, 0)')
            .polygonStrokeColor(() => 'rgba(255, 255, 255, 0.55)')
            .polygonAltitude(() => 0.006)
            .polygonsTransitionDuration(0);
    })
    .catch(err => console.warn('Could not load borders GeoJSON', err));

// Busca binária: maior índice i com arr[i] <= v (limitado à faixa válida)
function bracket(arr, v) {
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
function buildGrid(points) {
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
function axisCell(axis, v) {
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
function sampleTemp(grid, lat, lng) {
    const [i0, i1, fy] = axisCell(grid.lats, lat);
    const [j0, j1, fx] = axisCell(grid.lngs, lng);
    return bilinear(grid.T[i0], grid.T[i1], j0, j1, fx, fy);
}

function renderHeatmapCanvas(grid, palette, withEarth) {
    const { lats, lngs, T } = grid;

    // Pré-calcula, por coluna, o intervalo de longitude + a fração
    const colLo = new Int32Array(CANVAS_W);
    const colHi = new Int32Array(CANVAS_W);
    const colFrac = new Float32Array(CANVAS_W);
    for (let px = 0; px < CANVAS_W; px++) {
        const lng = -180 + ((px + 0.5) / CANVAS_W) * 360;
        [colLo[px], colHi[px], colFrac[px]] = axisCell(lngs, lng);
    }

    const lut = getLUT(palette);
    const imageData = ctx.createImageData(CANVAS_W, CANVAS_H);
    const data = imageData.data;

    for (let py = 0; py < CANVAS_H; py++) {
        // O topo da textura é +90 (norte), a base é -90
        const lat = 90 - ((py + 0.5) / CANVAS_H) * 180;
        const [i0, i1, fy] = axisCell(lats, lat);
        const rowLo = T[i0];
        const rowHi = T[i1];

        for (let px = 0; px < CANVAS_W; px++) {
            const temp = bilinear(rowLo, rowHi, colLo[px], colHi[px], colFrac[px], fy);

            let k = ((temp - LUT_MIN) / (LUT_MAX - LUT_MIN)) * (LUT_SIZE - 1);
            k = k < 0 ? 0 : (k > LUT_SIZE - 1 ? LUT_SIZE - 1 : k) | 0;

            const idx = (py * CANVAS_W + px) * 4;
            data[idx]     = lut[k * 3];
            data[idx + 1] = lut[k * 3 + 1];
            data[idx + 2] = lut[k * 3 + 2];
            data[idx + 3] = 255;
        }
    }

    ctx.putImageData(imageData, 0, 0);

    // Continentes: tinte simples para separar terra/oceano + textura de relevo em soft-light
    if (withEarth && earthImgLoaded) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = EARTH_TINT_ALPHA;
        ctx.drawImage(earthImg, 0, 0, CANVAS_W, CANVAS_H);
        // Imprime o detalhe do terreno preservando a cor do mapa de calor
        ctx.globalCompositeOperation = 'soft-light';
        ctx.globalAlpha = EARTH_TEXTURE_ALPHA;
        ctx.drawImage(earthImg, 0, 0, CANVAS_W, CANVAS_H);
        ctx.restore();
    }
}

function applyHeatmap(points, palette) {
    if (!points || !points.length) return;
    grid = buildGrid(points);
    renderHeatmapCanvas(grid, palette, true);
    try {
        world.globeImageUrl(offscreenCanvas.toDataURL('image/jpeg', 0.92));
    } catch (e) {
        // Se a imagem cross-origin da Terra contaminou o canvas, tenta de novo sem ela
        earthImgLoaded = false;
        renderHeatmapCanvas(grid, palette, false);
        try {
            world.globeImageUrl(offscreenCanvas.toDataURL('image/jpeg', 0.92));
        } catch (e2) {
            console.error('Heatmap texture export failed', e2);
        }
    }
}

// ─── Tooltip (ao passar o mouse) ──────────────────────────────────────────────
const tooltip = document.createElement('div');
tooltip.className = 'scene-tooltip';
tooltip.hidden = true;
const tooltipTitle = Object.assign(document.createElement('div'), { className: 'tooltip-title', textContent: 'Temperature' });
const tooltipValue = Object.assign(document.createElement('div'), { className: 'tooltip-value' });
const tooltipCoords = Object.assign(document.createElement('div'), { className: 'tooltip-coords' });
tooltip.append(tooltipTitle, tooltipValue, tooltipCoords);
document.body.appendChild(tooltip);

function formatCoord(v, pos, neg) {
    return `${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`;
}

function hideTooltip() { tooltip.hidden = true; }

function showTooltipAt(clientX, clientY) {
    // Converte o pixel da tela sob o cursor em coordenadas do globo
    const coords = world.toGlobeCoords(clientX, clientY);
    if (!coords || !grid) {
        hideTooltip();
        return;
    }
    const temp = sampleTemp(grid, coords.lat, coords.lng);
    tooltipValue.textContent = `${temp.toFixed(1)}°C`;
    tooltipValue.style.color = tempToHex(temp);
    tooltipCoords.textContent = `${formatCoord(coords.lat, 'N', 'S')}, ${formatCoord(coords.lng, 'E', 'W')}`;
    tooltip.hidden = false;

    // Mantém o tooltip dentro da tela
    const { width, height } = tooltip.getBoundingClientRect();
    const left = clientX + 16 + width > window.innerWidth ? clientX - 16 - width : clientX + 16;
    const top = Math.min(Math.max(8, clientY - 10), window.innerHeight - height - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

const globeContainer = document.getElementById('globe-container');

// Mouse: acompanha o cursor, no máximo uma vez por quadro
let pendingPointer = null;
globeContainer.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    if (!pendingPointer) {
        requestAnimationFrame(() => {
            showTooltipAt(pendingPointer.x, pendingPointer.y);
            pendingPointer = null;
        });
    }
    pendingPointer = { x: e.clientX, y: e.clientY };
});
globeContainer.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') hideTooltip();
});

// Toque: um toque sem arrastar fixa o tooltip naquele ponto
let touchStart = null;
let touchHideTimer = null;
globeContainer.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') touchStart = { x: e.clientX, y: e.clientY };
});
globeContainer.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse' || !touchStart) return;
    const moved = Math.hypot(e.clientX - touchStart.x, e.clientY - touchStart.y);
    touchStart = null;
    if (moved > 8) { hideTooltip(); return; }
    showTooltipAt(e.clientX, e.clientY);
    clearTimeout(touchHideTimer);
    touchHideTimer = setTimeout(hideTooltip, 4000);
});

// ─── Busca e atualização ──────────────────────────────────────────────────────

function setStatus(text) {
    const statusLabel = document.getElementById('status-label');
    if (statusLabel) statusLabel.textContent = text;
}

async function fetchData() {
    let data;
    try {
        const response = await fetch('/api/data');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
    } catch (err) {
        console.error('Failed to fetch data', err);
        setStatus('Offline');
        nextUpdate = Date.now() + RETRY_ON_ERROR_MS;
        startCountdown();
        return null;
    }

    earthData   = data.points;
    simInterval = data.interval;
    lastUpdate  = data.last_update * 1000;
    // Nunca agenda a próxima busca para "agora": é o que causava o loop de requisições
    nextUpdate  = Math.max(data.next_update * 1000, Date.now() + MIN_REFETCH_MS);

    if (renderedUpdate !== data.last_update) {
        applyHeatmap(earthData, currentTheme);
        renderedUpdate = data.last_update;
    }

    setStatus(data.refreshing ? 'Updating' : (data.source === 'open-meteo') ? 'Live' : 'Sim');

    document.getElementById('min-temp').textContent = `${data.stats.min}°C`;
    document.getElementById('avg-temp').textContent = `${data.stats.avg}°C`;
    document.getElementById('max-temp').textContent = `${data.stats.max}°C`;
    const slider = document.getElementById('interval-slider');
    slider.min = data.interval_min;
    slider.max = data.interval_max;
    slider.value = simInterval;
    document.getElementById('interval-display').textContent = simInterval;

    startCountdown();
    return data;
}

async function updateSettings(settings) {
    const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
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
        const result = await updateSettings({ action: 'force_update' });
        if (result.refresh === 'cooldown') {
            const m = Math.floor(result.retry_after / 60);
            const s = String(result.retry_after % 60).padStart(2, '0');
            label.textContent = `Try again in ${m}:${s}`;
            await sleep(3000);
            return;
        }
        const before = lastUpdate;
        const deadline = Date.now() + FORCE_POLL_TIMEOUT_MS;
        setStatus('Updating');
        while (Date.now() < deadline) {
            await sleep(FORCE_POLL_MS);
            const data = await fetchData();
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

function startCountdown() {
    if (countdownIntervalId) clearInterval(countdownIntervalId);
    const tick = () => {
        const now       = Date.now();
        const remaining = Math.max(0, nextUpdate - now);
        const total     = simInterval * 60 * 1000;
        const progress  = Math.max(0, Math.min(100, (remaining / total) * 100));

        document.getElementById('update-progress').style.width = `${progress}%`;
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        document.getElementById('countdown-timer').textContent =
            `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

        if (remaining <= 0) {
            clearInterval(countdownIntervalId);
            countdownIntervalId = null;
            fetchData();
        }
    };
    tick();
    countdownIntervalId = setInterval(tick, 1000);
}

// ─── Ouvintes de eventos ──────────────────────────────────────────────────────

document.getElementById('theme-selector').addEventListener('change', (e) => {
    currentTheme = e.target.value;
    const atmoColors = {
        thermal: '#1a3a6b',
        plasma:  '#2d0059',
        magma:   '#6b1a00',
        glacier: '#003366'
    };
    world.atmosphereColor(atmoColors[currentTheme]);
    if (earthData.length) applyHeatmap(earthData, currentTheme);
});

document.getElementById('interval-slider').addEventListener('input', (e) => {
    document.getElementById('interval-display').textContent = e.target.value;
});
document.getElementById('interval-slider').addEventListener('change', async (e) => {
    try {
        await updateSettings({ interval: parseInt(e.target.value, 10) });
    } catch (err) {
        console.error('Failed to update interval', err);
    }
    fetchData();  // usa o intervalo efetivo devolvido pelo servidor
});
document.getElementById('force-update-btn').addEventListener('click', forceUpdate);

window.addEventListener('resize', () => {
    world.width(window.innerWidth);
    world.height(window.innerHeight);
});

// ─── Início ───────────────────────────────────────────────────────────────────
fetchData();