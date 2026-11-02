import math

from . import config


def latitude_estimate(lat):
    """Estimativa grosseira por latitude: ~35 °C no equador, ~-30 °C nos polos."""
    c = math.cos(math.radians(lat))
    return 35 * c - 30 * (1 - c)


def canonical(lat, lng):
    """Mapeia pontos fisicamente idênticos para uma só localização (polos e ±180°)."""
    if abs(lat) == 90 or lng == 180:
        return (lat, -180)
    return (lat, lng)


class Grid:
    """Grade equiretangular lat × lng, incluindo as bordas -180/180 e os polos.

    O cliente precisa da grade completa para interpolar sem tratar o wrap, mas só as
    localizações únicas (`unique_coords`) são consultadas na API.
    """

    def __init__(self, step=config.GRID_STEP):
        self.lats = list(range(-90, 91, step))
        self.lngs = list(range(-180, 181, step))
        self.coords = [(la, ln) for la in self.lats for ln in self.lngs]
        self.unique_coords = sorted({canonical(la, ln) for la, ln in self.coords})

    def synthetic(self):
        return {coord: latitude_estimate(coord[0]) for coord in self.unique_coords}

    def points(self, temps):
        """Expande `temps` (por localização única) para a lista de pontos da grade completa."""
        return [
            {'lat': lat, 'lng': lng, 'temp': round(float(temps[canonical(lat, lng)]), 2)}
            for (lat, lng) in self.coords
        ]

    def stats(self, temps):
        """Mínimo, máximo e média ponderada por área (cos da latitude).

        Cada ponto da grade equiretangular cobre menos superfície quanto mais perto do polo.
        """
        values = [float(temps[c]) for c in self.unique_coords]
        weights = [math.cos(math.radians(lat)) for lat, _ in self.unique_coords]
        avg = sum(v * w for v, w in zip(values, weights, strict=True)) / sum(weights)
        return {'min': round(min(values), 1), 'max': round(max(values), 1), 'avg': round(avg, 1)}
