import pytest

from globetemp.grid import Grid, canonical, latitude_estimate


def test_grid_dimensions_and_unique_locations():
    grid = Grid()
    assert len(grid.lats) == 31
    assert len(grid.lngs) == 61
    assert len(grid.coords) == 1891
    # 29 latitudes internas x 60 longitudes + 2 polos
    assert len(grid.unique_coords) == 1742


@pytest.mark.parametrize(
    ('coord', 'expected'),
    [
        ((0, 180), (0, -180)),
        ((90, 36), (90, -180)),
        ((-90, 180), (-90, -180)),
        ((42, 12), (42, 12)),
    ],
)
def test_canonical_merges_identical_points(coord, expected):
    assert canonical(*coord) == expected


def test_payload_copies_values_to_duplicate_locations():
    grid = Grid()
    times = ['2026-11-02T17:00', '2026-11-02T18:00']
    series = {c: [float(i), float(i) + 0.5] for i, c in enumerate(grid.unique_coords)}
    payload = grid.payload(times, series)
    assert payload['times'] == times
    assert len(payload['values']) == 2
    n_lng = len(grid.lngs)
    for values in payload['values']:
        assert len(values) == len(grid.coords)
        at = lambda lat, lng: values[grid.lats.index(lat) * n_lng + grid.lngs.index(lng)]  # noqa: B023, E731
        assert at(6, 180) == at(6, -180)
        assert len({at(90, lng) for lng in grid.lngs}) == 1
    # lat-major, sul -> norte: o primeiro valor é o polo sul
    assert payload['values'][1][0] == series[(-90, -180)][1]


def test_stats_series_has_one_entry_per_time():
    grid = Grid()
    series = {c: [0.0, 10.0] for c in grid.unique_coords}
    stats = grid.stats_series(['a', 'b'], series)
    assert [s['avg'] for s in stats] == [0.0, 10.0]


def test_stats_average_is_area_weighted():
    grid = Grid()
    # Polos muito frios não devem puxar a média: a área deles é ~zero
    temps = {c: (-100.0 if abs(c[0]) == 90 else 10.0) for c in grid.unique_coords}
    stats = grid.stats(temps)
    assert stats['avg'] == pytest.approx(10.0)
    assert stats['min'] == -100.0
    assert stats['max'] == 10.0


def test_latitude_estimate_range():
    assert latitude_estimate(0) == pytest.approx(35)
    assert latitude_estimate(90) == pytest.approx(-30)
