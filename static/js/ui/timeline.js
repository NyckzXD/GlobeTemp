import { FOLLOW_NOW_MS, LOCALE, PLAY_HOURS_PER_SECOND } from '../config.js';
import { frameAt } from '../grid.js';

const HOUR = 3600 * 1000;

// Função pura (testada no Node): distância em horas até agora, como "Agora", "+3 h" ou "−2 h"
export function relativeLabel(ms, now = Date.now()) {
    const hours = Math.round((ms - now) / HOUR);
    if (hours === 0) return 'Agora';
    return hours > 0 ? `+${hours} h` : `−${-hours} h`;
}

function timeAt(grid, t) {
    const i = Math.min(grid.times.length - 1, Math.floor(t));
    const next = grid.times[Math.min(grid.times.length - 1, i + 1)];
    return grid.times[i] + (next - grid.times[i]) * (t - i);
}

// Linha do tempo da série horária: slider, tocar/pausar e voltar para agora.
// `onChange(t, ms)` recebe a posição fracionária na série (0 = primeiro horário) e o instante UTC.
export function initTimeline(onChange) {
    const slider = document.getElementById('time-slider');
    const label = document.getElementById('time-label');
    const relative = document.getElementById('time-relative');
    const playBtn = document.getElementById('play-btn');
    const nowBtn = document.getElementById('now-btn');

    let grid = null;
    let t = 0;
    let follow = true;  // acompanha o relógio até a pessoa mexer na linha do tempo
    let playing = false;
    let lastFrame = 0;

    function render() {
        if (!grid) return;
        const ms = timeAt(grid, t);
        const when = new Date(ms);
        label.textContent = when.toLocaleString(LOCALE, {
            weekday: 'short', hour: '2-digit', minute: '2-digit'
        });
        label.title = when.toISOString();
        relative.textContent = relativeLabel(ms);
        slider.value = String(t);
        slider.setAttribute('aria-valuetext', `${label.textContent} (${relative.textContent})`);
        nowBtn.disabled = follow;
        onChange(t, ms);
    }

    function setT(value) {
        t = Math.min(grid.times.length - 1, Math.max(0, value));
        render();
    }

    function setPlaying(value) {
        playing = value && grid && grid.times.length > 1;
        playBtn.setAttribute('aria-pressed', String(playing));
        playBtn.setAttribute('aria-label', playing ? 'Pausar' : 'Reproduzir');
        playBtn.querySelector('i').className = `fa-solid ${playing ? 'fa-pause' : 'fa-play'}`;
        if (playing) {
            follow = false;
            lastFrame = performance.now();
            requestAnimationFrame(step);
        }
    }

    function step(now) {
        if (!playing) return;
        const dt = (now - lastFrame) / 1000;
        lastFrame = now;
        const last = grid.times.length - 1;
        let next = t + dt * PLAY_HOURS_PER_SECOND;
        if (next > last) next = 0;  // volta ao início da série
        setT(next);
        requestAnimationFrame(step);
    }

    function followNow() {
        if (follow && grid) setT(frameAt(grid, Date.now()));
    }

    slider.addEventListener('input', () => {
        follow = false;
        setPlaying(false);
        setT(parseFloat(slider.value));
    });
    playBtn.addEventListener('click', () => setPlaying(!playing));
    nowBtn.addEventListener('click', () => {
        setPlaying(false);
        follow = true;
        followNow();
    });
    setInterval(followNow, FOLLOW_NOW_MS);

    return {
        get t() { return t; },

        setGrid(newGrid) {
            // Mantém o mesmo instante ao trocar de dados (a série nova começa em outra hora)
            const keepMs = grid && !follow ? timeAt(grid, t) : null;
            grid = newGrid;
            slider.max = String(grid.times.length - 1);
            slider.disabled = grid.times.length < 2;
            playBtn.disabled = grid.times.length < 2;
            setT(frameAt(grid, keepMs ?? Date.now()));
        }
    };
}
