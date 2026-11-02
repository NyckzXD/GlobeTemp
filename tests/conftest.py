import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from globetemp.service import TemperatureService  # noqa: E402


class FakeOpenMeteo:
    """Substitui `open_meteo.fetch_chunk`: devolve temperaturas previsíveis e pode falhar."""

    TIMES = ('2026-11-02T17:00', '2026-11-02T18:00', '2026-11-02T19:00')

    def __init__(self, times=TIMES):
        self.calls = []
        self.times = times
        self.fail_on = {}  # número da chamada (1-based) -> exceção

    def __call__(self, chunk):
        self.calls.append(list(chunk))
        err = self.fail_on.get(len(self.calls))
        if err is not None:
            raise err
        return [{t: 20.0 + lat / 10 + k for k, t in enumerate(self.times)} for lat, _ in chunk]


@pytest.fixture
def fake_api():
    return FakeOpenMeteo()


@pytest.fixture
def make_service(fake_api, tmp_path):
    def make(**kwargs):
        kwargs.setdefault('fetch_chunk', fake_api)
        kwargs.setdefault('cache_file', tmp_path / 'cache.json')
        kwargs.setdefault('pause', 0)
        return TemperatureService(start=False, **kwargs)

    return make
