import { BORDERS_URL, EARTH_BUMP_URL, prefersReducedMotion } from './config.js';

// Inicializa o globo (o globe.gl é carregado como script global no index.html).
// A textura da superfície vem do mapa de calor (heatmap.js), então não há globeImageUrl aqui.
export function createGlobe(container) {
    const world = window.Globe()(container)
        .bumpImageUrl(EARTH_BUMP_URL)
        .backgroundColor('#000000')
        .showAtmosphere(true)
        .atmosphereColor('#1a3a6b')
        .atmosphereAltitude(0.16);

    // Rotação automática (desligada para quem pede menos movimento); para ao arrastar
    const controls = world.controls();
    controls.autoRotate = !prefersReducedMotion();
    controls.autoRotateSpeed = 0.35;
    controls.addEventListener('start', () => { controls.autoRotate = false; });

    // Aproxima a câmera para o planeta preencher mais a tela (sensação astronômica)
    world.pointOfView({ lat: 0, lng: -60, altitude: 1.7 });

    // Material da superfície: relevo do terreno (bump) + brilho sutil para parecer um planeta
    const globeMat = world.globeMaterial();
    globeMat.bumpScale = 6;
    globeMat.shininess = 14;
    try { globeMat.specular.set(0x223333); } catch { /* three antigo */ }

    // Iluminação: um "sol" direcional fixo realça o relevo, enquanto uma luz ambiente
    // forte mantém o lado oposto legível.
    try {
        (world.lights() || []).forEach((light) => {
            if (light.type === 'AmbientLight') light.intensity = 0.75;
            else if (light.type === 'DirectionalLight') {
                light.intensity = 1.2;
                light.position.set(-1, 0.5, 1);
            }
        });
    } catch { /* mantém a iluminação padrão */ }

    window.addEventListener('resize', () => {
        world.width(window.innerWidth);
        world.height(window.innerHeight);
    });

    return world;
}

// Fronteiras dos países como contornos vetoriais 3D nítidos (não pixelizam no zoom)
export async function loadBorders(world) {
    try {
        const geo = await (await fetch(BORDERS_URL)).json();
        world
            .polygonsData(geo.features || [])
            .polygonCapColor(() => 'rgba(0, 0, 0, 0)')
            .polygonSideColor(() => 'rgba(0, 0, 0, 0)')
            .polygonStrokeColor(() => 'rgba(255, 255, 255, 0.55)')
            .polygonAltitude(() => 0.006)
            .polygonsTransitionDuration(0);
    } catch (err) {
        console.warn('Could not load borders GeoJSON', err);
    }
}
