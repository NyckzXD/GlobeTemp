import json
import logging
import math
import threading
import time
from pathlib import Path
from urllib.error import HTTPError

from . import config, open_meteo
from .grid import Grid, latitude_estimate

log = logging.getLogger('globetemp')


class TemperatureService:
    """Mantém a última grade de temperatura e decide quando buscar dados novos.

    Uma thread em segundo plano busca no Open-Meteo quando o intervalo vence, quando uma
    atualização é forçada ou enquanto ainda não houver dado real. O resultado fica em
    memória (para a API) e em disco (para sobreviver a reinícios sem gastar cota).
    """

    def __init__(self, grid=None, fetch_chunk=open_meteo.fetch_chunk,
                 cache_file=config.CACHE_FILE, pause=config.CHUNK_PAUSE, start=True):
        self.grid = grid or Grid()
        self.fetch_chunk = fetch_chunk
        self.cache_file = Path(cache_file) if cache_file else None
        self.pause = pause
        self.interval = config.DEFAULT_INTERVAL_MIN

        self._lock = threading.Lock()
        self._refresh_now = threading.Event()
        self._backoff_until = 0.0
        self._failures = 0
        self._force = False
        self._last_forced = 0.0
        self._partial = {}            # localização -> (temp, horário observado)
        self._partial_started = 0.0
        self.refreshing = False

        self._points = []
        self._stats = {'min': 0, 'max': 0, 'avg': 0}
        self.source = 'synthetic'
        self.last_update = time.time()
        self.observed_at = None

        # Usa o cache em disco se houver; senão, preenchimento sintético imediato para a
        # UI já ter dados no primeiro carregamento.
        if not self._load_cache():
            self._apply(self.grid.synthetic(), 'synthetic')

        # Os dados reais são buscados em segundo plano para o servidor subir na hora.
        if start:
            threading.Thread(target=self._refresh_loop, daemon=True).start()

    # ─── Cache em disco ────────────────────────────────────────────────────────
    def _load_cache(self):
        if not self.cache_file or not self.cache_file.exists():
            return False
        try:
            saved = json.loads(self.cache_file.read_text(encoding='utf-8'))
            temps = {(la, ln): t for la, ln, t in saved['temps']}
            if set(temps) != set(self.grid.unique_coords):
                log.info("Cache ignorado: a grade mudou desde que foi salvo.")
                return False
            self._apply(temps, 'open-meteo', updated_at=float(saved['last_update']),
                        observed_at=saved.get('observed_at'))
        except (OSError, ValueError, KeyError, TypeError) as e:
            log.warning("Cache inválido em %s: %s", self.cache_file, e)
            return False
        age_min = (time.time() - self.last_update) / 60
        log.info("Dados carregados do cache (%.0f min atrás).", age_min)
        return True

    def _save_cache(self, temps):
        if not self.cache_file:
            return
        data = {
            'last_update': self.last_update,
            'observed_at': self.observed_at,
            'temps': [[la, ln, temps[(la, ln)]] for la, ln in self.grid.unique_coords],
        }
        tmp = self.cache_file.with_suffix('.tmp')
        try:
            tmp.write_text(json.dumps(data), encoding='utf-8')
            tmp.replace(self.cache_file)  # troca atômica: nunca deixa um cache pela metade
        except OSError as e:
            log.warning("Não foi possível salvar o cache: %s", e)

    # ─── Busca ─────────────────────────────────────────────────────────────────
    def _fetch_real_temps(self):
        """Busca as localizações que faltam na rodada atual. Devolve (temps, observado) ou None.

        Chunks já baixados ficam em `self._partial`: se a rodada falhar no meio, a próxima
        tentativa só busca o que falta, sem gastar a cota de novo.
        """
        if time.time() - self._partial_started > config.PARTIAL_MAX_AGE:
            self._partial = {}
        if not self._partial:
            self._partial_started = time.time()

        missing = [c for c in self.grid.unique_coords if c not in self._partial]
        try:
            for i in range(0, len(missing), config.CHUNK):
                chunk = missing[i:i + config.CHUNK]
                vals = self.fetch_chunk(chunk)
                if len(vals) != len(chunk):
                    vals = (list(vals) + [(None, None)] * len(chunk))[:len(chunk)]
                for coord, v in zip(chunk, vals):
                    self._partial[coord] = v
                if self.pause:
                    time.sleep(self.pause)
        except HTTPError as e:
            if e.code == 429:
                wait = max(config.RATE_LIMIT_BACKOFF, open_meteo.retry_after_seconds(e))
                log.warning("Open-Meteo rate limited (429). Backing off %ss.", wait)
            else:
                wait = self._error_backoff()
                log.warning("Open-Meteo HTTP error: %s. Nova tentativa em %ss.", e, wait)
            self._backoff_until = time.time() + wait
            return None
        except Exception as e:
            wait = self._error_backoff()
            self._backoff_until = time.time() + wait
            log.warning("Open-Meteo fetch failed: %s. Nova tentativa em %ss.", e, wait)
            return None

        fetched, self._partial = self._partial, {}
        temps = {}
        observed = [t for _, t in fetched.values() if t]
        for coord in self.grid.unique_coords:
            temp = fetched[coord][0]
            # Preenche amostras faltantes (falhas raras) com uma estimativa por latitude
            temps[coord] = temp if temp is not None else latitude_estimate(coord[0])
        observed_at = (max(observed) + 'Z') if observed else None
        return temps, observed_at

    def _error_backoff(self):
        self._failures += 1
        return min(config.ERROR_BACKOFF_MAX, config.ERROR_BACKOFF_BASE * 2 ** (self._failures - 1))

    # ─── Estado ────────────────────────────────────────────────────────────────
    def _apply(self, temps, source, updated_at=None, observed_at=None):
        points = self.grid.points(temps)
        stats = self.grid.stats(temps)
        with self._lock:
            self._points = points
            self._stats = stats
            self.source = source
            self.last_update = updated_at if updated_at is not None else time.time()
            self.observed_at = observed_at

    def refresh_once(self):
        """Executa uma busca agora. Devolve True se aplicou dados novos."""
        self._force = False
        self.refreshing = True
        try:
            result = self._fetch_real_temps()
        finally:
            self.refreshing = False
        if result is None:
            return False
        temps, observed_at = result
        self._failures = 0
        self._backoff_until = 0.0
        self._apply(temps, 'open-meteo', observed_at=observed_at)
        self._save_cache(temps)
        log.info("Real temperatures updated — min %s  avg %s  max %s",
                 self._stats['min'], self._stats['avg'], self._stats['max'])
        return True

    def is_due(self, now=None):
        now = time.time() if now is None else now
        if now < self._backoff_until:
            return False
        if self._force or self.source != 'open-meteo':
            return True                        # forçado, ou ainda sem dado real
        return (now - self.last_update) >= self.interval * 60

    def _refresh_loop(self):
        while True:
            if self.is_due():
                self.refresh_once()

            # Verifica logo enquanto faltar dado real; relaxa quando já tiver.
            timeout = 20 if self.source != 'open-meteo' else 30
            if self._backoff_until > time.time():
                timeout = max(1, min(timeout, self._backoff_until - time.time()))
            self._refresh_now.wait(timeout=timeout)
            self._refresh_now.clear()

    # ─── API pública ───────────────────────────────────────────────────────────
    def request_refresh(self):
        """Pede uma atualização imediata. Devolve (aceito, segundos_para_poder_de_novo)."""
        now = time.time()
        wait = max(self._last_forced + config.FORCE_COOLDOWN, self._backoff_until) - now
        if wait > 0:
            return False, math.ceil(wait)
        self._last_forced = now
        self._force = True
        self._refresh_now.set()
        return True, config.FORCE_COOLDOWN

    def set_interval(self, minutes):
        self.interval = max(config.MIN_INTERVAL_MIN, min(config.MAX_INTERVAL_MIN, int(minutes)))
        self._refresh_now.set()  # reavalia o prazo com o novo intervalo
        return self.interval

    def get_data(self):
        now = time.time()
        with self._lock:
            if self.source == 'open-meteo':
                next_update = self.last_update + self.interval * 60
            else:
                next_update = now  # ainda buscando dado real; verifica de novo em breve
            next_update = max(next_update, self._backoff_until, now + config.MIN_NEXT_UPDATE)
            return {
                'points': self._points,
                'stats': self._stats,
                'interval': self.interval,
                'interval_min': config.MIN_INTERVAL_MIN,
                'interval_max': config.MAX_INTERVAL_MIN,
                'last_update': self.last_update,
                'observed_at': self.observed_at,
                'next_update': next_update,
                'refreshing': self.refreshing,
                'retrying': now < self._backoff_until,
                'source': self.source,
            }
