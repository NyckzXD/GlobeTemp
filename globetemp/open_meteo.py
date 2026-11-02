import json
import urllib.parse
import urllib.request

from . import config


def fetch_chunk(chunk):
    """Temperatura atual a 2 m de um lote de localizações.

    Devolve uma lista de (temperatura, horário observado em UTC) na mesma ordem de `chunk`;
    qualquer um dos dois pode ser None. Erros HTTP sobem como `urllib.error.HTTPError`.
    """
    params = {
        'latitude': ','.join(str(la) for la, _ in chunk),
        'longitude': ','.join(str(ln) for _, ln in chunk),
        'current': 'temperature_2m',
        'timezone': 'UTC',
    }
    url = config.OPEN_METEO_URL + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': 'thermal-earth/1.0'})
    with urllib.request.urlopen(req, timeout=config.REQUEST_TIMEOUT) as resp:
        body = json.loads(resp.read().decode('utf-8'))

    # Uma localização -> objeto; várias localizações -> lista (ordem preservada)
    if isinstance(body, dict):
        body = [body]
    out = []
    for item in body:
        current = (item or {}).get('current') or {}
        out.append((current.get('temperature_2m'), current.get('time')))
    return out


def retry_after_seconds(err):
    """Lê o header Retry-After (em segundos) de um HTTPError, se houver."""
    try:
        return int(err.headers.get('Retry-After', ''))
    except (TypeError, ValueError, AttributeError):
        return 0
