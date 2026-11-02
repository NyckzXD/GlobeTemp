import { sampleTemp } from '../grid.js';
import { cssColor } from '../palettes.js';

function formatCoord(v, pos, neg) {
    return `${Math.abs(v).toFixed(1)}°${v >= 0 ? pos : neg}`;
}

// Tooltip com a temperatura interpolada sob o cursor (ou sob o toque, no celular).
// `getGrid`, `getTime` e `getPalette` são lidos a cada uso para refletir o estado atual.
export function initTooltip(world, container, getGrid, getTime, getPalette) {
    const tooltip = document.createElement('div');
    tooltip.className = 'heatmap-tooltip';
    tooltip.hidden = true;
    const title = Object.assign(document.createElement('div'), { className: 'tooltip-title', textContent: 'Temperature' });
    const value = Object.assign(document.createElement('div'), { className: 'tooltip-value' });
    const coordsEl = Object.assign(document.createElement('div'), { className: 'tooltip-coords' });
    tooltip.append(title, value, coordsEl);
    document.body.appendChild(tooltip);

    const hide = () => { tooltip.hidden = true; };

    function showAt(clientX, clientY) {
        // Converte o pixel da tela sob o cursor em coordenadas do globo
        const coords = world.toGlobeCoords(clientX, clientY);
        const grid = getGrid();
        if (!coords || !grid) {
            hide();
            return;
        }
        const temp = sampleTemp(grid, coords.lat, coords.lng, getTime());
        value.textContent = `${temp.toFixed(1)}°C`;
        value.style.color = cssColor(temp, getPalette());
        coordsEl.textContent = `${formatCoord(coords.lat, 'N', 'S')}, ${formatCoord(coords.lng, 'E', 'W')}`;
        tooltip.hidden = false;

        // Mantém o tooltip dentro da tela
        const { width, height } = tooltip.getBoundingClientRect();
        const left = clientX + 16 + width > window.innerWidth ? clientX - 16 - width : clientX + 16;
        const top = Math.min(Math.max(8, clientY - 10), window.innerHeight - height - 8);
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    // Mouse: acompanha o cursor, no máximo uma vez por quadro
    let pending = null;
    container.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        if (!pending) {
            requestAnimationFrame(() => {
                showAt(pending.x, pending.y);
                pending = null;
            });
        }
        pending = { x: e.clientX, y: e.clientY };
    });
    container.addEventListener('pointerleave', (e) => {
        if (e.pointerType === 'mouse') hide();
    });

    // Toque: um toque sem arrastar fixa o tooltip naquele ponto
    let touchStart = null;
    let hideTimer = null;
    container.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse') touchStart = { x: e.clientX, y: e.clientY };
    });
    container.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'mouse' || !touchStart) return;
        const moved = Math.hypot(e.clientX - touchStart.x, e.clientY - touchStart.y);
        touchStart = null;
        if (moved > 8) { hide(); return; }
        showAt(e.clientX, e.clientY);
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 4000);
    });
}
