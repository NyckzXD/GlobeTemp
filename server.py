import http.server
import socketserver
import json
import math
import time
import ssl
import threading
import urllib.request
import urllib.parse
from urllib.parse import urlparse
from urllib.error import HTTPError

PORT = 5005

# ─── Configuração ──────────────────────────────────────────────────────────────
# O plano gratuito do Open-Meteo limita por NÚMERO DE LOCALIZAÇÕES (~600/min, ~10k/dia),
# não por número de requisições. Uma grade global densa estoura na hora, então usamos uma
# grade grossa (o cliente interpola) e atualizamos com pouca frequência.
GRID_STEP = 12                # graus entre amostras -> 16 x 31 = 496 pontos
CHUNK = 100                   # localizações por requisição ao Open-Meteo
MIN_INTERVAL_MIN = 60         # o clima real muda devagar; protege a cota
DEFAULT_INTERVAL_MIN = 60
RATE_LIMIT_BACKOFF = 300      # segundos de espera após um 429
OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'

# Alguns sistemas (notadamente o Python padrão do macOS/Windows) falham na verificação TLS
# do urllib. Mantemos a verificação ligada e só caímos para um contexto sem verificação
# nesta API pública e somente-leitura de clima se a primeira tentativa der erro de SSL.
_INSECURE_CTX = ssl.create_default_context()
_INSECURE_CTX.check_hostname = False
_INSECURE_CTX.verify_mode = ssl.CERT_NONE


class ThermalSimulation:
    def __init__(self):
        self.interval = DEFAULT_INTERVAL_MIN
        self.lats = list(range(-90, 91, GRID_STEP))
        self.lngs = list(range(-180, 181, GRID_STEP))
        self.coords = [(la, ln) for la in self.lats for ln in self.lngs]

        self._lock = threading.Lock()
        self._refresh_now = threading.Event()
        self._backoff_until = 0.0

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
        temps = {}
        for (lat, lng) in self.coords:
            c = math.cos(math.radians(lat))
            temps[(lat, lng)] = 35 * c - 30 * (1 - c)
        return temps

    def _fetch_chunk(self, chunk):
        params = {
            'latitude': ','.join(str(la) for la, _ in chunk),
            'longitude': ','.join(str(ln) for _, ln in chunk),
            'current': 'temperature_2m',
            'timezone': 'UTC',
        }
        url = OPEN_METEO_URL + '?' + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={'User-Agent': 'thermal-earth/1.0'})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = json.loads(resp.read().decode('utf-8'))
        except ssl.SSLError:
            with urllib.request.urlopen(req, timeout=15, context=_INSECURE_CTX) as resp:
                body = json.loads(resp.read().decode('utf-8'))

        # Uma localização -> objeto; várias localizações -> lista (ordem preservada)
        if isinstance(body, dict):
            body = [body]
        return [((item or {}).get('current') or {}).get('temperature_2m') for item in body]

    def _fetch_real_temps(self):
        temps = {}
        try:
            for i in range(0, len(self.coords), CHUNK):
                chunk = self.coords[i:i + CHUNK]
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
        for (lat, lng) in self.coords:
            if temps.get((lat, lng)) is None:
                c = math.cos(math.radians(lat))
                temps[(lat, lng)] = 35 * c - 30 * (1 - c)
        return temps

    # ─── Estado ─────────────────────────────────────────────────────────────────
    def _apply(self, temps, source):
        points = []
        mn, mx, s = float('inf'), float('-inf'), 0.0
        for (lat, lng) in self.coords:
            t = round(float(temps[(lat, lng)]), 2)
            points.append({'lat': lat, 'lng': lng, 'temp': t})
            if t < mn:
                mn = t
            if t > mx:
                mx = t
            s += t
        stats = {'min': round(mn, 1), 'max': round(mx, 1), 'avg': round(s / len(points), 1)}
        with self._lock:
            self._points = points
            self._stats = stats
            self.source = source
            self.last_update = time.time()

    def _refresh_loop(self):
        while True:
            now = time.time()
            cadence = max(MIN_INTERVAL_MIN, self.interval) * 60
            backing_off = now < self._backoff_until
            if self.source != 'open-meteo':
                due = not backing_off          # segue tentando até termos dado real
            else:
                due = (now - self.last_update) >= cadence

            if due:
                real = self._fetch_real_temps()
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
        self._refresh_now.set()

    def set_interval(self, minutes):
        self.interval = max(MIN_INTERVAL_MIN, int(minutes))

    def get_data(self):
        now = time.time()
        with self._lock:
            if self.source == 'open-meteo':
                next_update = self.last_update + max(MIN_INTERVAL_MIN, self.interval) * 60
            else:
                next_update = now + 15  # ainda buscando dado real; verifica de novo em breve
            return {
                'points': self._points,
                'stats': self._stats,
                'interval': self.interval,
                'last_update': self.last_update,
                'next_update': next_update,
                'source': self.source,
            }


sim = ThermalSimulation()


class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory="static", **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        parsed_path = urlparse(self.path)
        if parsed_path.path == '/api/data':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(sim.get_data()).encode('utf-8'))
        else:
            if self.path == '/':
                self.path = '/index.html'
            super().do_GET()

    def do_POST(self):
        parsed_path = urlparse(self.path)
        if parsed_path.path == '/api/settings':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                payload = json.loads(post_data.decode('utf-8'))
                if payload.get('action') == 'force_update':
                    sim.request_refresh()
                if 'interval' in payload:
                    sim.set_interval(payload['interval'])
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok"}).encode('utf-8'))
            except Exception:
                self.send_response(400)
                self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        print(f"Serving at http://localhost:{PORT}")
        httpd.serve_forever()