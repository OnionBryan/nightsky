"""SIMBAD TAP + name resolver queries (Flask-compatible result dicts)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import requests

SIMBAD_TAP_URL = "https://simbad.u-strasbg.fr/simbad/sim-tap/sync"
SIMBAD_RESOLVE_URL = "https://simbad.u-strasbg.fr/simbad/sim-nameresolver"

SIMBAD_OBJECT_TYPES = {
    "*": "Star",
    "**": "Double Star",
    "*iC": "Star in Cluster",
    "*iN": "Star in Nebula",
    "AB*": "Asymptotic Giant Branch Star",
    "Ae*": "Herbig Ae/Be Star",
    "AGN": "Active Galactic Nucleus",
    "Bla": "BL Lac Object",
    "BS*": "Blue Straggler",
    "BY*": "Variable of BY Dra type",
    "C*": "Carbon Star",
    "Ce*": "Cepheid Variable",
    "Cl*": "Star Cluster",
    "CV*": "Cataclysmic Variable",
    "DN*": "Dwarf Nova",
    "Em*": "Emission-line Star",
    "ER*": "Eclipsing Binary",
    "G": "Galaxy",
    "GiC": "Galaxy in Cluster",
    "GiG": "Galaxy in Group",
    "GiP": "Galaxy in Pair",
    "GlC": "Globular Cluster",
    "HB*": "Horizontal Branch Star",
    "HII": "HII Region",
    "HV*": "High Velocity Star",
    "IG": "Interacting Galaxy",
    "IR": "Infrared Source",
    "LP*": "Long Period Variable",
    "Mi*": "Mira Variable",
    "Neb": "Nebula",
    "No*": "Nova",
    "OpC": "Open Cluster",
    "Or*": "Variable of Orion Type",
    "PN": "Planetary Nebula",
    "Psr": "Pulsar",
    "QSO": "Quasar",
    "RG*": "Red Giant",
    "RNe": "Reflection Nebula",
    "RR*": "RR Lyrae Variable",
    "RS*": "RS CVn Variable",
    "SB*": "Spectroscopic Binary",
    "SC*": "Semi-regular Variable",
    "Sg*": "Supergiant",
    "SN": "Supernova",
    "SNR": "Supernova Remnant",
    "SR*": "Semi-regular Variable",
    "sy*": "Symbiotic Star",
    "TT*": "T Tauri Star",
    "V*": "Variable Star",
    "WD*": "White Dwarf",
    "WR*": "Wolf-Rayet Star",
    "X": "X-ray Source",
    "XB*": "X-ray Binary",
    "YSO": "Young Stellar Object",
}


def get_object_type_name(type_code: Optional[str]) -> str:
    if not type_code:
        return "Unknown"
    return SIMBAD_OBJECT_TYPES.get(type_code, type_code)


def _priority(obj_type: str, type_code: str) -> int:
    ot = (obj_type or "").lower()
    tc = (type_code or "").lower()
    if "galaxy" in ot or tc in ("g", "gic", "gig", "gip", "ig"):
        return 1
    if "nebula" in ot or tc in ("neb", "pn", "hii", "rne"):
        return 2
    if "cluster" in ot or tc in ("glc", "opc", "cl*"):
        return 3
    if "supernova" in ot or tc in ("sn", "snr"):
        return 4
    if "pulsar" in ot or tc == "psr":
        return 5
    if "quasar" in ot or tc == "qso":
        return 6
    if "agn" in tc or "bla" in tc:
        return 7
    return 10


def query_region(
    ra: float,
    dec: float,
    radius: float = 1.0,
    limit: int = 20,
    *,
    session: Optional[requests.Session] = None,
    timeout: float = 20.0,
) -> Tuple[dict, int]:
    """
    SIMBAD circular region search.
    Returns (result_dict, http_status).
    """
    radius = max(0.01, min(5.0, float(radius)))
    limit = max(1, min(50, int(limit)))
    http = session or requests

    query = f"""
        SELECT TOP {limit}
            main_id, ra, dec, otype, sp_type,
            plx_value, rvz_radvel, galdim_majaxis, oid
        FROM basic
        WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra}, {dec}, {radius})) = 1
    """

    try:
        response = http.get(
            SIMBAD_TAP_URL,
            params={
                "request": "doQuery",
                "lang": "adql",
                "format": "json",
                "query": query,
            },
            timeout=timeout,
        )
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.Timeout:
        return {"error": "SIMBAD query timed out", "objects": []}, 504
    except requests.exceptions.RequestException as e:
        return {"error": f"SIMBAD request failed: {e}", "objects": []}, 502
    except Exception as e:
        return {"error": f"Query processing error: {e}", "objects": []}, 500

    objects: List[Dict[str, Any]] = []
    oid_list: List[int] = []
    for row in data.get("data") or []:
        type_code = row[3]
        obj = {
            "name": row[0],
            "ra": row[1],
            "dec": row[2],
            "type": get_object_type_name(type_code) if type_code else "Unknown",
            "type_code": type_code,
            "spectral_type": row[4],
            "parallax_mas": row[5],
            "radial_velocity_kms": row[6],
            "angular_size_arcmin": row[7],
            "oid": row[8],
            "magnitudes": {},
            "magnitude_v": None,
        }
        if obj["parallax_mas"] and obj["parallax_mas"] > 0:
            obj["distance_ly"] = 3261.5 / obj["parallax_mas"]
            obj["distance_pc"] = 1000.0 / obj["parallax_mas"]
        obj["priority"] = _priority(obj["type"], type_code or "")
        objects.append(obj)
        if obj["oid"] is not None:
            oid_list.append(int(obj["oid"]))

    if oid_list:
        try:
            oid_str = ",".join(str(oid) for oid in oid_list)
            flux_query = f"""
                SELECT oidref, flux
                FROM flux
                WHERE oidref IN ({oid_str}) AND filter = 'V'
            """
            flux_response = http.get(
                SIMBAD_TAP_URL,
                params={
                    "request": "doQuery",
                    "lang": "adql",
                    "format": "json",
                    "query": flux_query,
                },
                timeout=10,
            )
            if flux_response.ok:
                flux_data = flux_response.json()
                mag_map = {row[0]: row[1] for row in flux_data.get("data") or []}
                for obj in objects:
                    if obj["oid"] in mag_map:
                        obj["magnitude_v"] = mag_map[obj["oid"]]
                        obj["magnitudes"]["V"] = mag_map[obj["oid"]]
                        if mag_map[obj["oid"]] < 4 and obj["priority"] == 10:
                            obj["priority"] = 8
            objects.sort(key=lambda x: (x["priority"], x.get("magnitude_v") or 99))
        except Exception:
            pass

    return {
        "objects": objects,
        "count": len(objects),
        "query": {"ra": ra, "dec": dec, "radius": radius},
    }, 200


def resolve_name(
    name: str,
    *,
    session: Optional[requests.Session] = None,
    timeout: float = 10.0,
) -> Tuple[dict, int]:
    """Resolve object name via SIMBAD. Returns (result_dict, http_status)."""
    name = (name or "").strip()
    if not name:
        return {"error": "name parameter required", "found": False}, 400

    http = session or requests
    try:
        response = http.get(
            SIMBAD_RESOLVE_URL,
            params={"ident": name, "output": "json"},
            timeout=timeout,
        )
        response.raise_for_status()
        data = response.json()
    except requests.exceptions.Timeout:
        return {"error": "SIMBAD query timed out", "found": False}, 504
    except requests.exceptions.RequestException as e:
        return {"error": f"SIMBAD request failed: {e}", "found": False}, 502
    except Exception as e:
        return {"error": f"Resolution error: {e}", "found": False}, 500

    if not data:
        return {"found": False, "name": name, "error": "Object not found"}, 200

    obj = None
    for item in data:
        if "ra" in item and "dec" in item:
            obj = item
            break
    if obj is None:
        return {
            "found": False,
            "name": name,
            "error": "No object with coordinates found",
        }, 200

    type_code = obj.get("otype", "")
    result: Dict[str, Any] = {
        "found": True,
        "name": obj.get("mainId") or obj.get("name", name),
        "ra": obj["ra"],
        "dec": obj["dec"],
        "type": get_object_type_name(type_code),
        "type_code": type_code,
        "spectral_type": obj.get("sptype"),
        "aliases": (obj.get("idlist") or [])[:10],
    }

    oid = obj.get("oid")
    if oid is not None:
        oid = int(oid)
        try:
            detail_query = f"""
                SELECT main_id, otype, sp_type, plx_value,
                       rvz_radvel, galdim_majaxis
                FROM basic
                WHERE oid = {oid}
            """
            detail_response = http.get(
                SIMBAD_TAP_URL,
                params={
                    "request": "doQuery",
                    "lang": "adql",
                    "format": "json",
                    "query": detail_query,
                },
                timeout=timeout,
            )
            if detail_response.ok:
                detail_data = detail_response.json()
                if detail_data.get("data"):
                    row = detail_data["data"][0]
                    result["name"] = row[0] or result["name"]
                    result["type"] = get_object_type_name(row[1])
                    result["type_code"] = row[1]
                    result["spectral_type"] = row[2]
                    result["parallax_mas"] = row[3]
                    result["radial_velocity_kms"] = row[4]
                    result["angular_size_arcmin"] = row[5]
                    if result["parallax_mas"] and result["parallax_mas"] > 0:
                        result["distance_ly"] = 3261.5 / result["parallax_mas"]

            flux_query = f"SELECT flux FROM flux WHERE oidref = {oid} AND filter = 'V'"
            flux_response = http.get(
                SIMBAD_TAP_URL,
                params={
                    "request": "doQuery",
                    "lang": "adql",
                    "format": "json",
                    "query": flux_query,
                },
                timeout=timeout,
            )
            if flux_response.ok:
                flux_data = flux_response.json()
                if flux_data.get("data"):
                    result["magnitude_v"] = flux_data["data"][0][0]
                    result["magnitudes"] = {"V": flux_data["data"][0][0]}
        except Exception:
            pass

    return result, 200
