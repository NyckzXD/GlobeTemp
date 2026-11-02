import json
import urllib.parse
import urllib.request

from . import config


def fetch_chunk(chunk):
    """Série horária da temperatura a 2 m de um lote de localizações.

    Devolve, na mesma ordem de `chunk`, um dict {horário UTC ISO: temperatura} por
    localização (vazio se a resposta não trouxe nada; a temperatura pode ser None).
    Erros HTTP sobem como `urllib.error.HTTPError`.
    """
    params = {
        'latitude': ','.join(str(la) for la, _ in chunk),
        'longitude': ','.join(str(ln) for _, ln in chunk),
        'hourly': 'temperature_2m',
        'past_hours': config.PAST_HOURS,
        'forecast_hours': config.FORECAST_HOURS,
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
        hourly = (item or {}).get('hourly') or {}
        out.append(dict(zip(hourly.get('time') or [], hourly.get('temperature_2m') or [], strict=False)))
    return out


def retry_after_seconds(err):
    """Lê o header Retry-After (em segundos) de um HTTPError, se houver."""
    try:
        return int(err.headers.get('Retry-After', ''))
    except (TypeError, ValueError, AttributeError):
        return 0
