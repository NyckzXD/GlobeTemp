import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / 'static'

HOST = os.environ.get('GLOBETEMP_HOST', '127.0.0.1')   # use 0.0.0.0 para expor na rede
PORT = int(os.environ.get('GLOBETEMP_PORT', '5005'))
LOG_LEVEL = os.environ.get('GLOBETEMP_LOG_LEVEL', 'INFO').upper()
# Último resultado real salvo em disco: reiniciar o servidor não gasta cota de novo
CACHE_FILE = Path(os.environ.get('GLOBETEMP_CACHE', BASE_DIR / 'cache.json'))

# ─── Open-Meteo e cota ─────────────────────────────────────────────────────────
# O plano gratuito do Open-Meteo limita por NÚMERO DE LOCALIZAÇÕES (~600/min, ~10k/dia),
# não por número de requisições. Uma grade global densa estoura na hora, então usamos uma
# grade grossa (o cliente interpola) e atualizamos com pouca frequência.
OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'
GRID_STEP = 12                # graus entre amostras -> grade 16 x 31, 422 localizações únicas
CHUNK = 100                   # localizações por requisição ao Open-Meteo
CHUNK_PAUSE = 0.3             # segundos entre requisições (educado com a API)
REQUEST_TIMEOUT = 15

# ─── Agendamento ───────────────────────────────────────────────────────────────
# 422 localizações x 16 atualizações/dia (a cada 90 min) ≈ 6.750/dia, com folga na cota
MIN_INTERVAL_MIN = 90
MAX_INTERVAL_MIN = 360
DEFAULT_INTERVAL_MIN = 90
FORCE_COOLDOWN = 600          # segundos mínimos entre atualizações forçadas
RATE_LIMIT_BACKOFF = 300      # espera mínima após um 429 (ou o Retry-After, se maior)
ERROR_BACKOFF_BASE = 30       # outras falhas: 30 s, 1 min, 2 min, ... até o teto
ERROR_BACKOFF_MAX = 1800
PARTIAL_MAX_AGE = 1800        # chunks já baixados valem para completar a rodada por 30 min
MIN_NEXT_UPDATE = 15          # nunca anunciar ao cliente uma próxima atualização no passado

# ─── HTTP ──────────────────────────────────────────────────────────────────────
MAX_POST_BYTES = 1024
