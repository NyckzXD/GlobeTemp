import { LOCALE } from '../config.js';

// Estado → texto do indicador; a cor vem do CSS via data-state
const STATUS_LABELS = {
    loading: 'Carregando',
    live: 'Ao vivo',
    stale: 'Desatualizado',
    updating: 'Atualizando',
    retrying: 'Tentando de novo',
    estimated: 'Estimado',
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
        el.textContent = 'Estimativa por latitude — aguardando dados reais';
        el.removeAttribute('title');
        return;
    }
    // Quando a série horária (modelo) foi baixada; o horário exibido fica na linha do tempo
    const when = new Date(data.last_update * 1000);
    const time = when.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
    const sameDay = when.toDateString() === new Date().toDateString();
    el.textContent = sameDay ? `Baixado às ${time}` : `Baixado em ${when.toLocaleDateString(LOCALE)} às ${time}`;
    el.title = when.toISOString();
}

export function updateStats(stats) {
    document.getElementById('min-temp').textContent = `${stats.min}°C`;
    document.getElementById('avg-temp').textContent = `${stats.avg}°C`;
    document.getElementById('max-temp').textContent = `${stats.max}°C`;
}
