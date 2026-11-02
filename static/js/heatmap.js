// Mapa de calor na GPU: a grade horária vai inteira para uma textura de floats e o shader
// da superfície do globo interpola (bicúbica, igual a grid.js) e pinta cada fragmento.
// Nada de canvas de 2 M pixels: trocar de paleta ou de horário é só mudar um uniform.

import { packFrames } from './grid.js';
import { LUT_SIZE, SCALE_MAX, SCALE_MIN, getLUT } from './palettes.js';
import { sunDirection } from './sun.js';

// Constantes do Three.js (o globe.gl embute o Three, mas não exporta o módulo)
const NEAREST = 1003, LINEAR = 1006, UNSIGNED_BYTE = 1009, FLOAT = 1015, RGBA = 1023, RED = 1028;

// Cor do globo enquanto não há dados
const EMPTY_COLOR = '0.02, 0.025, 0.035';
// Brilho do lado noturno (o mapa continua legível) e faixa do crepúsculo, em seno da altura do
// sol: de −6° (fim do crepúsculo civil) a +3°
const NIGHT_LEVEL = '0.35';
const TWILIGHT = '-0.105, 0.052';

const VERTEX_DECL = /* glsl */ 'varying vec2 vGeoUv;\n';

const FRAGMENT_DECL = /* glsl */ `
varying vec2 vGeoUv;
uniform sampler2D uField;  // nLng x (nLat * horários), um float por texel
uniform sampler2D uLut;    // paleta: LUT_SIZE x 1, sRGB
uniform vec3 uGrid;        // lat0, lng0, passo (graus)
uniform int uNLat;
uniform int uNLng;
uniform int uFrame0;
uniform int uFrame1;
uniform float uMix;
uniform vec2 uScale;       // faixa da paleta (°C)
uniform float uReady;
uniform vec3 uSun;         // direção do sol: x → (0°, 0°), y → (0°, 90° L), z → polo norte

vec4 cubicWeights(float t) {
    float t2 = t * t, t3 = t2 * t;
    return vec4(-0.5 * t3 + t2 - 0.5 * t,
                1.5 * t3 - 2.5 * t2 + 1.0,
               -1.5 * t3 + 2.0 * t2 + 0.5 * t,
                0.5 * t3 - 0.5 * t2);
}

float gridValue(int frame, int row, int col) {
    int period = uNLng - 1;
    row = clamp(row, 0, uNLat - 1);
    col -= period * int(floor(float(col) / float(period)));  // módulo que dá a volta em ±180°
    return texelFetch(uField, ivec2(col, frame * uNLat + row), 0).r;
}

float bicubic(int frame, float lat, float lng) {
    float period = float(uNLng - 1);
    float gy = clamp((lat - uGrid.x) / uGrid.z, 0.0, float(uNLat - 1));
    float gx = mod((lng - uGrid.y) / uGrid.z, period);
    int iy = min(uNLat - 2, int(floor(gy)));
    int ix = int(floor(gx));
    vec4 wy = cubicWeights(gy - float(iy));
    vec4 wx = cubicWeights(gx - float(ix));
    float sum = 0.0;
    for (int a = 0; a < 4; a++) {
        int row = iy - 1 + a;
        vec4 v = vec4(gridValue(frame, row, ix - 1), gridValue(frame, row, ix),
                      gridValue(frame, row, ix + 1), gridValue(frame, row, ix + 2));
        sum += dot(v, wx) * wy[a];
    }
    return sum;
}

vec3 srgbToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 heatColor() {
    float lat = vGeoUv.y * 180.0 - 90.0;
    float lng = vGeoUv.x * 360.0 - 180.0;
    float t = bicubic(uFrame0, lat, lng);
    if (uMix > 0.0) t = mix(t, bicubic(uFrame1, lat, lng), uMix);
    float k = clamp((t - uScale.x) / (uScale.y - uScale.x), 0.0, 1.0);
    float lutSize = float(textureSize(uLut, 0).x);
    vec3 srgb = texture2D(uLut, vec2((k * (lutSize - 1.0) + 0.5) / lutSize, 0.5)).rgb;
    return srgbToLinear(srgb);  // o renderer converte de volta para sRGB na saída
}

// Terminador dia/noite: seno da altura do sol no fragmento, suavizado no crepúsculo
float daylight() {
    float lat = radians(vGeoUv.y * 180.0 - 90.0);
    float lng = radians(vGeoUv.x * 360.0 - 180.0);
    vec3 n = vec3(cos(lat) * cos(lng), cos(lat) * sin(lng), sin(lat));
    return mix(${NIGHT_LEVEL}, 1.0, smoothstep(${TWILIGHT}, dot(n, uSun)));
}
`;

// Cria uma textura de dados com o construtor de Texture que o globe.gl já tem carregado
function dataTexture(Texture, data, width, height, format, type, filter) {
    const tex = new Texture();
    tex.image = { data, width, height };
    tex.isDataTexture = true;
    tex.format = format;
    tex.type = type;
    tex.magFilter = tex.minFilter = filter;
    tex.generateMipmaps = false;
    tex.flipY = false;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    return tex;
}

function lutRGBA(palette) {
    const rgb = getLUT(palette);
    const rgba = new Uint8Array(LUT_SIZE * 4);
    for (let k = 0; k < LUT_SIZE; k++) {
        rgba.set(rgb.subarray(k * 3, k * 3 + 3), k * 4);
        rgba[k * 4 + 3] = 255;
    }
    return rgba;
}

export function createHeatmapLayer(world) {
    // O pós-processamento do globe.gl tem um render target: a textura dele dá o construtor
    const Texture = world.postProcessingComposer().renderTarget1.texture.constructor;

    let grid = null;
    let fieldTex = null;
    const lutTex = dataTexture(Texture, new Uint8Array(LUT_SIZE * 4), LUT_SIZE, 1, RGBA, UNSIGNED_BYTE, LINEAR);

    const uniforms = {
        uField: { value: null },
        uLut: { value: lutTex },
        uGrid: { value: [0, 0, 1] },
        uNLat: { value: 2 },
        uNLng: { value: 2 },
        uFrame0: { value: 0 },
        uFrame1: { value: 0 },
        uMix: { value: 0 },
        uScale: { value: [SCALE_MIN, SCALE_MAX] },
        uReady: { value: 0 },
        uSun: { value: sunDirection(Date.now()) }
    };

    // Reaproveita o material Phong do globo e troca só a cor final do fragmento
    // (sem textura, sem relevo e sem sombreamento: cor chapada, como no nullschool).
    const material = world.globeMaterial();
    material.map = null;
    material.bumpMap = null;
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = VERTEX_DECL + shader.vertexShader.replace(
            '#include <uv_vertex>', '#include <uv_vertex>\n\tvGeoUv = uv;');
        shader.fragmentShader = FRAGMENT_DECL + shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            `outgoingLight = (uReady > 0.5 ? heatColor() : vec3(${EMPTY_COLOR})) * daylight();\n\t#include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => 'globetemp-heatmap';
    material.needsUpdate = true;

    return {
        get grid() { return grid; },

        setGrid(newGrid) {
            const height = newGrid.nLat * newGrid.frames.length;
            const data = packFrames(newGrid);
            // Mesmo tamanho: só reenvia os dados; senão cria outra textura (as da GPU têm tamanho fixo)
            if (fieldTex && fieldTex.image.width === newGrid.nLng && fieldTex.image.height === height) {
                fieldTex.image.data = data;
                fieldTex.needsUpdate = true;
            } else {
                fieldTex?.dispose();
                fieldTex = dataTexture(Texture, data, newGrid.nLng, height, RED, FLOAT, NEAREST);
            }
            grid = newGrid;
            uniforms.uField.value = fieldTex;
            uniforms.uGrid.value = [newGrid.lat0, newGrid.lng0, newGrid.step];
            uniforms.uNLat.value = newGrid.nLat;
            uniforms.uNLng.value = newGrid.nLng;
            uniforms.uReady.value = 1;
        },

        setPalette(palette) {
            lutTex.image.data = lutRGBA(palette);
            lutTex.needsUpdate = true;
        },

        // Posição fracionária na série: mistura os dois horários vizinhos
        setTime(t) {
            if (!grid) return;
            const last = grid.frames.length - 1;
            const tc = Math.min(last, Math.max(0, t));
            const f0 = Math.floor(tc);
            uniforms.uFrame0.value = f0;
            uniforms.uFrame1.value = Math.min(last, f0 + 1);
            uniforms.uMix.value = tc - f0;
        },

        // Instante UTC exibido (ms): move o terminador
        setSunTime(ms) {
            uniforms.uSun.value = sunDirection(ms);
        }
    };
}
