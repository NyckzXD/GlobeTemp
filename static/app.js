// Data and state
let earthData = [];
let simInterval = 15;
let currentTheme = 'thermal';
let lastUpdate = Date.now();
let nextUpdate = Date.now() + simInterval * 60 * 1000;
let countdownIntervalId = null;

// Initialize Globe - minimal, clean base
const world = Globe()
    (document.getElementById('globe-container'))
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-dark.jpg')
    .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
    .showAtmosphere(true)
    .atmosphereColor('#1a3a6b')
    .atmosphereAltitude(0.12);

// Auto-rotation
world.controls().autoRotate = true;
world.controls().autoRotateSpeed = 0.35;
const controls = world.controls();
controls.addEventListener('start', () => { controls.autoRotate = false; });

// Bring the camera closer so the planet fills more of the view (astronomical feel)
world.pointOfView({ lat: 0, lng: -60, altitude: 1.7 });

// ─── Color Palettes ───────────────────────────────────────────────────────────

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

// Precomputed color lookup table per palette (avoids per-pixel allocation)
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

// For tooltip colors
function tempToHex(temp) {
    const [r, g, b] = interpolateColor(temp, currentTheme);
    return `rgb(${r},${g},${b})`;
}

// ─── Canvas Heatmap Texture ───────────────────────────────────────────────────
// The heatmap is composited into an equirectangular canvas and applied directly
// as the globe's surface texture via globe.gl's globeImageUrl(). This guarantees
// perfect alignment with the sphere and needs no direct access to THREE.

const CANVAS_W = 2048;
const CANVAS_H = 1024;
const offscreenCanvas = document.createElement('canvas');
offscreenCanvas.width = CANVAS_W;
offscreenCanvas.height = CANVAS_H;
const ctx = offscreenCanvas.getContext('2d');

// Faint Earth overlay so continents remain recognizable under the heatmap
// Tweak these two to taste: TINT = flat land/ocean separation, TEXTURE = relief detail
const EARTH_TINT_ALPHA = 0.16;
const EARTH_TEXTURE_ALPHA = 0.6;
const earthImg = new Image();
earthImg.crossOrigin = 'anonymous';
let earthImgLoaded = false;
earthImg.onload = () => {
    earthImgLoaded = true;
    if (earthData.length) applyHeatmap(earthData, currentTheme);
};
earthImg.onerror = () => { earthImgLoaded = false; };
earthImg.src = 'https://unpkg.com/three-globe/example/img/earth-dark.jpg';

// Country borders (drawn crisply onto the texture for clear continents)
const BORDERS_URL = 'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson';
let borderRings = null; // array of rings, each ring = array of [lng, lat]

fetch(BORDERS_URL)
    .then(r => r.json())
    .then(geo => {
        const rings = [];
        for (const f of (geo.features || [])) {
            const g = f.geometry;
            if (!g) continue;
            if (g.type === 'Polygon') {
                for (const ring of g.coordinates) rings.push(ring);
            } else if (g.type === 'MultiPolygon') {
                for (const poly of g.coordinates) for (const ring of poly) rings.push(ring);
            }
        }
        borderRings = rings;
        if (earthData.length) applyHeatmap(earthData, currentTheme);
    })
    .catch(err => console.warn('Could not load borders GeoJSON', err));

function strokeBorderRings() {
    const W = CANVAS_W, H = CANVAS_H;
    for (const ring of borderRings) {
        ctx.beginPath();
        let prevX = null;
        for (let i = 0; i < ring.length; i++) {
            const x = ((ring[i][0] + 180) / 360) * W;
            const y = ((90 - ring[i][1]) / 180) * H;
            if (i === 0 || (prevX !== null && Math.abs(x - prevX) > W / 2)) {
                // start, or antimeridian wrap: break the segment instead of streaking
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            prevX = x;
        }
        ctx.stroke();
    }
}

function drawBorders() {
    if (!borderRings) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // dark halo underneath for contrast on light areas
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 2.6;
    strokeBorderRings();
    // crisp bright outline on top
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.1;
    strokeBorderRings();
    ctx.restore();
}

// Binary search: largest index i with arr[i] <= v (clamped to valid range)
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

function renderHeatmapCanvas(points, palette, withEarth) {
    // Derive the actual grid axes straight from the data (no assumption of step/offset)
    const latSet = new Set(), lngSet = new Set();
    for (const p of points) { latSet.add(p.lat); lngSet.add(p.lng); }
    const lats = [...latSet].sort((a, b) => a - b); // ascending: south -> north
    const lngs = [...lngSet].sort((a, b) => a - b); // ascending: west -> east

    const idxLat = new Map(lats.map((v, i) => [v, i]));
    const idxLng = new Map(lngs.map((v, i) => [v, i]));

    // 2D temperature array T[latIndex][lngIndex]
    const T = lats.map(() => new Float32Array(lngs.length));
    for (const p of points) {
        T[idxLat.get(p.lat)][idxLng.get(p.lng)] = p.temp;
    }

    // Precompute per-column longitude bracket + fraction
    const colLo = new Int32Array(CANVAS_W);
    const colFrac = new Float32Array(CANVAS_W);
    for (let px = 0; px < CANVAS_W; px++) {
        const lng = -180 + ((px + 0.5) / CANVAS_W) * 360;
        const j = bracket(lngs, lng);
        colLo[px] = j;
        const lo = lngs[j];
        const hi = lngs[Math.min(j + 1, lngs.length - 1)];
        colFrac[px] = hi > lo ? (lng - lo) / (hi - lo) : 0;
    }

    const lut = getLUT(palette);
    const imageData = ctx.createImageData(CANVAS_W, CANVAS_H);
    const data = imageData.data;

    for (let py = 0; py < CANVAS_H; py++) {
        // Top of the texture is +90 (north), bottom is -90
        const lat = 90 - ((py + 0.5) / CANVAS_H) * 180;
        const i0 = bracket(lats, lat);
        const i1 = Math.min(i0 + 1, lats.length - 1);
        const latLo = lats[i0];
        const latHi = lats[i1];
        const fy = latHi > latLo ? (lat - latLo) / (latHi - latLo) : 0;
        const rowLo = T[i0];
        const rowHi = T[i1];

        for (let px = 0; px < CANVAS_W; px++) {
            const j0 = colLo[px];
            const j1 = Math.min(j0 + 1, lngs.length - 1);
            const fx = colFrac[px];

            const tLL = rowLo[j0];
            const tLH = rowLo[j1];
            const tHL = rowHi[j0];
            const tHH = rowHi[j1];

            const temp = tLL * (1 - fx) * (1 - fy)
                       + tLH * fx       * (1 - fy)
                       + tHL * (1 - fx) * fy
                       + tHH * fx       * fy;

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

    // Continents: flat tint for land/ocean separation + soft-light relief texture
    if (withEarth && earthImgLoaded) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = EARTH_TINT_ALPHA;
        ctx.drawImage(earthImg, 0, 0, CANVAS_W, CANVAS_H);
        // Imprints terrain detail while preserving the heatmap hue
        ctx.globalCompositeOperation = 'soft-light';
        ctx.globalAlpha = EARTH_TEXTURE_ALPHA;
        ctx.drawImage(earthImg, 0, 0, CANVAS_W, CANVAS_H);
        ctx.restore();
    }

    // Crisp country borders on top
    drawBorders();
}

function applyHeatmap(points, palette) {
    if (!points || !points.length) return;
    renderHeatmapCanvas(points, palette, true);
    try {
        world.globeImageUrl(offscreenCanvas.toDataURL('image/jpeg', 0.92));
    } catch (e) {
        // If the cross-origin Earth image tainted the canvas, retry without it
        earthImgLoaded = false;
        renderHeatmapCanvas(points, palette, false);
        try {
            world.globeImageUrl(offscreenCanvas.toDataURL('image/jpeg', 0.92));
        } catch (e2) {
            console.error('Heatmap texture export failed', e2);
        }
    }
}

// ─── Tooltip (mouse hover) ────────────────────────────────────────────────────
const tooltip = document.createElement('div');
tooltip.id = 'heatmap-tooltip';
tooltip.style.cssText = `
    position: fixed;
    display: none;
    background: rgba(13,17,23,0.88);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 10px;
    padding: 10px 14px;
    color: #e6edf3;
    font-family: 'Outfit', sans-serif;
    font-size: 0.85rem;
    pointer-events: none;
    z-index: 999;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
`;
document.body.appendChild(tooltip);

function showTooltipAt(clientX, clientY) {
    // Convert the viewport pixel under the cursor to globe coordinates
    const coords = world.toGlobeCoords(clientX, clientY);
    if (!coords || !earthData.length) {
        tooltip.style.display = 'none';
        return;
    }
    let best = null, bestDist = Infinity;
    for (const p of earthData) {
        const d = Math.abs(p.lat - coords.lat) + Math.abs(p.lng - coords.lng);
        if (d < bestDist) { bestDist = d; best = p; }
    }
    if (best) {
        const color = tempToHex(best.temp);
        tooltip.innerHTML = `
            <div style="font-size:0.72rem;color:#7d8590;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Temperature</div>
            <div style="font-size:1.3rem;font-weight:700;color:${color}">${best.temp.toFixed(1)}°C</div>
            <div style="font-size:0.72rem;color:#7d8590;margin-top:4px">${coords.lat.toFixed(1)}°, ${coords.lng.toFixed(1)}°</div>
        `;
        tooltip.style.display = 'block';
        tooltip.style.left = (clientX + 16) + 'px';
        tooltip.style.top  = (clientY - 10) + 'px';
    } else {
        tooltip.style.display = 'none';
    }
}

document.getElementById('globe-container').addEventListener('mousemove', (e) => {
    showTooltipAt(e.clientX, e.clientY);
});

document.getElementById('globe-container').addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
});

// ─── Fetch & Update ───────────────────────────────────────────────────────────

async function fetchData() {
    try {
        const icon = document.querySelector('.fa-rotate');
        if (icon) icon.classList.add('loading');

        const response = await fetch('/api/data');
        const data = await response.json();

        earthData   = data.points;
        simInterval = data.interval;
        lastUpdate  = data.last_update * 1000;
        nextUpdate  = (data.next_update ? data.next_update * 1000
                                        : lastUpdate + simInterval * 60 * 1000);

        applyHeatmap(earthData, currentTheme);

        const statusLabel = document.getElementById('status-label');
        if (statusLabel) statusLabel.textContent = (data.source === 'open-meteo') ? 'Live' : 'Sim';

        document.getElementById('min-temp').textContent = `${data.stats.min}°C`;
        document.getElementById('avg-temp').textContent = `${data.stats.avg}°C`;
        document.getElementById('max-temp').textContent = `${data.stats.max}°C`;
        document.getElementById('interval-slider').value = simInterval;
        document.getElementById('interval-display').textContent = simInterval;

        if (icon) setTimeout(() => icon.classList.remove('loading'), 800);
        startCountdown();
    } catch (err) {
        console.error('Failed to fetch data', err);
    }
}

async function updateSettings(settings) {
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        if (settings.action === 'force_update') fetchData();
    } catch (err) {
        console.error('Failed to update settings', err);
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

// ─── Event Listeners ──────────────────────────────────────────────────────────

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
document.getElementById('interval-slider').addEventListener('change', (e) => {
    const v = parseInt(e.target.value);
    updateSettings({ interval: v });
    simInterval = v;
    startCountdown();
});
document.getElementById('force-update-btn').addEventListener('click', () => {
    updateSettings({ action: 'force_update' });
});

window.addEventListener('resize', () => {
    world.width(window.innerWidth);
    world.height(window.innerHeight);
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
fetchData();