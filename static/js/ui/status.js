// Estado → texto do indicador; a cor vem do CSS via data-state
const STATUS_LABELS = {
    loading: 'Loading',
    live: 'Live',
    stale: 'Stale',
    updating: 'Updating',
    retrying: 'Retrying',
    estimated: 'Estimated',
    offline: 'Offline'
};

export function setStatus(state) {
    document.getElementById('status-indicator').dataset.state = state;
    document.getElementById('status-label').textContent = STATUS_LABELS[state];
}

// Função pura (testada no Node): estado a mostrar para uma resposta de /api/data
export function statusFor(data, now = Date.now()) {
    if (data.refreshing) return 'updating';
    if (data.source !== 'open-meteo') return 'estimated';
    if (data.retrying) return 'retrying';
    // Dado real, mas bem mais velho que o intervalo (ex.: cache antigo, API fora do ar)
    const ageMs = now - data.last_update * 1000;
    return ageMs > data.interval * 60 * 1000 * 1.5 ? 'stale' : 'live';
}

export function updateObservedAt(data) {
    const el = document.getElementById('observed-at');
    if (data.source !== 'open-meteo') {
        el.textContent = 'Latitude estimate — waiting for live data';
        el.removeAttribute('title');
        return;
    }
    const when = new Date(data.observed_at || data.last_update * 1000);
    const time = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const sameDay = when.toDateString() === new Date().toDateString();
    el.textContent = `Observed ${sameDay ? time : `${when.toLocaleDateString()} ${time}`}`;
    el.title = when.toISOString();
}

export function updateStats(stats) {
    document.getElementById('min-temp').textContent = `${stats.min}°C`;
    document.getElementById('avg-temp').textContent = `${stats.avg}°C`;
    document.getElementById('max-temp').textContent = `${stats.max}°C`;
}
