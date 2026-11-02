// Painel recolhível; começa recolhido em telas estreitas e lembra a escolha
const PANEL_KEY = 'globetemp.panelCollapsed';

export function initPanel() {
    const panel = document.getElementById('dashboard-panel');
    const toggle = document.getElementById('panel-toggle');

    function setCollapsed(collapsed) {
        panel.classList.toggle('collapsed', collapsed);
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.setAttribute('aria-label', collapsed ? 'Expandir painel' : 'Recolher painel');
    }

    let saved = null;
    try { saved = localStorage.getItem(PANEL_KEY); } catch { /* storage bloqueado */ }
    setCollapsed(saved !== null ? saved === 'true' : window.matchMedia('(max-width: 640px)').matches);

    toggle.addEventListener('click', () => {
        const collapsed = !panel.classList.contains('collapsed');
        setCollapsed(collapsed);
        try { localStorage.setItem(PANEL_KEY, String(collapsed)); } catch { /* storage bloqueado */ }
    });
}
