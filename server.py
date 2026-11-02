import http.server
import json
import math
import os
import threading
import time
import urllib.request
import urllib.parse
from pathlib import Path
from urllib.parse import urlparse
from urllib.error import HTTPError

HOST = os.environ.get('GLOBETEMP_HOST', '127.0.0.1')   # use 0.0.0.0 para expor na rede
PORT = int(os.environ.get('GLOBETEMP_PORT', '5005'))
STATIC_DIR = Path(__file__).resolve().parent / 'static'

# ─── Configuração ──────────────────────────────────────────────────────────────
# O plano gratuito do Open-Meteo limita por NÚMERO DE LOCALIZAÇÕES (~600/min, ~10k/dia),
# não por número de requisições. Uma grade global densa estoura na hora, então usamos uma
# grade grossa (o cliente interpola) e atualizamos com pouca frequência.
GRID_STEP = 12                # graus entre amostras -> grade 16 x 31, 422 localizações únicas
CHUNK = 100                   # localizações por requisição ao Open-Meteo
# 422 localizações x 16 atualizações/dia (a cada 90 min) ≈ 6.750/dia, com folga na cota
MIN_INTERVAL_MIN = 90
MAX_INTERVAL_MIN = 360
DEFAULT_INTERVAL_MIN = 90
FORCE_COOLDOWN = 600          # segundos mínimos entre atualizações forçadas
RATE_LIMIT_BACKOFF = 300      # segundos de espera após um 429
MIN_NEXT_UPDATE = 15          # nunca anunciar ao cliente uma próxima atualização no passado
MAX_POST_BYTES = 1024
OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'


def latitude_estimate(lat):
    """Estimativa grosseira por latitude: ~35 °C no equador, ~-30 °C nos polos."""
    c = math.cos(math.radians(lat))
    return 35 * c - 30 * (1 - c)


def canonical(lat, lng):
    """Mapeia pontos fisicamente idênticos para uma só localização (polos e ±180°)."""
    if abs(lat) == 90:
        return (lat, -180)
    if lng == 180:
        return (lat, -180)
    return (lat, lng)


class ThermalSimulation:
    def __init__(self):
        self.interval = DEFAULT_INTERVAL_MIN
        self.lats = list(range(-90, 91, GRID_STEP))
        self.lngs = list(range(-180, 181, GRID_STEP))
        self.coords = [(la, ln) for la in self.lats for ln in self.lngs]
        # Só estas são consultadas; o resto da grade é cópia (evita gastar cota à toa)
        self.unique_coords = sorted({canonical(la, ln) for la, ln in self.coords})

        self._lock = threading.Lock()
        self._refresh_now = threading.Event()
        self._backoff_until = 0.0
        self._force = False
        self._last_forced = 0.0
        self.refreshing = False

        self._points = []
        self._stats = {'min': 0, 'max': 0, 'avg': 0}
        self.source = 'synthetic'
        self.last_update = time.time()

        # Preenchimento sintético imediato para a UI já ter dados no primeiro carregamento
        self._apply(self._synthetic_temps(), 'synthetic')

        # Os dados reais são buscados em segundo plano para o servidor subir na hora.
        threading.Thread(target=self._refresh_loop, daemon=True).start()

    # ─── Fontes de temperatura ─────────────────────────────────────────────────
    def _synthetic_temps(self):
        return {coord: latitude_estimate(coord[0]) for coord in self.unique_coords}

    def _fetch_chunk(self, chunk):
        params = {
            'latitude': ','.join(str(la) for la, _ in chunk),
            'longitude': ','.join(str(ln) for _, ln in chunk),
            'current': 'temperature_2m',
            'timezone': 'UTC',
        }
        url = OPEN_METEO_URL + '?' + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={'User-Agent': 'thermal-earth/1.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode('utf-8'))

        # Uma localização -> objeto; várias localizações -> lista (ordem preservada)
        if isinstance(body, dict):
            body = [body]
        return [((item or {}).get('current') or {}).get('temperature_2m') for item in body]

    def _fetch_real_temps(self):
        temps = {}
        coords = self.unique_coords
        try:
            for i in range(0, len(coords), CHUNK):
                chunk = coords[i:i + CHUNK]
                vals = self._fetch_chunk(chunk)
                if len(vals) != len(chunk):
                    vals = (vals + [None] * len(chunk))[:len(chunk)]
                for coord, v in zip(chunk, vals):
                    temps[coord] = v
                time.sleep(0.3)  # educado entre as requisições
        except HTTPError as e:
            if e.code == 429:
                self._backoff_until = time.time() + RATE_LIMIT_BACKOFF
                print(f"Open-Meteo rate limited (429). Backing off {RATE_LIMIT_BACKOFF}s.")
            else:
                print("Open-Meteo HTTP error:", e)
            return None
        except Exception as e:
            print("Open-Meteo fetch failed:", e)
            return None

        # Preenche amostras faltantes (falhas raras) com uma estimativa por latitude
        for coord in coords:
            if temps.get(coord) is None:
                temps[coord] = latitude_estimate(coord[0])
        return temps

    # ─── Estado ─────────────────────────────────────────────────────────────────
    def _apply(self, temps, source):
        # `temps` vem indexado por localização única; expande para a grade completa
        points = [{'lat': lat, 'lng': lng, 'temp': round(float(temps[canonical(lat, lng)]), 2)}
                  for (lat, lng) in self.coords]

        # Média ponderada por área (cos da latitude): cada ponto da grade equiretangular
        # cobre menos superfície quanto mais perto do polo.
        values = [float(temps[c]) for c in self.unique_coords]
        weights = [math.cos(math.radians(lat)) for lat, _ in self.unique_coords]
        avg = sum(v * w for v, w in zip(values, weights)) / sum(weights)
        stats = {'min': round(min(values), 1), 'max': round(max(values), 1), 'avg': round(avg, 1)}
        with self._lock:
            self._points = points
            self._stats = stats
            self.source = source
            self.last_update = time.time()

    def _refresh_loop(self):
        while True:
            now = time.time()
            cadence = self.interval * 60
            backing_off = now < self._backoff_until
            if backing_off:
                due = False
            elif self._force or self.source != 'open-meteo':
                due = True                     # forçado, ou ainda sem dado real
            else:
                due = (now - self.last_update) >= cadence

            if due:
                self._force = False
                self.refreshing = True
                try:
                    real = self._fetch_real_temps()
                finally:
                    self.refreshing = False
                if real is not None:
                    self._backoff_until = 0.0
                    self._apply(real, 'open-meteo')
                    print(f"Real temperatures updated — min {self._stats['min']}  "
                          f"avg {self._stats['avg']}  max {self._stats['max']}")

            # Verifica logo enquanto faltar dado real; relaxa quando já tiver.
            timeout = 20 if self.source != 'open-meteo' else 30
            self._refresh_now.wait(timeout=timeout)
            self._refresh_now.clear()

    def request_refresh(self):
        """Pede uma atualização imediata. Devolve (aceito, segundos_para_poder_de_novo)."""
        now = time.time()
        wait = max(self._last_forced + FORCE_COOLDOWN, self._backoff_until) - now
        if wait > 0:
            return False, math.ceil(wait)
        self._last_forced = now
        self._force = True
        self._refresh_now.set()
        return True, FORCE_COOLDOWN

    def set_interval(self, minutes):
        self.interval = max(MIN_INTERVAL_MIN, min(MAX_INTERVAL_MIN, int(minutes)))
        self._refresh_now.set()  # reavalia o prazo com o novo intervalo
        return self.interval

    def get_data(self):
        now = time.time()
        with self._lock:
            if self.source == 'open-meteo':
                next_update = self.last_update + self.interval * 60
            else:
                next_update = now  # ainda buscando dado real; verifica de novo em breve
            next_update = max(next_update, self._backoff_until, now + MIN_NEXT_UPDATE)
            return {
                'points': self._points,
                'stats': self._stats,
                'interval': self.interval,
                'interval_min': MIN_INTERVAL_MIN,
                'interval_max': MAX_INTERVAL_MIN,
                'last_update': self.last_update,
                'next_update': next_update,
                'refreshing': self.refreshing,
                'source': self.source,
            }


sim = ThermalSimulation()


class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def _send_json(self, status, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed_path = urlparse(self.path)
        if parsed_path.path == '/api/data':
            self._send_json(200, sim.get_data())
        else:
            super().do_GET()

    def do_POST(self):
        parsed_path = urlparse(self.path)
        if parsed_path.path != '/api/settings':
            self._send_json(404, {'error': 'not found'})
            return

        # Exigir JSON também impede que outras páginas abertas no navegador façam um
        # POST "simples" (form) para cá sem preflight de CORS.
        ctype = (self.headers.get('Content-Type') or '').split(';')[0].strip().lower()
        if ctype != 'application/json':
            self._send_json(415, {'error': 'Content-Type must be application/json'})
            return
        try:
            length = int(self.headers.get('Content-Length', ''))
        except ValueError:
            self._send_json(411, {'error': 'Content-Length required'})
            return
        if length < 0 or length > MAX_POST_BYTES:
            self._send_json(413, {'error': 'payload too large'})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {'error': 'invalid JSON'})
            return
        if not isinstance(payload, dict):
            self._send_json(400, {'error': 'expected a JSON object'})
            return

        result = {'status': 'ok'}
        if 'interval' in payload:
            value = payload['interval']
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                self._send_json(400, {'error': 'interval must be a number of minutes'})
                return
            result['interval'] = sim.set_interval(value)
        if payload.get('action') == 'force_update':
            accepted, seconds = sim.request_refresh()
            result['refresh'] = 'queued' if accepted else 'cooldown'
            result['retry_after'] = seconds
        self._send_json(200, result)


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer((HOST, PORT), CustomHandler) as httpd:
        print(f"Serving at http://{'localhost' if HOST in ('127.0.0.1', '') else HOST}:{PORT}")
        httpd.serve_forever()
