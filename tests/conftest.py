import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from globetemp.service import TemperatureService  # noqa: E402


class FakeOpenMeteo:
    """Substitui `open_meteo.fetch_chunk`: devolve temperaturas previsíveis e pode falhar."""

    def __init__(self, observed='2026-11-02T17:30'):
        self.calls = []
        self.observed = observed
        self.fail_on = {}  # número da chamada (1-based) -> exceção

    def __call__(self, chunk):
        self.calls.append(list(chunk))
        err = self.fail_on.get(len(self.calls))
        if err is not None:
            raise err
        return [(20.0 + lat / 10, self.observed) for lat, _ in chunk]


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
