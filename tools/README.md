# Updating the data

These scripts rebuild the files in `../data/` that the site reads. Nothing here is loaded by the website.

## How the data is built

Every FHWA file is first turned into the same **bridge record** format (`bridge_record.py` lists every field
and its allowed values). Everything after that step reads only those records, so when FHWA changes its file
layout, only a converter has to change.

| FHWA file | Layout | Converter |
|---|---|---|
| 2026 onward | JSON, "Specifications for the National Bridge Inventory" (SNBI) | `convert_snbi.py` |
| 1992 to 2025 | Comma-delimited text, "Recording and Coding Guide" | `convert_nbi_ascii.py` |

`build_data.py` picks the converter from the file it finds.

## Each year, when FHWA publishes a new National Bridge Inventory file

1. On FHWA's download page (https://www.fhwa.dot.gov/bridge/nbi/nbi_data.cfm), open the new year and download
   West Virginia's **JSON** file. Save it as `tools/work/raw/WV27.json` (use the two-digit year).
2. The first time only, download the U.S. county boundaries (Census TIGER/Line counties shapefile, any recent year) and save the zip as `tools/work/raw/counties.zip`.
3. Run `NBI_YEAR=2027 bash tools/run_all.sh` with the right year. On Windows, run the six Python scripts in the order listed in `run_all.sh`, after setting `NBI_YEAR`.
4. Check that the counts printed by `build_data.py` look sensible, then commit the changed files in `data/`.

Notes on the 2026 file: FHWA moved every state to the new SNBI layout in 2026 and 2027, and some values still use
temporary "-T" codes from that changeover. `convert_snbi.py` handles them (it prints how many it found). A saved
link to a bridge that is no longer in the file (replaced, removed or renumbered) opens the statewide map with a short note.

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
| `build_data.py` | FHWA file, county boundaries | `work/bridges.json` (bridge records; runs `convert_snbi.py` or `convert_nbi_ascii.py`) |
| `bridge_record.py` | | The bridge-record format and the location checks both converters share |
| `build_map_data.py` | `work/bridges.json` | `data/bridges-map.json`, `data/counties.geojson`, `data/wv-outline.geojson` |
| `build_detail_data.py` | `work/bridges.json` | `data/bridges-detail.json` (bridge panel details) |
| `fetch_wv511_cams.py` | WV511 camera feed | `work/cams/wv511_cams.json` (cameras, locations, which streams work now) |
| `match_cams.py` | bridges and cameras | `work/cams/matches.json` |
| `build_cam_data.py` | matches, exclusions | `data/cameras.json` |

Python 3 with `pandas`, `geopandas`, `numpy` and `requests` is needed.
