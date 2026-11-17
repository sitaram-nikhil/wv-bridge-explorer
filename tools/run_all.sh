#!/usr/bin/env bash
# Rebuild every data file the site uses. Run from anywhere:
#   NBI_YEAR=2026 bash tools/run_all.sh
# Needs Python 3 with pandas, geopandas, numpy, requests. See tools/README.md.
set -euo pipefail
cd "$(dirname "$0")"
python3 build_data.py          # picks convert_snbi.py (WV<yy>.json) or convert_nbi_ascii.py (WV<yy>.txt)
python3 build_map_data.py
python3 build_detail_data.py
python3 fetch_wv511_cams.py
python3 match_cams.py
python3 build_cam_data.py
echo "Done. Reload the site to see the new data."
