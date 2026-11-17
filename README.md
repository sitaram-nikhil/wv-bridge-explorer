# WV Bridge Explorer

A free web map of West Virginia's 7,345 public bridges and their condition, built only on public data.

- **Map:** every bridge on a 3D satellite map, colored Good, Fair or Poor, with search and filters by condition, county, route, type, year built, owner, flood erosion risk and live camera.
- **Bridge panel:** open, posted or closed; the rating of each part in plain words; flood erosion risk; size, traffic, last inspection; a 3D model colored by condition; live WV511 camera video where a camera is nearby; links to Street View and Google Earth; a shareable link.
- **Summary:** charts by condition, lowest-rated part, age, county and type, and a sortable watch list of poor bridges with heavy traffic.
- **Downloads:** a Google Earth file (.kmz) and an Excel file (.xlsx) of all bridges or the filtered ones.

## Data

| What | Source |
|---|---|
| Bridges and ratings | FHWA National Bridge Inventory, West Virginia, 2026 file (new SNBI layout) |
| Live cameras | WV511 (WVDOH) |
| Map imagery and topographic maps | USGS The National Map (public domain) |
| 3D hills | AWS Terrain Tiles (open data) |

The data is as of the federal file. To update it, see `tools/README.md`.

## Publishing

The site is plain files with no build step and no server code.

- **GitHub Pages:** push this folder to a repository, then in **Settings > Pages** choose **Deploy from a branch**, branch `main`, folder `/ (root)`.
- **Netlify:** drag this folder onto the Netlify dashboard, or connect the repository; `netlify.toml` is already set up.

To try it on your own computer, run `python3 -m http.server` in this folder and open http://localhost:8000. Opening `index.html` directly from disk does not work, because browsers block the data files.

## Open-source parts

Bundled in `vendor/` and `fonts/`: MapLibre GL JS 5.24.1 (BSD-3-Clause), three.js 0.186.1 (MIT), hls.js 1.6.15 (Apache-2.0), Plus Jakarta Sans and JetBrains Mono (SIL Open Font License 1.1). License files are in `vendor/` and `fonts/`.
