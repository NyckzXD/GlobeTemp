// Data and state
let earthData = [];
let simInterval = 5;
let currentTheme = 'thermal';
let lastUpdate = Date.now();
let countdownIntervalId = null;
let heatmapMesh = null;
let heatmapTexture = null;

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
world.controls().autoRotateSpeed = 0.4;
const controls = world.controls();
controls.addEventListener('start', () => { controls.autoRotate = false; });

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

// For tooltip colors
function tempToHex(temp) {
    const [r, g, b] = interpolateColor(temp, currentTheme);
    return `rgb(${r},${g},${b})`;
}

// ─── Canvas Heatmap Texture ───────────────────────────────────────────────────

const CANVAS_W = 2048;
const CANVAS_H = 1024;
const offscreenCanvas = document.createElement('canvas');
offscreenCanvas.width = CANVAS_W;
offscreenCanvas.height = CANVAS_H;
const ctx = offscreenCanvas.getContext('2d');

function buildTempGrid(points) {
    // Build a 2D lookup: lat x lng -> temp
    const grid = {};
    for (const p of points) {
        const key = `${p.lat},${p.lng}`;
        grid[key] = p.temp;
    }
    return grid;
}

function renderHeatmapCanvas(points, palette) {
    // Create flat grid of temperatures, then bilinearly interpolate onto canvas
    const STEP = 4; // degrees
    const lats = [], lngs = [];
    for (let lat = -90; lat <= 90; lat += STEP) lats.push(lat);
    for (let lng = -180; lng <= 180; lng += STEP) lngs.push(lng);

    const grid = buildTempGrid(points);

    const imageData = ctx.createImageData(CANVAS_W, CANVAS_H);
    const data = imageData.data;

    for (let py = 0; py < CANVAS_H; py++) {
        // Lat: top = 90, bottom = -90
        const lat = 90 - (py / CANVAS_H) * 180;

        for (let px = 0; px < CANVAS_W; px++) {
            // Lng: left = -180, right = 180
            const lng = -180 + (px / CANVAS_W) * 360;

            // Find surrounding grid points for bilinear interpolation
            const latLow  = Math.floor(lat  / STEP) * STEP;
            const latHigh = latLow + STEP;
            const lngLow  = Math.floor(lng  / STEP) * STEP;
            const lngHigh = lngLow + STEP;

            const tLL = grid[`${latLow},${lngLow}`]   ?? 0;
            const tLH = grid[`${latLow},${lngHigh}`]  ?? 0;
            const tHL = grid[`${latHigh},${lngLow}`]  ?? 0;
            const tHH = grid[`${latHigh},${lngHigh}`] ?? 0;

            const fx = (lng - lngLow) / STEP;
            const fy = (lat - latLow) / STEP;

            const temp = tLL * (1 - fx) * (1 - fy)
                       + tLH * fx       * (1 - fy)
                       + tHL * (1 - fx) * fy
                       + tHH * fx       * fy;

            const [r, g, b] = interpolateColor(temp, palette);
            const idx = (py * CANVAS_W + px) * 4;
            data[idx]     = r;
            data[idx + 1] = g;
            data[idx + 2] = b;
            data[idx + 3] = 210; // slight transparency so globe beneath is visible
        }
    }

    ctx.putImageData(imageData, 0, 0);
}

function applyHeatmapOverlay(points, palette) {
    renderHeatmapCanvas(points, palette);

    const THREE = window.THREE;
    const scene = world.scene();

    // Remove old mesh
    if (heatmapMesh) {
        scene.remove(heatmapMesh);
        heatmapMesh.geometry.dispose();
        heatmapMesh.material.dispose();
        if (heatmapTexture) heatmapTexture.dispose();
    }

    // Create new texture from canvas
    heatmapTexture = new THREE.CanvasTexture(offscreenCanvas);
    heatmapTexture.needsUpdate = true;

    // Create sphere slightly larger than globe (globe radius = 100 in globe.gl)
    const geometry = new THREE.SphereGeometry(101, 128, 64);
    const material = new THREE.MeshLambertMaterial({
        map: heatmapTexture,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
    });

    heatmapMesh = new THREE.Mesh(geometry, material);
    scene.add(heatmapMesh);
}

// ─── Tooltip (mouse hover) ────────────────────────────────────────────────────
// We show tooltip by raycasting globe coords on hover
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

world.onGlobeHover((coords) => {
    if (!coords || !earthData.length) {
        tooltip.style.display = 'none';
        return;
    }
    // Find nearest data point
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
    }
});

document.getElementById('globe-container').addEventListener('mousemove', (e) => {
    tooltip.style.left = (e.clientX + 16) + 'px';
    tooltip.style.top  = (e.clientY - 10) + 'px';
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

        applyHeatmapOverlay(earthData, currentTheme);

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
        const now      = Date.now();
        const next     = lastUpdate + simInterval * 60 * 1000;
        const remaining = Math.max(0, next - now);
        const total    = simInterval * 60 * 1000;
        const progress = (remaining / total) * 100;

        document.getElementById('update-progress').style.width = `${progress}%`;
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        document.getElementById('countdown-timer').textContent =
            `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        if (remaining <= 0) fetchData();
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
    if (earthData.length) applyHeatmapOverlay(earthData, currentTheme);
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
