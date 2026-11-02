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
    assert len(data['grid']['times']) == 1
    assert len(data['grid']['values'][0]) == 1891
    assert len(data['stats']) == 1


def test_refresh_fetches_unique_locations_in_chunks(make_service, fake_api):
    svc = make_service()
    assert svc.refresh_once()
    assert [len(c) for c in fake_api.calls] == [100] * 17 + [42]
    data = svc.get_data()
    assert data['source'] == 'open-meteo'
    assert data['grid']['times'] == list(fake_api.TIMES)
    assert len(data['grid']['values']) == 3
    assert [s['max'] for s in data['stats']] == [29.0, 30.0, 31.0]


def test_failed_round_reuses_downloaded_chunks(make_service, fake_api):
    svc = make_service()
    fake_api.fail_on[3] = http_error(500)
    assert not svc.refresh_once()
    assert svc.source == 'synthetic'

    svc._backoff_until = 0  # simula o fim da espera
    assert svc.refresh_once()
    sizes = [len(c) for c in fake_api.calls]
    # 2 chunks ok + 1 com erro; depois só os 1.542 que faltavam
    assert sizes == [100, 100, 100] + [100] * 15 + [42]


def test_only_times_shared_by_all_locations_are_kept(make_service, fake_api):
    svc = make_service()
    # O segundo lote chegou depois da virada da hora: a janela andou uma hora
    original = fake_api.__call__

    def shifted(chunk):
        vals = original(chunk)
        if len(fake_api.calls) == 2:
            vals = [
                {'2026-11-02T20:00': 0.0, **{t: v for t, v in s.items() if t != fake_api.TIMES[0]}}
                for s in vals
            ]
        return vals

    svc.fetch_chunk = shifted
    assert svc.refresh_once()
    assert svc.get_data()['grid']['times'] == list(fake_api.TIMES[1:])


def test_missing_values_are_filled_with_latitude_estimate(make_service, fake_api):
    svc = make_service()
    original = fake_api.__call__
    svc.fetch_chunk = lambda chunk: [{**s, fake_api.TIMES[0]: None} for s in original(chunk)]
    assert svc.refresh_once()
    first = svc.get_data()['grid']['values'][0]
    # índice da linha do equador (lat 0) na grade completa
    equator = svc.grid.lats.index(0) * len(svc.grid.lngs)
    assert first[equator] == pytest.approx(35)


def test_daily_budget_blocks_extra_rounds(make_service, monkeypatch):
    monkeypatch.setattr(config, 'DAILY_LOCATION_BUDGET', 4000)
    svc = make_service()
    assert svc.refresh_once()
    assert svc.budget_wait() == 0  # 1.742 + 1.742 cabem em 4.000
    assert svc.refresh_once()
    wait = svc.budget_wait()
    assert 0 < wait <= 86400
    accepted, retry = svc.request_refresh()
    assert not accepted
    assert retry >= wait
    assert not svc.is_due()


def test_daily_budget_survives_restart(make_service, monkeypatch):
    monkeypatch.setattr(config, 'DAILY_LOCATION_BUDGET', 4000)
    svc = make_service()
    svc.refresh_once()
    svc.refresh_once()
    assert svc.budget_wait() > 0

    restarted = make_service()
    assert sum(n for _, n in restarted._usage) == 2 * 1742
    assert restarted.budget_wait() == pytest.approx(svc.budget_wait(), abs=2)
    assert not restarted.request_refresh()[0]


def test_failed_round_still_counts_against_budget(make_service, fake_api):
    fake_api.fail_on[3] = http_error(500)
    make_service().refresh_once()
    # os 3 lotes consultados (inclusive o que falhou) gastaram cota
    assert sum(n for _, n in make_service()._usage) == 300


def test_usage_record_drops_old_and_clamps_future_entries(make_service, tmp_path):
    now = time.time()
    record = [[now - 90000, 500], [now - 60, 100], [now + 999999, 50]]
    (tmp_path / 'cache-usage.json').write_text(json.dumps(record))
    svc = make_service()
    assert [n for _, n in svc._usage] == [100, 50]
    assert all(t <= time.time() for t, _ in svc._usage)


def test_corrupt_usage_record_is_ignored(make_service, tmp_path):
    (tmp_path / 'cache-usage.json').write_text('{not json')
    assert make_service()._usage == []


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


@pytest.mark.parametrize(('value', 'expected'), [(15, 360), (480, 480), (9999, 720)])
def test_interval_is_clamped(make_service, value, expected):
    assert make_service().set_interval(value) == expected
