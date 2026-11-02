import { COASTLINES_URL, prefersReducedMotion } from './config.js';
import { topologyLines } from './topology.js';

// Linhas um tiquinho acima da superfície (raio do globo = 100) para não brigar com ela no z-buffer
const LINE_ALTITUDE = 0.002;
const COAST_COLOR = 0xffffff;
const COAST_OPACITY = 0.75;
const BORDER_OPACITY = 0.22;

// Inicializa o globo (o globe.gl é carregado como script global no index.html).
// A superfície é pintada pelo shader do mapa de calor (heatmap.js): sem textura nem relevo.
export function createGlobe(container) {
    const world = window.Globe()(container)
        .backgroundColor('#000000')
        .showAtmosphere(true)
        .atmosphereColor('#1a3a6b')
        .atmosphereAltitude(0.12);

    // Rotação automática (desligada para quem pede menos movimento); para ao arrastar
    const controls = world.controls();
    controls.autoRotate = !prefersReducedMotion();
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener('start', () => { controls.autoRotate = false; });

    // Aproxima a câmera para o planeta preencher mais a tela
    world.pointOfView({ lat: 0, lng: -60, altitude: 1.7 });

    window.addEventListener('resize', () => {
        world.width(window.innerWidth);
        world.height(window.innerHeight);
    });

    return world;
}

// Um LineSegments do three-globe (o da grade de graticules) já está na cena: os construtores
// dele servem para montar as nossas linhas sem carregar um segundo Three.js.
function findLineSegments(scene) {
    let found = null;
    scene.traverse((obj) => { if (!found && obj.isLineSegments) found = obj; });
    return found;
}

// Uma geometria só para todas as linhas (um draw call): pares de pontos consecutivos
function buildLines(world, template, lines, opacity) {
    const positions = [];
    for (const line of lines) {
        let prev = null;
        for (const [lng, lat] of line) {
            const p = world.getCoords(lat, lng, LINE_ALTITUDE);
            if (prev) positions.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
            prev = p;
        }
    }
    // A geometria do modelo é uma subclasse (GeoJsonGeometry) que exige argumentos: sobe até
    // a classe que define setAttribute, a BufferGeometry
    let Geometry = template.geometry.constructor;
    while (Geometry.prototype && !Object.hasOwn(Geometry.prototype, 'setAttribute')) {
        Geometry = Object.getPrototypeOf(Geometry);
    }
    const Attribute = template.geometry.attributes.position.constructor;
    const Material = template.material.constructor;
    const geometry = new Geometry();
    geometry.setAttribute('position', new Attribute(new Float32Array(positions), 3));
    const material = new Material({ color: COAST_COLOR, transparent: true, opacity, depthWrite: false });
    return new template.constructor(geometry, material);
}

// Linhas de costa (nítidas, como no nullschool) e fronteiras bem discretas, em vetor 3D
export async function loadCoastlines(world) {
    try {
        const topology = await (await fetch(COASTLINES_URL)).json();
        const { coasts, borders } = topologyLines(topology, 'countries');
        // A grade de graticules é montada de forma assíncrona: espera ela aparecer
        let template = findLineSegments(world.scene());
        for (let i = 0; !template && i < 50; i++) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            template = findLineSegments(world.scene());
        }
        if (!template) throw new Error('no LineSegments in the globe.gl scene');
        world.scene().add(buildLines(world, template, coasts, COAST_OPACITY));
        world.scene().add(buildLines(world, template, borders, BORDER_OPACITY));
    } catch (err) {
        console.warn('Could not load coastlines', err);
    }
}
