import pytest

from globetemp.grid import Grid, canonical, latitude_estimate


def test_grid_dimensions_and_unique_locations():
    grid = Grid()
    assert len(grid.lats) == 16
    assert len(grid.lngs) == 31
    assert len(grid.coords) == 496
    # 14 latitudes internas x 30 longitudes + 2 polos
    assert len(grid.unique_coords) == 422


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


def test_points_copy_values_to_duplicate_locations():
    grid = Grid()
    temps = {c: float(i) for i, c in enumerate(grid.unique_coords)}
    by_coord = {(p['lat'], p['lng']): p['temp'] for p in grid.points(temps)}
    assert by_coord[(6, 180)] == by_coord[(6, -180)]
    assert len({by_coord[(90, lng)] for lng in grid.lngs}) == 1


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
