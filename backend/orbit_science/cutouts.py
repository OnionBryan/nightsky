"""HiPS2FITS survey catalog and cutout URL builders (no network required)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

HIPS2FITS_URL = "https://alasky.cds.unistra.fr/hips-image-services/hips2fits"

AVAILABLE_SURVEYS = {
    "dss2_color": "CDS/P/DSS2/color",
    "dss2_red": "CDS/P/DSS2/red",
    "dss2_blue": "CDS/P/DSS2/blue",
    "sdss9_color": "CDS/P/SDSS9/color",
    "sdss9_g": "CDS/P/SDSS9/g",
    "sdss9_r": "CDS/P/SDSS9/r",
    "panstarrs_color": "CDS/P/PanSTARRS/DR1/color-z-zg-g",
    "panstarrs_g": "CDS/P/PanSTARRS/DR1/g",
    "panstarrs_r": "CDS/P/PanSTARRS/DR1/r",
    "decaps": "CDS/P/DECaPS/DR2/color",
    "skymapper": "CDS/P/skymapper-color",
    "hla_v": "CDS/P/HLA/V",
    "hla_widev": "CDS/P/HLA/wideV",
    "hla_b": "CDS/P/HLA/B",
    "hla_r": "CDS/P/HLA/R",
    "hla_i": "CDS/P/HLA/I",
    "hla_sdssg": "CDS/P/HLA/SDSSg",
    "hla_sdssr": "CDS/P/HLA/SDSSr",
    "hla_halpha": "CDS/P/HLA/Halpha",
    "hla_oiii": "CDS/P/HLA/OIII",
    "2mass_color": "CDS/P/2MASS/color",
    "2mass_j": "CDS/P/2MASS/J",
    "2mass_h": "CDS/P/2MASS/H",
    "2mass_k": "CDS/P/2MASS/K",
    "wise_color": "CDS/P/allWISE/color",
    "hla_h": "CDS/P/HLA/H",
    "hla_j": "CDS/P/HLA/J",
    "hla_y": "CDS/P/HLA/Y",
    "galex_nuv": "CDS/P/GALEXGR6_7/NUV",
    "galex_fuv": "CDS/P/GALEXGR6_7/FUV",
    "hla_uv": "CDS/P/HLA/UV",
    "hla_u": "CDS/P/HLA/U",
    "hla_wideuv": "CDS/P/HLA/wideUV",
    "mellinger": "CDS/P/Mellinger/color",
    "fermi": "CDS/P/Fermi/color",
    "rosat": "CDS/P/RASS",
}

SURVEY_CATEGORIES = {
    "optical": ["dss2_color", "dss2_red", "sdss9_color", "panstarrs_color"],
    "infrared": ["2mass_color", "2mass_j", "wise_color"],
    "ultraviolet": ["galex_nuv", "galex_fuv"],
    "hubble": ["hla_v", "hla_b", "hla_h"],
    "other": ["mellinger", "fermi", "rosat"],
}


def list_surveys() -> dict:
    return {"surveys": AVAILABLE_SURVEYS, "categories": SURVEY_CATEGORIES}


def build_cutout(
    ra: float,
    dec: float,
    fov: float = 0.1,
    survey: str = "dss2_color",
    width: int = 500,
    height: int = 500,
    output_format: str = "jpg",
) -> Tuple[dict, int]:
    hips_id = AVAILABLE_SURVEYS.get(survey)
    if not hips_id:
        return {
            "error": f"Unknown survey: {survey}",
            "available": list(AVAILABLE_SURVEYS.keys()),
        }, 400

    width = max(100, min(2000, int(width)))
    height = max(100, min(2000, int(height)))
    fov = max(0.001, min(10.0, float(fov)))

    cutout_url = (
        f"{HIPS2FITS_URL}?"
        f"hips={hips_id}&"
        f"ra={ra}&dec={dec}&"
        f"fov={fov}&"
        f"width={width}&height={height}&"
        f"projection=TAN&"
        f"format={output_format}"
    )
    return {
        "url": cutout_url,
        "survey": survey,
        "hips_id": hips_id,
        "ra": ra,
        "dec": dec,
        "fov_deg": fov,
        "width": width,
        "height": height,
        "format": output_format,
    }, 200


def build_cutout_multi(
    ra: float,
    dec: float,
    fov: float = 0.1,
    surveys: Optional[List[str]] = None,
) -> dict:
    if surveys is None:
        surveys = ["dss2_color", "sdss9_color", "2mass_color"]
    fov = max(0.001, min(10.0, float(fov)))
    cutouts: List[Dict[str, Any]] = []
    for survey in surveys:
        hips_id = AVAILABLE_SURVEYS.get(survey.strip())
        if not hips_id:
            continue
        cutout_url = (
            f"{HIPS2FITS_URL}?"
            f"hips={hips_id}&"
            f"ra={ra}&dec={dec}&"
            f"fov={fov}&"
            f"width=400&height=400&"
            f"projection=TAN&"
            f"format=jpg"
        )
        cutouts.append({"survey": survey.strip(), "hips_id": hips_id, "url": cutout_url})
    return {
        "ra": ra,
        "dec": dec,
        "fov_deg": fov,
        "cutouts": cutouts,
        "count": len(cutouts),
    }
