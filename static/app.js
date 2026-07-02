// Data and state
let earthData = [];
let simInterval = 5; // minutes
let currentTheme = 'thermal';
let lastUpdate = Date.now();
let countdownIntervalId = null;

// Initialize Globe
const world = Globe()
    (document.getElementById('globe-container'))
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-night.jpg')
    .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
    .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
    .hexBinPointWeight('temp')
    .hexBinResolution(4) // 4 for higher resolution map-like appearance
    .hexMargin(0) // 0 to make hexagons touch and form a continuous surface
    .hexTopCurvatureResolution(2)
    .hexBinMerge(true)
    .showAtmosphere(true)
    .atmosphereColor('#3a228a')
    .atmosphereAltitude(0.15);

// Add custom auto-rotation
world.controls().autoRotate = true;
world.controls().autoRotateSpeed = 0.5;

// Stop auto-rotation when user interacts
const controls = world.controls();
controls.addEventListener('start', () => {
    controls.autoRotate = false;
});

// Color stops for realistic weather theme
const colorStops = [
    { t: -40, c: [49, 54, 149] },   // Dark blue
    { t: -20, c: [69, 117, 180] },  // Blue
    { t: -10, c: [116, 173, 209] }, // Light blue
    { t: 0,   c: [171, 217, 233] }, // Cyan
    { t: 10,  c: [145, 191, 138] }, // Green
    { t: 20,  c: [224, 230, 115] }, // Yellow-Green
    { t: 30,  c: [253, 174, 97] },  // Orange
    { t: 40,  c: [244, 109, 67] },  // Orange-Red
    { t: 50,  c: [215, 48, 39] }    // Dark Red
];

function interpolateColor(temp) {
    if (temp <= colorStops[0].t) return `rgb(${colorStops[0].c.join(',')})`;
    if (temp >= colorStops[colorStops.length - 1].t) return `rgb(${colorStops[colorStops.length - 1].c.join(',')})`;
    
    for (let i = 0; i < colorStops.length - 1; i++) {
        if (temp >= colorStops[i].t && temp <= colorStops[i+1].t) {
            const range = colorStops[i+1].t - colorStops[i].t;
            const fraction = (temp - colorStops[i].t) / range;
            const c1 = colorStops[i].c;
            const c2 = colorStops[i+1].c;
            const r = Math.round(c1[0] + (c2[0] - c1[0]) * fraction);
            const g = Math.round(c1[1] + (c2[1] - c1[1]) * fraction);
            const b = Math.round(c1[2] + (c2[2] - c1[2]) * fraction);
            return `rgb(${r},${g},${b})`;
        }
    }
}

// Theme palettes (mapped to -40 to +50 range)
const palettes = {
    thermal: (t) => interpolateColor(t),
    plasma: (t) => {
        // Purple -> Pink -> Orange -> Yellow
        const norm = Math.max(0, Math.min(1, (t + 40) / 90));
        return `hsl(${280 - norm * 220}, 100%, 60%)`;
    },
    magma: (t) => {
        // Black -> Dark Red -> Orange -> Yellow
        const norm = Math.max(0, Math.min(1, (t + 40) / 90));
        const lightness = 10 + norm * 40;
        return `hsl(${30 - norm * 30 + 330 * (1-norm)}, 100%, ${lightness}%)`; // Approximation
    },
    glacier: (t) => {
        // Dark Blue -> Cyan -> White
        const norm = Math.max(0, Math.min(1, (t + 40) / 90));
        return `hsl(${220 - norm * 40}, 100%, ${20 + norm * 80}%)`;
    }
};

const magColor = (t) => palettes[currentTheme](t);

// Tooltip accessor
world.hexLabel(d => {
    // d is the hex object. d.points contains the raw points in this hex.
    const avgTemp = d.points.reduce((sum, p) => sum + p.temp, 0) / d.points.length;
    return `
        <div class="tooltip-title">Avg Temperature</div>
        <div class="tooltip-value" style="color: ${magColor(avgTemp)}">${avgTemp.toFixed(1)}°C</div>
        <div style="font-size: 0.75rem; color: #7d8590; margin-top: 4px;">
            Points in area: ${d.points.length}
        </div>
    `;
});

world.hexAltitude(d => {
    // Completely flat surface on the globe
    return 0.001;
});

world.hexTopColor(d => {
    const avgTemp = d.points.reduce((sum, p) => sum + p.temp, 0) / d.points.length;
    return magColor(avgTemp);
});

world.hexSideColor(d => {
    const avgTemp = d.points.reduce((sum, p) => sum + p.temp, 0) / d.points.length;
    return magColor(avgTemp); // Solid color
});

world.hexTransitionDuration(1000);

// Fix lighting for better glowing effect
const scene = world.scene();
const ambientLight = scene.children.find(obj => obj.type === 'AmbientLight');
if (ambientLight) ambientLight.intensity = 1.2;

const directionalLight = scene.children.find(obj => obj.type === 'DirectionalLight');
if (directionalLight) directionalLight.intensity = 0.5;

// Fetch Data
async function fetchData() {
    try {
        const icon = document.querySelector('.fa-rotate');
        if (icon) icon.classList.add('loading');
        
        const response = await fetch('/api/data');
        const data = await response.json();
        
        earthData = data.points;
        simInterval = data.interval;
        lastUpdate = data.last_update * 1000; // Convert to JS ms
        
        world.hexBinPointsData(earthData);
        
        // Update stats
        document.getElementById('min-temp').textContent = `${data.stats.min}°C`;
        document.getElementById('avg-temp').textContent = `${data.stats.avg}°C`;
        document.getElementById('max-temp').textContent = `${data.stats.max}°C`;
        document.getElementById('interval-slider').value = simInterval;
        document.getElementById('interval-display').textContent = simInterval;
        
        if (icon) setTimeout(() => icon.classList.remove('loading'), 1000);
        
        startCountdown();
    } catch (err) {
        console.error("Failed to fetch data", err);
    }
}

// Update settings
async function updateSettings(settings) {
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        if (settings.action === 'force_update') {
            fetchData();
        }
    } catch (err) {
        console.error("Failed to update settings", err);
    }
}

// Countdown timer
function startCountdown() {
    if (countdownIntervalId) clearInterval(countdownIntervalId);
    
    const updateCountdown = () => {
        const now = Date.now();
        const nextUpdate = lastUpdate + (simInterval * 60 * 1000);
        const remaining = Math.max(0, nextUpdate - now);
        
        const totalMs = simInterval * 60 * 1000;
        const progress = Math.max(0, Math.min(100, (remaining / totalMs) * 100));
        
        document.getElementById('update-progress').style.width = `${progress}%`;
        
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        document.getElementById('countdown-timer').textContent = 
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            
        if (remaining <= 0) {
            fetchData();
        }
    };
    
    updateCountdown();
    countdownIntervalId = setInterval(updateCountdown, 1000);
}

// Event Listeners
document.getElementById('theme-selector').addEventListener('change', (e) => {
    currentTheme = e.target.value;
    
    // Change atmosphere color based on theme
    const atmosphereColors = {
        thermal: '#3a228a',
        plasma: '#4a148c',
        magma: '#b71c1c',
        glacier: '#01579b'
    };
    world.atmosphereColor(atmosphereColors[currentTheme]);
    
    // Re-trigger color functions
    world.hexTopColor(world.hexTopColor());
    world.hexSideColor(world.hexSideColor());
});

document.getElementById('interval-slider').addEventListener('input', (e) => {
    document.getElementById('interval-display').textContent = e.target.value;
});

document.getElementById('interval-slider').addEventListener('change', (e) => {
    const newInterval = parseInt(e.target.value);
    updateSettings({ interval: newInterval });
    simInterval = newInterval;
    startCountdown();
});

document.getElementById('force-update-btn').addEventListener('click', () => {
    updateSettings({ action: 'force_update' });
});

// Initial load
fetchData();

// Resize handling
window.addEventListener('resize', () => {
    world.width(window.innerWidth);
    world.height(window.innerHeight);
});
