// Recursos externos com versão fixa (ver index.html para o globe.gl)
// Natural Earth 1:50m em TopoJSON: linhas de costa e fronteiras
export const COASTLINES_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json';

// Intervalo mínimo entre buscas, mesmo que o servidor anuncie um prazo no passado
export const MIN_REFETCH_MS = 10 * 1000;
export const RETRY_ON_ERROR_MS = 15 * 1000;
export const FORCE_POLL_MS = 3 * 1000;
// Uma rodada completa leva uns 3,5 min (ritmo da cota por minuto do Open-Meteo)
export const FORCE_POLL_TIMEOUT_MS = 6 * 60 * 1000;

// Linha do tempo: horas da série por segundo ao tocar, e a cada quanto o modo "agora" anda
export const PLAY_HOURS_PER_SECOND = 2.5;
export const FOLLOW_NOW_MS = 60 * 1000;

export const prefersReducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
