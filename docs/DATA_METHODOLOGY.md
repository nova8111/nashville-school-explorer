# Data methodology

## Source priority and vintages

Official Tennessee Department of Education (TDOE) downloads are authoritative for the state's academic measures. The pipeline discovers the published data links from the TDOE Data Downloads page at refresh time. The initial source set covers 2024–25 letter grades, schoolwide TVAAS composites and enrollment, plus the latest available school accountability assessment workbook. Each metric stores the source ID and its own reporting year; a school does not have one assumed universal reporting year.

NCES EDGE public school point locations supply the geographic campus reference and NCES identifiers. The current endpoint represents 2023–24 CCD data. Census 2024 ZCTA Gazetteer internal points supply ZIP-area search centers. Neither source is silently presented as a TDOE academic value.

## School identity

The preferred canonical ID is `TN-{LEA}-{state school ID}` when both Tennessee IDs are available. NCES-only records use `NCES-{NCES ID}` until an explicit state crosswalk is available. The NCES point layer does not include Tennessee school numbers, so the current pipeline joins TDOE records by a unique exact name normalized for case and punctuation. For LEA 190, the verified district crosswalk is NCES LEA 4703180. Conflicting and ambiguous records are counted in `quality_report.json`. Approximate fuzzy matching is not used.

The NCES location query does not carry Tennessee school IDs or grade spans. Records without a unique source match retain unavailable academic metrics. The unmatched-source count is scoped to potentially in-scope records; other Tennessee school records are counted separately as out of scope.

## Geography

The search uses the Haversine great-circle formula with Earth radius 3,958.8 miles. The origin coordinate is a Census ZCTA internal point, an approximate search center; it is not asserted to be the postal ZIP centroid. The ZIP input accepts Tennessee 37xxx codes represented in the cached 2024 Gazetteer. Its suggestion list intentionally contains only the 24 curated Nashville-area codes. School coordinates are NCES EDGE campus points. Coordinates outside the rough Davidson/Nashville sanity envelope are rejected. No school ZIP centroid fallback is used. Only verified campus points enter the radius result list.

ZIP codes and ZCTAs are not equivalent geographic units. A ZIP may have no corresponding ZCTA. Unsupported codes are reported clearly.

## Metric definitions and missingness

- **ELA / Math proficiency:** school-level published percentage meeting the relevant Tennessee assessment proficiency standard, where the TDOE file provides an identifiable all-students accountability field. Grade aggregation is not recomputed by this pipeline.
- **TVAAS composite:** official schoolwide growth level on Tennessee's 1–5 scale. This is a growth measure, not an achievement/proficiency percentage. The raw composite field and reporting year must be confirmed when source layouts change.
- **Letter grade:** official TDOE A–F school accountability grade for the year in the workbook.
- **Enrollment:** total student count in the 2024–25 TDOE school profile, with the source capture period preserved.
- **Graduation rate:** currently unavailable pending ingestion of a verified school-level graduation cohort file.

Metric statuses distinguish `reported`, `not_reported`, `suppressed`, `not_applicable`, `unavailable`, and `unverified`. Suppression markers remain null and are never interpreted as zero. Missing metric years remain visible to users.

## Classification and scope

The application searches public schools in Davidson County from the NCES public school location layer. That geography does not imply that every nearby school belongs to Metro Nashville Public Schools LEA 190. Type is only labelled `Public` unless a reliable governance classification is integrated. Charter, magnet, specialized program, and zoning characteristics can overlap and are not inferred from the school name.

## Validation and refresh

The pipeline records each source's URL, retrieval time, year, status, and parsed record count. It writes JSON through temporary files and checks required names, IDs, and geographic bounds before publishing. A source layout it cannot interpret is an explicit pipeline issue, not a reason to fabricate or silently substitute data. The quality report counts discovered/downloaded sources, campus coverage, metric coverage, unmatched rows, ambiguous matches, and critical failures.

Review the source workbook headers and quality report after each annual update. TDOE can change fields and accountability methods. Historical comparisons should not be presented across a methodology break without separately documented comparability review. This version does not yet ingest historical trends.

## Responsible use

The explorer is informational. It does not determine school assignment, guarantee admission or enrollment, or replace the Tennessee State Report Card. No student-level information is collected or reconstructed. Public map tiles are supplied by OpenStreetMap contributors and must be used within the tile provider's published policy.
