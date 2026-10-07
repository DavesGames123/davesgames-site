"""Shared grid geometry for the City Atlas build scripts.

Each city has a local east/north frame in metres with its origin at the city
centre (cities.json lat, lon): x = (lon - lon0) * KX, y = (lat - lat0) * KY.
The frame is equirectangular about the centre. Over 32 km its error against
a true tangent plane is under 0.1 %.

Grids are square, row-major, row 0 at the SOUTH edge, column 0 at the WEST
edge. Cell (i, j) has its centre at x = -half + (i + 0.5) * cell,
y = -half + (j + 0.5) * cell. The page samples them with
uv = ((x + half) / (2 half), (y + half) / (2 half)).

  INNER  12 km square, 512 cells (23.4 m): terrain, landcover, currents
  OUTER  64 km square, 256 cells (250 m): terrain, landcover, currents

grep: INNER  OUTER  def frame  def grid_lonlat
"""
import math

import numpy as np

M_PER_DEG = 6371000.0 * math.pi / 180.0
INNER = {'half': 6000.0, 'n': 512}
OUTER = {'half': 32000.0, 'n': 256}


def frame(city):
    """Return (lon0, lat0, kx, ky): metres per degree east and north."""
    lat0, lon0 = city['lat'], city['lon']
    return lon0, lat0, M_PER_DEG * math.cos(math.radians(lat0)), M_PER_DEG


def to_xy(city, lon, lat):
    lon0, lat0, kx, ky = frame(city)
    return (np.asarray(lon) - lon0) * kx, (np.asarray(lat) - lat0) * ky


def to_lonlat(city, x, y):
    lon0, lat0, kx, ky = frame(city)
    return lon0 + np.asarray(x) / kx, lat0 + np.asarray(y) / ky


def centers(g, n=None):
    n = n or g['n']
    c = 2 * g['half'] / n
    return -g['half'] + (np.arange(n) + 0.5) * c


def grid_lonlat(city, g, n=None):
    """lon, lat arrays of shape (n, n) for the cell centres of grid g."""
    xs = centers(g, n)
    X, Y = np.meshgrid(xs, xs)
    return to_lonlat(city, X, Y)


def bbox_lonlat(city, half):
    lon0, lat0, kx, ky = frame(city)
    return lon0 - half / kx, lat0 - half / ky, lon0 + half / kx, lat0 + half / ky
