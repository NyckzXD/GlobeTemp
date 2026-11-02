// Textura do mapa de calor: campo interpolado → cores → canvas → textura do globo.

import { EARTH_TEXTURE_URL } from './config.js';
import { buildGrid, colorize, interpolateField } from './grid.js';

const CANVAS_W = 2048;
const CANVAS_H = 1024;

// Sobreposição tênue da Terra para os continentes ficarem reconhecíveis sob o mapa de calor
// Ajuste estes dois a gosto: TINT = separação terra/oceano, TEXTURE = detalhe de relevo
const EARTH_TINT_ALPHA = 0.16;
const EARTH_TEXTURE_ALPHA = 0.35;

export function createHeatmapLayer(world) {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(CANVAS_W, CANVAS_H);

    let grid = null;
    let field = null;      // temperaturas interpoladas por pixel (reaproveitadas ao trocar a paleta)
    let palette = null;
    let attached = false;  // o material do globo já usa o canvas como textura?

    const earthImg = new Image();
    earthImg.crossOrigin = 'anonymous';
    let earthImgLoaded = false;
    earthImg.onload = () => {
        earthImgLoaded = true;
        if (field) paint();
    };
    earthImg.src = EARTH_TEXTURE_URL;

    function drawEarthOverlay() {
        // Continentes: tinte simples para separar terra/oceano + textura de relevo em soft-light
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

    // Envia o canvas para o globo. Quando o material já tem uma textura, basta trocar a
    // imagem dela pelo canvas e pedir o reenvio à GPU: nada de toDataURL nem de recarregar
    // a textura por URL a cada atualização.
    function upload() {
        const map = world.globeMaterial().map;
        if (map) {
            if (!attached) {
                map.image = canvas;
                attached = true;
            }
            map.needsUpdate = true;
            return;
        }
        // Ainda sem textura (a imagem base não carregou): usa a URL uma vez
        world.globeImageUrl(canvas.toDataURL('image/jpeg', 0.92));
    }

    function paint() {
        colorize(field, palette, imageData.data);
        ctx.putImageData(imageData, 0, 0);
        if (earthImgLoaded) drawEarthOverlay();
        try {
            upload();
        } catch (err) {
            // Se a imagem cross-origin da Terra contaminou o canvas, tenta de novo sem ela
            if (!earthImgLoaded) throw err;
            console.warn('Earth overlay tainted the canvas; drawing without it', err);
            earthImgLoaded = false;
            paint();
        }
    }

    return {
        get grid() { return grid; },

        setPoints(points, newPalette) {
            if (!points || !points.length) return;
            grid = buildGrid(points);
            field = interpolateField(grid, CANVAS_W, CANVAS_H);
            palette = newPalette;
            paint();
        },

        setPalette(newPalette) {
            palette = newPalette;
            if (field) paint();
        }
    };
}
