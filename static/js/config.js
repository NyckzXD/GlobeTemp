// Recursos externos com versão fixa (ver index.html para o globe.gl)
export const EARTH_TEXTURE_URL = 'https://unpkg.com/three-globe@2.45.6/example/img/earth-dark.jpg';
export const EARTH_BUMP_URL = 'https://unpkg.com/three-globe@2.45.6/example/img/earth-topology.png';
export const BORDERS_URL = 'https://cdn.jsdelivr.net/gh/vasturiano/globe.gl@v2.46.2/example/datasets/ne_110m_admin_0_countries.geojson';

// Intervalo mínimo entre buscas, mesmo que o servidor anuncie um prazo no passado
export const MIN_REFETCH_MS = 10 * 1000;
export const RETRY_ON_ERROR_MS = 15 * 1000;
export const FORCE_POLL_MS = 3 * 1000;
export const FORCE_POLL_TIMEOUT_MS = 90 * 1000;

export const prefersReducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
