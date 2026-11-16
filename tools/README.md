# Updating the data

These scripts rebuild the files in `../data/` that the site reads. Nothing here is loaded by the website.

## Each year, when FHWA publishes a new National Bridge Inventory file

1. On FHWA's NBI download page (https://www.fhwa.dot.gov/bridge/nbi/ascii.cfm), open the new year and download
   West Virginia's delimited file. Save it as `tools/work/raw/WV26.txt` (use the two-digit year).
2. The first time only, download the U.S. county boundaries (Census TIGER/Line counties shapefile, any recent year) and save the zip as `tools/work/raw/counties.zip`.
3. Run `NBI_YEAR=2026 bash tools/run_all.sh` with the right year. On Windows, run the six Python scripts in the order listed in `run_all.sh`, after setting `NBI_YEAR`.
4. Check that the counts printed by `build_data.py` look sensible, then commit the changed files in `data/`.

## Cameras only

WV511 adds and retires cameras from time to time. To refresh them without touching the bridge data, run:

```
python3 tools/fetch_wv511_cams.py
python3 tools/match_cams.py
python3 tools/build_cam_data.py
```

`match_cams.py` writes `tools/work/cams/matches.json`. To drop a camera match after review, add a line `BRIDGEID CAMID` to `tools/work/cams/excluded_matches.txt` and run `build_cam_data.py` again.

## What each script does

| Script | Reads | Writes |
|---|---|---|
| `build_data.py` | FHWA file, county boundaries | `work/bridges.json` (cleaned bridges, plain-word ratings, checked locations) |
| `build_map_data.py` | `work/bridges.json`, FHWA file | `data/bridges-map.json`, `data/counties.geojson`, `data/wv-outline.geojson` |
| `build_detail_data.py` | `work/bridges.json`, FHWA file | `data/bridges-detail.json` (bridge panel details) |
| `fetch_wv511_cams.py` | WV511 camera feed | `work/cams/wv511_cams.json` (cameras, locations, which streams work now) |
| `match_cams.py` | bridges and cameras | `work/cams/matches.json` |
| `build_cam_data.py` | matches, exclusions | `data/cameras.json` |

Python 3 with `pandas`, `geopandas`, `numpy` and `requests` is needed.
