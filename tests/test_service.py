import io
import json
import time
from urllib.error import HTTPError

import pytest

from globetemp import config


def http_error(code, headers=None):
    return HTTPError('https://api.open-meteo.com', code, 'error', headers or {}, io.BytesIO())


def test_starts_with_synthetic_data_without_cache(make_service):
    svc = make_service()
    data = svc.get_data()
    assert data['source'] == 'synthetic'
    assert data['observed_at'] is None
    assert len(data['points']) == 496


def test_refresh_fetches_unique_locations_in_chunks(make_service, fake_api):
    svc = make_service()
    assert svc.refresh_once()
    assert [len(c) for c in fake_api.calls] == [100, 100, 100, 100, 22]
    data = svc.get_data()
    assert data['source'] == 'open-meteo'
    assert data['observed_at'] == '2026-11-02T17:30Z'


def test_failed_round_reuses_downloaded_chunks(make_service, fake_api):
    svc = make_service()
    fake_api.fail_on[3] = http_error(500)
    assert not svc.refresh_once()
    assert svc.source == 'synthetic'

    svc._backoff_until = 0  # simula o fim da espera
    assert svc.refresh_once()
    sizes = [len(c) for c in fake_api.calls]
    # 2 chunks ok + 1 com erro; depois só os 222 que faltavam
    assert sizes == [100, 100, 100, 100, 100, 22]


def test_error_backoff_grows_exponentially_with_ceiling(make_service):
    svc = make_service()
    waits = [svc._error_backoff() for _ in range(8)]
    assert waits == [30, 60, 120, 240, 480, 960, 1800, 1800]


def test_rate_limit_respects_retry_after(make_service, fake_api):
    svc = make_service()
    fake_api.fail_on[1] = http_error(429, {'Retry-After': '900'})
    assert not svc.refresh_once()
    assert svc._backoff_until - time.time() == pytest.approx(900, abs=2)
    assert svc.get_data()['retrying'] is True
    assert not svc.is_due()


def test_cache_roundtrip_keeps_original_timestamp(make_service, tmp_path):
    svc = make_service()
    svc.refresh_once()

    restored = make_service()
    data = restored.get_data()
    assert data['source'] == 'open-meteo'
    assert data['last_update'] == pytest.approx(svc.last_update)
    assert data['stats'] == svc.get_data()['stats']
    assert not restored.is_due()


def test_cache_from_another_grid_is_ignored(make_service, tmp_path):
    cache = tmp_path / 'cache.json'
    cache.write_text(json.dumps({'last_update': time.time(), 'temps': [[0, 0, 10]]}))
    assert make_service(cache_file=cache).source == 'synthetic'


def test_corrupt_cache_is_ignored(make_service, tmp_path):
    cache = tmp_path / 'cache.json'
    cache.write_text('{not json')
    assert make_service(cache_file=cache).source == 'synthetic'


def test_next_update_is_never_in_the_past(make_service):
    svc = make_service()
    svc.refresh_once()
    svc.last_update -= 10 * 3600  # dado muito antigo: o prazo "natural" já passou
    assert svc.get_data()['next_update'] >= time.time() + config.MIN_NEXT_UPDATE - 1


def test_force_refresh_has_cooldown(make_service):
    svc = make_service()
    svc.refresh_once()
    assert not svc.is_due()

    accepted, _ = svc.request_refresh()
    assert accepted
    assert svc.is_due()

    accepted, wait = svc.request_refresh()
    assert not accepted
    assert 0 < wait <= config.FORCE_COOLDOWN


@pytest.mark.parametrize(('value', 'expected'), [(15, 90), (120, 120), (9999, 360)])
def test_interval_is_clamped(make_service, value, expected):
    assert make_service().set_interval(value) == expected
