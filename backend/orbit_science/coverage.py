"""Coverage heatmap grid computation (shared science helper)."""

from __future__ import annotations

import math
from typing import Dict, List, Tuple


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km between two lat/lon points (degrees)."""
    r = 6371.0
    rlat1, rlon1, rlat2, rlon2 = (math.radians(v) for v in (lat1, lon1, lat2, lon2))
    dlat = rlat2 - rlat1
    dlon = rlon2 - rlon1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    return r * 2 * math.asin(math.sqrt(min(1.0, a)))


def compute_coverage_grid(
    positions: List[dict],
    half_width_km: float,
    grid_size: int,
) -> Tuple[Dict[Tuple[int, int], int], int, int]:
    """
    Build a {(lat_idx, lon_idx): pass_count} grid from propagated positions.

    For each position, marks all grid cells whose centers fall within
    half_width_km of the sub-satellite point.
    """
    r = 6371.0
    angular_radius = half_width_km / r * (180.0 / math.pi)
    n_lat = int(180 / grid_size)
    n_lon = int(360 / grid_size)
    grid: Dict[Tuple[int, int], int] = {}

    for pos in positions:
        plat = pos["latitude"]
        plon = pos["longitude"]

        lat_min = max(-90.0, plat - angular_radius - grid_size)
        lat_max = min(90.0, plat + angular_radius + grid_size)

        lat_idx_lo = max(0, int((lat_min + 90) / grid_size))
        lat_idx_hi = min(n_lat - 1, int((lat_max + 90) / grid_size))

        for lat_idx in range(lat_idx_lo, lat_idx_hi + 1):
            cell_lat = -90.0 + lat_idx * grid_size + grid_size / 2.0

            cos_lat = math.cos(math.radians(cell_lat))
            if cos_lat > 0.001:
                lon_range = angular_radius / cos_lat
            else:
                lon_range = 180.0

            lon_min = plon - lon_range - grid_size
            lon_max = plon + lon_range + grid_size

            lon_idx_lo = int((lon_min + 180) / grid_size) % n_lon
            lon_idx_hi = int((lon_max + 180) / grid_size) % n_lon

            if lon_idx_lo <= lon_idx_hi:
                lon_range_iter = range(lon_idx_lo, lon_idx_hi + 1)
            else:
                lon_range_iter = list(range(lon_idx_lo, n_lon)) + list(range(0, lon_idx_hi + 1))

            for lon_idx in lon_range_iter:
                cell_lon = -180.0 + lon_idx * grid_size + grid_size / 2.0
                dist = haversine_km(plat, plon, cell_lat, cell_lon)
                if dist <= half_width_km:
                    key = (lat_idx, lon_idx)
                    grid[key] = grid.get(key, 0) + 1

    return grid, n_lat, n_lon
