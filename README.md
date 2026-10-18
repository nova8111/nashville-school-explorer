# Nashville School Explorer

A static React and TypeScript application for exploring public schools in Nashville and Davidson County. School results are source-backed; this repository does not include fabricated example schools or performance values.

## Status

The interface and refresh pipeline are implemented. A real source refresh has been run and the current checked-in bundle includes verified school locations and source-backed academic metrics. Metric coverage is incomplete and displayed explicitly; no sample school results are mixed into production data.

## Stack and architecture

- React, TypeScript, Vite, React-Leaflet, Leaflet, Lucide icons
- Python, pandas, openpyxl, requests, BeautifulSoup for the data refresh
- Static JSON output in `public/data`; no server, database, account, API key, or paid service
- Data flow: TDOE download page → cached official workbooks → parsed and joined records → geographic/data validation → atomic JSON publish → browser-side distance/filter/sort/map

## Sources

| Source | Dataset | Reporting vintage | Purpose |
| --- | --- | --- | --- |
| [TDOE Data Downloads](https://www.tn.gov/education/districts/federal-programs-and-oversight/data/data-downloads.html) | School letter grades, school accountability proficiency, schoolwide TVAAS composite, school profile | 2024–25/2025 where published | Academic metrics, enrollment, and grade spans |
| [NCES EDGE public school locations](https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_GEOCODE_PUBLICSCH_2324/MapServer/0) | Public school campus points, 2023–24 CCD | 2023–24 | School names, campus points, NCES IDs |
| [U.S. Census Gazetteer](https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/) | 2024 ZCTA Gazetteer | 2024 | Census ZCTA centroids for Nashville ZIP search centers |

TDOE's data download page is discovered at runtime, so the pipeline does not rely on only a brittle link embedded in the application. Each published source has a manifest record, source URL, status, retrieval timestamp, and parsed row count. TDOE values retain their dataset year and source ID. Excel column layouts vary; the parser searches known header patterns and reports when it cannot identify the school ID or measure.

## Requirements and setup

- Node.js 20 or later
- Python 3.11 or later

```powershell
npm install
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Start the app:

```powershell
npm run dev
```

Build for static deployment:

```powershell
npm run build
npm run preview
```

## Refresh data

```powershell
python data_pipeline.py
```

The refresh downloads TDOE school reports, queries the NCES 2023–24 school location service for Tennessee / Davidson County, and downloads the Census 2024 ZCTA Gazetteer. Raw files are kept in `data/raw`, reusable parsed inputs in `data/cache`, and normalized output in `data/processed`. The web bundle is copied to `public/data` only after record validation. To reprocess cached TDOE workbooks without retrieving new files:

```powershell
python data_pipeline.py --offline
```

Inspect `data/source_manifest.json` and `data/quality_report.json` after every refresh. `--offline` does not currently cache the NCES or Census response payloads, so those output sections are marked not requested; the checked-in bundle still reflects only what was previously processed. Do not treat a partial refresh as a complete academic dataset.

## Search and metric behavior

- Search centers use Census ZCTA centroids. ZCTAs approximate ZIP geography and are not exact postal ZIP boundaries.
- School markers use the NCES EDGE campus points. School records without a verified campus point are not included in radius results.
- Distances use Haversine great-circle distance and an Earth radius of 3,958.8 miles.
- ELA and mathematics show published school-level proficiency values when the TDOE workbook exposes an unambiguous applicable field. Suppression remains unavailable; it is never converted to zero.
- TVAAS school composites use Tennessee's 1–5 growth level. TVAAS describes growth, not proficiency.
- Letter grades use the official TDOE A–F file. Available academic years may differ across indicators.
- The app does not calculate an overall rank. A school's academic achievement, growth, and accountability grade are distinct measures.
- School type is shown as `Public` unless a reliable governance classification is available; charter, magnet, and zoning status are not inferred from a name.

## Tests

```powershell
npm test
python -m pytest
npm run build
```

Current automated tests cover frontend distance math and rendering of the no-data state, plus Python normalization and suppression handling. Use the real refreshed JSON bundle for manual browser verification. A full Playwright flow is not configured in this repository.

## Deployment

GitHub Pages deploys automatically from the `main` branch through `.github/workflows/deploy.yml`. The workflow builds with the repository base path and publishes `dist`; local development continues to use the root path. All data is static and no secrets or paid API credentials are needed. Leaflet uses OpenStreetMap standard tiles and includes required attribution; production deployments must respect the tile service's usage policy and switch to a suitable provider if traffic warrants it.

## Limitations and next steps

- The first successfully refreshed bundle contains current NCES and Census records and recent TDOE indicators. Check the generated quality report for the exact count and metric coverage each time it is refreshed.
- The NCES service publishes a 2023–24 school point inventory, which may lag school openings, closures, and relocations.
- The first parser pass is header-driven. It logs unrecognized layouts rather than guessing. Check metric field meanings and suppression conventions against each workbook before publishing a new year.
- The pipeline currently obtains school-level geometry from NCES but only links state reporting metrics where source identifiers or unique exact-name matches are available. Ambiguous rows are logged rather than merged.
- ZCTA labels in the initial search list are human-readable area names; the coordinates remain explicitly attributed to Census ZCTAs.
- Historical charts, address lookup, grade span enrichment, school governance/program crosswalks, E2E tests, and automated scheduled refresh are not yet implemented.

See [docs/DATA_METHODOLOGY.md](docs/DATA_METHODOLOGY.md) for detail.
