import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / 'static'

HOST = os.environ.get('GLOBETEMP_HOST', '127.0.0.1')  # use 0.0.0.0 para expor na rede
PORT = int(os.environ.get('GLOBETEMP_PORT', '5005'))
LOG_LEVEL = os.environ.get('GLOBETEMP_LOG_LEVEL', 'INFO').upper()
# Último resultado real salvo em disco: reiniciar o servidor não gasta cota de novo
CACHE_FILE = Path(os.environ.get('GLOBETEMP_CACHE', BASE_DIR / 'cache.json'))

# ─── Open-Meteo e cota ─────────────────────────────────────────────────────────
# O plano gratuito do Open-Meteo limita por NÚMERO DE LOCALIZAÇÕES (~600/min, ~10k/dia),
# não por número de requisições. Uma grade global densa estoura na hora, então usamos uma
# grade grossa (o cliente interpola) e atualizamos com pouca frequência.
OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'
GRID_STEP = 6  # graus entre amostras -> grade 31 x 61, 1.742 localizações únicas
CHUNK = 100  # localizações por requisição ao Open-Meteo
# O limite por minuto (600) também conta localizações: 100 a cada 12 s ≈ 500/min.
# Uma rodada completa (18 lotes) leva uns 3,5 min.
CHUNK_PAUSE = 12  # segundos entre requisições
REQUEST_TIMEOUT = 20

# Cada localização traz uma série horária: algumas horas para trás (o dado não "envelhece"
# entre as rodadas) e um dia para frente (linha do tempo no cliente).
PAST_HOURS = 6
FORECAST_HOURS = 25

# ─── Agendamento ───────────────────────────────────────────────────────────────
# 1.742 localizações x 4 atualizações/dia (a cada 6 h) ≈ 7.000/dia, com folga na cota.
# A série horária cobre o intervalo inteiro, então o globo continua "ao vivo" entre rodadas.
MIN_INTERVAL_MIN = 360
MAX_INTERVAL_MIN = 720
DEFAULT_INTERVAL_MIN = 360
FORCE_COOLDOWN = 600  # segundos mínimos entre atualizações forçadas
# Teto de localizações consultadas em 24 h (cota grátis: 10.000/dia). Atualizações forçadas
# e agendadas esperam se a próxima rodada passaria dele.
DAILY_LOCATION_BUDGET = 9000
RATE_LIMIT_BACKOFF = 300  # espera mínima após um 429 (ou o Retry-After, se maior)
ERROR_BACKOFF_BASE = 30  # outras falhas: 30 s, 1 min, 2 min, ... até o teto
ERROR_BACKOFF_MAX = 1800
PARTIAL_MAX_AGE = 1800  # chunks já baixados valem para completar a rodada por 30 min
MIN_NEXT_UPDATE = 15  # nunca anunciar ao cliente uma próxima atualização no passado

# ─── HTTP ──────────────────────────────────────────────────────────────────────
MAX_POST_BYTES = 1024
