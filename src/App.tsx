import { useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  ZoomControl,
} from "react-leaflet";
import L from "leaflet";
import {
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  Expand,
  GraduationCap,
  Info,
  LocateFixed,
  MapPin,
  Minimize2,
  Plus,
  Search,
  Share2,
  X,
} from "lucide-react";
import type { School, Zip } from "./types";
import { haversineMiles } from "./utils/geo";
import { Dialog } from "./components/Dialog";
import { MapViewport } from "./components/MapViewport";
import { readSearch, readShortlist, SHORTLIST_KEY } from "./utils/preferences";
const emptyMetric = {
  value: null,
  year: null,
  status: "unavailable",
  source_id: null,
} as const;
const gradeColors: Record<string, string> = {
  A: "#24785d",
  B: "#69a77a",
  C: "#d2a83e",
  D: "#df8550",
  F: "#b94d4d",
};
function markerIcon(color: string, active = false, count = 1) {
  return L.divIcon({
    className: "school-pin-wrap",
    html: `<span class="school-pin ${active ? "active" : ""}" style="--pin:${color}"></span>${count > 1 ? `<b class="campus-count">${count}</b>` : ""}`,
    iconSize: [24, 30],
    iconAnchor: [12, 29],
    popupAnchor: [0, -26],
  });
}
function metric(s: School, key: keyof School["academic_metrics"]) {
  return s.academic_metrics?.[key] ?? emptyMetric;
}
function displayMetric(
  m: {
    value: number | string | null;
    year: string | null;
    status: string;
  },
  suffix = "",
) {
  if (m.status === "suppressed") return "Suppressed";
  if (m.status === "not_applicable") return "Not applicable";
  if (m.value === null || m.status !== "reported")
    return m.status === "unavailable" ? "Unavailable" : "Not reported";
  return `${m.value}${suffix}`;
}
function yearLabel(s: School) {
  const years = Object.values(s.academic_metrics ?? {})
    .map((m) => m.year)
    .filter(Boolean);
  return years.length
    ? `Latest available · ${years.sort().at(-1)}`
    : "No reporting year";
}
function gradeName(grade: number) {
  return grade === 0 ? "K" : String(grade);
}
type SchoolLevel = "Elementary" | "Middle" | "High" | "Grade span unavailable";
function schoolMatchesLevels(s: School, levels: SchoolLevel[]) {
  if (!levels.length) return true;
  const { min, max } = s.grades;
  if (min === null || max === null)
    return levels.includes("Grade span unavailable");
  return (
    (levels.includes("Elementary") && min <= 5 && max >= -1) ||
    (levels.includes("Middle") && min <= 8 && max >= 6) ||
    (levels.includes("High") && min <= 12 && max >= 9)
  );
}
const eocMeasures = [
  ["Grade 9 ELA", "ela_grade_9"],
  ["Grade 10 ELA", "ela_grade_10"],
  ["English I EOC", "eoc_english_i"],
  ["English II EOC", "eoc_english_ii"],
  ["Algebra I EOC", "eoc_algebra_i"],
  ["Geometry EOC", "eoc_geometry"],
] as const;
function App() {
  const [initialSearch] = useState(readSearch);
  const [saved, setSaved] = useState<string[]>(readShortlist),
    [showSaved, setShowSaved] = useState(false),
    [showHelp, setShowHelp] = useState(false),
    [notice, setNotice] = useState("");
  const [mapRequest, setMapRequest] = useState(0),
    [mapSchool, setMapSchool] = useState<{
      lat: number;
      lon: number;
      request: number;
    } | null>(null);
  const resultsRef = useRef<HTMLElement | null>(null);
  const zipEntryRef = useRef<HTMLDivElement | null>(null);
  const [schools, setSchools] = useState<School[]>([]),
    [zips, setZips] = useState<Record<string, Zip>>({}),
    [manifest, setManifest] = useState<any>(null),
    [loaded, setLoaded] = useState(false),
    [loadError, setLoadError] = useState("");
  const [zip, setZip] = useState(initialSearch.zip),
    [radius, setRadius] = useState(initialSearch.radius),
    [query, setQuery] = useState(initialSearch.query),
    [sort, setSort] = useState(initialSearch.sort),
    [gradeMin, setGradeMin] = useState(initialSearch.gradeMin),
    [gradeMax, setGradeMax] = useState(initialSearch.gradeMax),
    [schoolLevels, setSchoolLevels] = useState<SchoolLevel[]>(
      initialSearch.levels as SchoolLevel[],
    ),
    [letterFilter, setLetterFilter] = useState(initialSearch.letter),
    [mapColor, setMapColor] = useState("School letter grade"),
    [showZipSuggestions, setShowZipSuggestions] = useState(false);
  const [selected, setSelected] = useState<School | null>(null),
    [compare, setCompare] = useState<string[]>([]),
    [showCompare, setShowCompare] = useState(false),
    [activeMarker, setActiveMarker] = useState<string | null>(null),
    [mobilePane, setMobilePane] = useState<"results" | "map">("results"),
    [mapFullscreen, setMapFullscreen] = useState(false);
  const mapSectionRef = useRef<HTMLElement | null>(null);
  const toggleMapFullscreen = () => setMapFullscreen((value) => !value);
  useEffect(() => {
    if (!mapFullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMapFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mapFullscreen]);
  useEffect(() => {
    if (!showZipSuggestions) return;
    const close = (event: PointerEvent) => {
      if (!zipEntryRef.current?.contains(event.target as Node))
        setShowZipSuggestions(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [showZipSuggestions]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const toggleSaved = (id: string) => {
    const next = saved.includes(id)
      ? saved.filter((value) => value !== id)
      : [...saved, id];
    setSaved(next);
    try {
      localStorage.setItem(SHORTLIST_KEY, JSON.stringify(next));
      setNotice(
        next.includes(id)
          ? "School saved to your shortlist."
          : "School removed from your shortlist.",
      );
    } catch {
      setNotice(
        "Shortlist updated for this visit. Browser storage is unavailable.",
      );
    }
  };
  const shareSearch = async (schoolId?: string) => {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    const params = url.searchParams;
    params.set("zip", zip);
    params.set("radius", String(radius));
    if (query) params.set("q", query);
    if (gradeMin !== 0) params.set("min", String(gradeMin));
    if (gradeMax !== 12) params.set("max", String(gradeMax));
    if (schoolLevels.length) params.set("levels", schoolLevels.join(","));
    if (letterFilter !== "Any letter grade") params.set("letter", letterFilter);
    if (sort !== "Distance") params.set("sort", sort);
    if (schoolId) params.set("school", schoolId);
    try {
      await navigator.clipboard.writeText(url.toString());
      setNotice("Link copied to clipboard.");
    } catch {
      setShareUrl(url.toString());
    }
  };
  const [shareUrl, setShareUrl] = useState("");
  useEffect(() => {
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/nashville_schools.json`).then(
        (r) => {
          if (!r.ok) throw Error("School data could not be loaded.");
          return r.json();
        },
      ),
      fetch(`${import.meta.env.BASE_URL}data/nashville_zipcodes.json`).then(
        (r) => {
          if (!r.ok) throw Error("ZIP reference data could not be loaded.");
          return r.json();
        },
      ),
      fetch(`${import.meta.env.BASE_URL}data/source_manifest.json`).then((r) =>
        r.ok ? r.json() : null,
      ),
    ])
      .then(([a, b, c]) => {
        setSchools(a);
        setZips(b);
        setManifest(c);
        setLoaded(true);
      })
      .catch((e) => {
        setLoadError(e.message);
        setLoaded(true);
      });
  }, []);
  const origin = zips[zip];
  useEffect(() => {
    if (!loaded || !initialSearch.school) return;
    const school = schools.find((item) => item.id === initialSearch.school);
    if (school)
      setSelected({
        ...school,
        distance:
          origin && school.location.lat !== null && school.location.lon !== null
            ? haversineMiles(origin, {
                lat: school.location.lat,
                lon: school.location.lon,
              })
            : null,
      });
  }, [loaded, initialSearch.school]);
  const matches = useMemo(
    () =>
      !origin
        ? []
        : schools
            .flatMap((s) => {
              if (
                !s.location?.verified ||
                s.location.lat === null ||
                s.location.lon === null
              )
                return [];
              let dist = origin
                ? haversineMiles(origin, {
                    lat: s.location.lat,
                    lon: s.location.lon,
                  })
                : null;
              return [{ ...s, distance: dist }];
            })
            .filter((s: any) => {
              const q = query.trim().toLowerCase();
              if (q && !s.name.toLowerCase().includes(q)) return false;
              if (
                (gradeMin > 0 || gradeMax < 12) &&
                (s.grades.min === null ||
                  s.grades.max === null ||
                  s.grades.max < gradeMin ||
                  s.grades.min > gradeMax)
              )
                return false;
              if (!schoolMatchesLevels(s, schoolLevels)) return false;
              if (
                letterFilter !== "Any letter grade" &&
                metric(s, "letter_grade").value !== letterFilter
              )
                return false;
              if (origin && s.distance > radius) return false;
              return true;
            })
            .sort((a: any, b: any) => {
              if (sort === "School name") return a.name.localeCompare(b.name);
              if (sort === "ELA proficiency")
                return (
                  Number(metric(b, "ela_proficiency").value ?? -1) -
                  Number(metric(a, "ela_proficiency").value ?? -1)
                );
              if (sort === "Math proficiency")
                return (
                  Number(metric(b, "math_proficiency").value ?? -1) -
                  Number(metric(a, "math_proficiency").value ?? -1)
                );
              if (sort === "TVAAS growth")
                return (
                  Number(metric(b, "tvaas_growth_score").value ?? -1) -
                  Number(metric(a, "tvaas_growth_score").value ?? -1)
                );
              if (sort === "Letter grade") {
                const rank = (v: any) =>
                  ({ A: 5, B: 4, C: 3, D: 2, F: 1 })[String(v)] ?? 0;
                return (
                  rank(metric(b, "letter_grade").value) -
                  rank(metric(a, "letter_grade").value)
                );
              }
              return (a.distance ?? Infinity) - (b.distance ?? Infinity);
            }),
    [
      schools,
      origin,
      zip,
      radius,
      query,
      gradeMin,
      gradeMax,
      schoolLevels,
      letterFilter,
      sort,
    ],
  );
  const center: [number, number] = origin
    ? [origin.lat, origin.lon]
    : [36.1627, -86.7816];
  const gradeBandLabel =
    gradeMin === 0 && gradeMax === 12
      ? "All grades (K–12)"
      : `${gradeName(gradeMin)}–${gradeName(gradeMax)}`;
  const toggleCompare = (id: string) => {
    if (compare.includes(id)) {
      setCompare(compare.filter((x) => x !== id));
      return;
    }
    if (compare.length === 3) {
      setNotice("You can compare up to 3 schools. Remove one to add another.");
      return;
    }
    setCompare([...compare, id]);
  };
  const resetFilters = () => {
    setQuery("");
    setGradeMin(0);
    setGradeMax(12);
    setSchoolLevels([]);
    setLetterFilter("Any letter grade");
    setRadius(2);
    setSort("Distance");
  };
  const openSchool = (school: School) => {
    setActiveMarker(school.id);
    setSelected(school);
  };
  const locateSchool = (school: School) => {
    setActiveMarker(school.id);
    setMobilePane("map");
    if (school.location.lat !== null && school.location.lon !== null)
      setMapSchool({
        lat: school.location.lat,
        lon: school.location.lon,
        request: Date.now(),
      });
  };
  const campusGroups = useMemo(() => {
    const groups = new Map<string, typeof matches>();
    for (const school of matches) {
      const key = `${school.location.lat},${school.location.lon}`;
      groups.set(key, [...(groups.get(key) ?? []), school]);
    }
    return [...groups.values()];
  }, [matches]);
  const sourceRef = (id: string | null) =>
    manifest?.sources?.find((s: any) => s.id === id)?.source_url ?? id ?? "";
  const exportCsv = () => {
    const rows = [
      [
        "School ID",
        "School name",
        "Type",
        "Grades",
        "ZIP",
        "Distance miles",
        "ELA",
        "ELA year",
        "ELA source",
        "Grade 9 ELA",
        "Grade 9 ELA year",
        "Grade 10 ELA",
        "Grade 10 ELA year",
        "English I EOC",
        "English I EOC year",
        "English II EOC",
        "English II EOC year",
        "Algebra I EOC",
        "Algebra I EOC year",
        "Geometry EOC",
        "Geometry EOC year",
        "Math",
        "Math year",
        "Math source",
        "TVAAS",
        "TVAAS year",
        "TVAAS source",
        "Letter grade",
        "Letter grade year",
        "Letter grade source",
      ],
      ...matches.map((s: any) => [
        s.id,
        s.name,
        s.type,
        s.grades.display,
        s.address.zip ?? "",
        s.distance?.toFixed(2) ?? "",
        metric(s, "ela_proficiency").value ?? "",
        metric(s, "ela_proficiency").year ?? "",
        sourceRef(metric(s, "ela_proficiency").source_id),
        metric(s, "math_proficiency").value ?? "",
        metric(s, "math_proficiency").year ?? "",
        sourceRef(metric(s, "math_proficiency").source_id),
        metric(s, "ela_grade_9").value ?? "",
        metric(s, "ela_grade_9").year ?? "",
        metric(s, "ela_grade_10").value ?? "",
        metric(s, "ela_grade_10").year ?? "",
        metric(s, "eoc_english_i").value ?? "",
        metric(s, "eoc_english_i").year ?? "",
        metric(s, "eoc_english_ii").value ?? "",
        metric(s, "eoc_english_ii").year ?? "",
        metric(s, "eoc_algebra_i").value ?? "",
        metric(s, "eoc_algebra_i").year ?? "",
        metric(s, "eoc_geometry").value ?? "",
        metric(s, "eoc_geometry").year ?? "",
        metric(s, "tvaas_growth_score").value ?? "",
        metric(s, "tvaas_growth_score").year ?? "",
        sourceRef(metric(s, "tvaas_growth_score").source_id),
        metric(s, "letter_grade").value ?? "",
        metric(s, "letter_grade").year ?? "",
        sourceRef(metric(s, "letter_grade").source_id),
      ]),
    ];
    const csv = rows
      .map((r) =>
        r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(","),
      )
      .join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "nashville-schools.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const markerColor = (s: School) =>
    mapColor === "TVAAS growth"
      ? metric(s, "tvaas_growth_score").value === null
        ? "#9ba39d"
        : ({
            "1": "#b94d4d",
            "2": "#df8550",
            "3": "#d2a83e",
            "4": "#69a77a",
            "5": "#24785d",
          }[String(metric(s, "tvaas_growth_score").value)] ?? "#9ba39d")
      : (gradeColors[String(metric(s, "letter_grade").value)] ?? "#9ba39d");
  return (
    <main className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          id="top"
          href="https://horizonacademies.org/"
          aria-label="Horizon Academies home"
        >
          <img
            className="horizon-logo"
            src={`${import.meta.env.BASE_URL}horizon-logo-horizontal.png`}
            alt="Horizon Academies"
          />
          <span className="brand-divider" aria-hidden="true" />
          <span className="brand-title">Nashville School Explorer</span>
        </a>
        <div className="top-actions">
          <button className="utility-button" onClick={() => setShowSaved(true)}>
            <Bookmark size={16} /> Saved schools <span>{saved.length}</span>
          </button>
          <span className="data-pill">
            <span className={`status-dot ${schools.length ? "ready" : ""}`} />
            {schools.length
              ? `Verified public data · ${schools.length} schools`
              : "Data refresh needed"}
            {manifest?.generated_at && (
              <span className="updated-label">
                Updated {new Date(manifest.generated_at).toLocaleDateString()}
              </span>
            )}
          </span>
          <button
            className="icon-button"
            title="About the data"
            onClick={() => setShowHelp(true)}
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </header>
      <div className="explorer-intro">
        <div>
          <span className="intro-eyebrow">EXPLORE NASHVILLE</span>
          <h1>Find the right school to explore.</h1>
          <p>
            Discover public schools across Davidson County. Search, explore the
            map, and build your shortlist.
          </p>
        </div>
        <button className="utility-button" onClick={() => shareSearch()}>
          <Share2 size={16} /> Share search
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setShowZipSuggestions(false);
          if (origin) {
            setMobilePane("results");
            setMapRequest((value) => value + 1);
            resultsRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          } else document.getElementById("zip-input")?.focus();
        }}
      >
        <section className="search-panel" aria-label="School search">
          <div className="search-primary-row">
            <div className="search-field">
              <label htmlFor="zip-input">
                <MapPin size={16} /> Search near a ZIP code
              </label>
              <div className="zip-entry" ref={zipEntryRef}>
                <div className="input-with-icon">
                  <input
                    id="zip-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    value={zip}
                    onChange={(e) =>
                      setZip(e.target.value.replace(/\D/g, "").slice(0, 5))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setShowZipSuggestions(false);
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        if (!showZipSuggestions) setShowZipSuggestions(true);
                        else
                          zipEntryRef.current
                            ?.querySelector<HTMLButtonElement>(
                              ".zip-suggestions button",
                            )
                            ?.focus();
                      }
                    }}
                    aria-label="Enter a ZIP code"
                    aria-controls="zip-suggestions"
                    aria-expanded={showZipSuggestions}
                    placeholder="5-digit ZIP code"
                  />
                  <button
                    type="button"
                    className="zip-dropdown-toggle"
                    aria-label="Show suggested ZIP codes"
                    aria-haspopup="true"
                    aria-expanded={showZipSuggestions}
                    onClick={() => setShowZipSuggestions((open) => !open)}
                  >
                    <ChevronDown size={17} />
                  </button>
                </div>
                {showZipSuggestions && (
                  <div
                    id="zip-suggestions"
                    className="zip-suggestions"
                    role="group"
                    aria-label="Suggested Nashville ZIP codes"
                    onKeyDown={(event) => {
                      const buttons = Array.from(
                        event.currentTarget.querySelectorAll<HTMLButtonElement>(
                          "button",
                        ),
                      );
                      const index = buttons.indexOf(
                        document.activeElement as HTMLButtonElement,
                      );
                      if (
                        event.key === "ArrowDown" ||
                        event.key === "ArrowUp"
                      ) {
                        event.preventDefault();
                        buttons[
                          (index +
                            (event.key === "ArrowDown" ? 1 : -1) +
                            buttons.length) %
                            buttons.length
                        ]?.focus();
                      }
                      if (event.key === "Escape") {
                        setShowZipSuggestions(false);
                        document.getElementById("zip-input")?.focus();
                      }
                    }}
                  >
                    {Object.entries(zips)
                      .filter(([, place]) => place.suggested)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([code, place]) => (
                        <button
                          type="button"
                          aria-pressed={zip === code}
                          key={code}
                          onClick={() => {
                            setZip(code);
                            setShowZipSuggestions(false);
                            document.getElementById("zip-input")?.focus();
                          }}
                        >
                          <span>{code}</span>
                          <span>{place.name}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
            <div className="radius-field">
              <label htmlFor="radius">
                Search radius <b>{radius} mi</b>
              </label>
              <input
                id="radius"
                type="range"
                min="1"
                max="25"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
              />
              <div className="range-labels">
                <span>1 mi</span>
                <span>25 mi</span>
              </div>
            </div>
            <button className="search-button" type="submit">
              <Search size={17} /> Explore schools
            </button>
          </div>
          <div className="grade-band-control">
            <div className="grade-band-heading">
              <label>Grades served</label>
              <strong>{gradeBandLabel}</strong>
            </div>
            <div className="grade-range-slider">
              <div className="grade-range-track">
                <span
                  style={{
                    left: `${(gradeMin / 12) * 100}%`,
                    right: `${((12 - gradeMax) / 12) * 100}%`,
                  }}
                />
              </div>
              <input
                aria-label="Lowest grade"
                aria-valuetext={gradeName(gradeMin)}
                type="range"
                min="0"
                max="12"
                step="1"
                value={gradeMin}
                onChange={(e) =>
                  setGradeMin(Math.min(Number(e.target.value), gradeMax))
                }
              />
              <input
                aria-label="Highest grade"
                aria-valuetext={gradeName(gradeMax)}
                type="range"
                min="0"
                max="12"
                step="1"
                value={gradeMax}
                onChange={(e) =>
                  setGradeMax(Math.max(Number(e.target.value), gradeMin))
                }
              />
            </div>
            <div className="grade-range-ticks">
              <span>Kindergarten</span>
              <span>Grade 12</span>
            </div>
          </div>
          <div
            className="school-level-filter"
            role="group"
            aria-label="Filter by school level"
          >
            <span className="school-level-label">School level</span>
            <div className="school-level-options">
              <button
                type="button"
                className={`school-level-chip ${schoolLevels.length === 0 ? "selected" : ""}`}
                aria-pressed={schoolLevels.length === 0}
                onClick={() => setSchoolLevels([])}
              >
                All levels
              </button>
              {(
                [
                  { value: "Elementary", label: "Elementary" },
                  { value: "Middle", label: "Middle" },
                  { value: "High", label: "High" },
                  { value: "Grade span unavailable", label: "Unknown span" },
                ] as const
              ).map(({ value, label }) => (
                <button
                  type="button"
                  key={value}
                  className={`school-level-chip ${schoolLevels.includes(value) ? "selected" : ""}`}
                  aria-pressed={schoolLevels.includes(value)}
                  onClick={() =>
                    setSchoolLevels((old) =>
                      old.includes(value)
                        ? old.filter((x) => x !== value)
                        : [...old, value],
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="school-level-hint">
              Elementary: Pre-K–5 · Middle: 6–8 · High: 9–12. Combined spans can
              appear in multiple levels.
            </span>
          </div>
          <div className="search-extra-filters">
            <label className="filter-search">
              <Search size={15} />
              <input
                placeholder="Search school name"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search school name"
              />
            </label>
            <select
              aria-label="School letter grade"
              value={letterFilter}
              onChange={(e) => setLetterFilter(e.target.value)}
            >
              <option value="Any letter grade">Any letter grade</option>
              {["A", "B", "C", "D", "F"].map((x) => (
                <option key={x} value={x}>
                  Letter grade {x}
                </option>
              ))}
            </select>
            <select
              aria-label="Sort by"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              {[
                "Distance",
                "School name",
                "ELA proficiency",
                "Math proficiency",
                "TVAAS growth",
                "Letter grade",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <button
              type="button"
              className="text-button reset-filters"
              onClick={resetFilters}
            >
              Reset filters <X size={14} />
            </button>
          </div>
          {(query ||
            gradeMin > 0 ||
            gradeMax < 12 ||
            schoolLevels.length > 0 ||
            letterFilter !== "Any letter grade") && (
            <div className="active-filters" aria-label="Active filters">
              {query && (
                <button type="button" onClick={() => setQuery("")}>
                  Name: {query}
                  <X size={13} />
                </button>
              )}
              {(gradeMin > 0 || gradeMax < 12) && (
                <button
                  type="button"
                  onClick={() => {
                    setGradeMin(0);
                    setGradeMax(12);
                  }}
                >
                  Grades: {gradeBandLabel}
                  <X size={13} />
                </button>
              )}
              {schoolLevels.map((level) => (
                <button
                  type="button"
                  key={level}
                  onClick={() =>
                    setSchoolLevels(
                      schoolLevels.filter((value) => value !== level),
                    )
                  }
                >
                  {level}
                  <X size={13} />
                </button>
              ))}
              {letterFilter !== "Any letter grade" && (
                <button
                  type="button"
                  onClick={() => setLetterFilter("Any letter grade")}
                >
                  Letter grade: {letterFilter}
                  <X size={13} />
                </button>
              )}
            </div>
          )}
          <div className="search-caption">
            <span>
              {origin
                ? `${zip} · ${origin.name}`
                : "Choose a supported ZIP code"}
            </span>
            <span>Results update as you adjust filters.</span>
          </div>
        </section>
      </form>
      <div className="workspace">
        <div className="mobile-tabs">
          <button
            className={mobilePane === "results" ? "active" : ""}
            onClick={() => setMobilePane("results")}
          >
            List
          </button>
          <button
            className={mobilePane === "map" ? "active" : ""}
            onClick={() => setMobilePane("map")}
          >
            Map
          </button>
        </div>
        <div className="explorer-grid">
          <aside
            ref={resultsRef}
            className={`results-column ${mobilePane === "map" ? "mobile-hidden" : ""}`}
          >
            <div className="results-toolbar">
              <div className="result-count" role="status" aria-live="polite">
                <strong>{origin ? matches.length : 0}</strong>
                <span>schools within {radius} miles</span>
              </div>
              <button
                className="subtle-icon"
                onClick={exportCsv}
                title="Download current results as CSV"
              >
                <Download size={16} />
              </button>
            </div>
            {!loaded ? (
              <div className="empty-state">
                <div className="loader" />
                <b>Loading school data</b>
                <span>Getting verified school and ZIP data…</span>
              </div>
            ) : loadError ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <Info size={20} />
                </div>
                <b>School data could not be loaded</b>
                <span>{loadError}</span>
                <button
                  className="utility-button"
                  onClick={() => window.location.reload()}
                >
                  Try again
                </button>
              </div>
            ) : !origin ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <MapPin size={20} />
                </div>
                <b>
                  {zip.length === 5
                    ? "No Census ZCTA found for this code"
                    : "Enter a 5-digit ZIP code"}
                </b>
                <span>
                  Choose one of the 24 suggestions or enter a Tennessee 37xxx
                  ZIP code with a Census ZCTA.
                </span>
              </div>
            ) : matches.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <BookOpen size={20} />
                </div>
                <b>
                  {schools.length
                    ? "No schools match this search"
                    : "School data is not published yet"}
                </b>
                <span>
                  {schools.length
                    ? "Try a wider radius or remove a filter."
                    : "Refresh verified source data with the documented pipeline. No sample school results are shown."}
                </span>
                {schools.length > 0 && (
                  <div className="empty-actions">
                    <button
                      className="utility-button"
                      disabled={radius === 25}
                      onClick={() =>
                        setRadius((value) => Math.min(25, value + 5))
                      }
                    >
                      Increase radius
                    </button>
                    <button className="utility-button" onClick={resetFilters}>
                      Clear filters
                    </button>
                  </div>
                )}
                {!schools.length && (
                  <a href={`${import.meta.env.BASE_URL}methodology.html`}>
                    Data and methodology <ArrowUpRight size={13} />
                  </a>
                )}
              </div>
            ) : (
              <div className="school-list">
                {matches.map((s: any) => {
                  const letter = metric(s, "letter_grade").value;
                  return (
                    <article
                      key={s.id}
                      data-school-id={s.id}
                      className={`school-card ${activeMarker === s.id ? "focused" : ""}`}
                      onMouseEnter={() => setActiveMarker(s.id)}
                      onClick={() => openSchool(s)}
                      tabIndex={0}
                      onFocus={() => setActiveMarker(s.id)}
                      onKeyDown={(e) => {
                        if (
                          e.target === e.currentTarget &&
                          (e.key === "Enter" || e.key === " ")
                        ) {
                          e.preventDefault();
                          openSchool(s);
                        }
                      }}
                    >
                      <div className="card-top">
                        <div>
                          <span className="school-type">{s.type}</span>
                          <h3>{s.name}</h3>
                        </div>
                        <div className="card-actions">
                          <button
                            className={`save-school ${saved.includes(s.id) ? "is-saved" : ""}`}
                            aria-label={`${saved.includes(s.id) ? "Unsave" : "Save"} ${s.name}`}
                            aria-pressed={saved.includes(s.id)}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleSaved(s.id);
                            }}
                          >
                            <Bookmark size={16} />
                          </button>
                          <button
                            className={`compare-check ${compare.includes(s.id) ? "checked" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleCompare(s.id);
                            }}
                            aria-pressed={compare.includes(s.id)}
                            aria-label={`${compare.includes(s.id) ? "Remove" : "Add"} ${s.name} ${compare.includes(s.id) ? "from" : "to"} comparison`}
                          >
                            {compare.includes(s.id) ? (
                              <Check size={15} />
                            ) : (
                              <Plus size={16} />
                            )}
                          </button>
                        </div>
                      </div>
                      <div className="school-meta">
                        <span>
                          <GraduationCap size={14} />
                          {s.grades.display || "Grades unavailable"}
                        </span>
                        <span>
                          <MapPin size={13} />
                          {s.distance?.toFixed(1)} mi
                        </span>
                      </div>
                      <div className="metrics-row">
                        <div className="grade-box">
                          <span>GRADE</span>
                          <b
                            style={{
                              color: gradeColors[String(letter)] ?? "#8c948f",
                            }}
                          >
                            {letter ?? "—"}
                          </b>
                        </div>
                        <div className="metric-box">
                          <div>
                            <span title="Percentage meeting or exceeding the state standard">
                              ELA proficiency
                            </span>
                            <b
                              title={
                                metric(s, "ela_proficiency").year ??
                                "Reporting year unavailable"
                              }
                            >
                              {displayMetric(metric(s, "ela_proficiency"), "%")}
                            </b>
                          </div>
                          <div className="mini-track">
                            <i
                              style={{
                                width: `${metric(s, "ela_proficiency").value ?? 0}%`,
                              }}
                            />
                          </div>
                        </div>
                        <div className="metric-box">
                          <div>
                            <span title="Percentage meeting or exceeding the state standard">
                              Math proficiency
                            </span>
                            <b
                              title={
                                metric(s, "math_proficiency").year ??
                                "Reporting year unavailable"
                              }
                            >
                              {displayMetric(
                                metric(s, "math_proficiency"),
                                "%",
                              )}
                            </b>
                          </div>
                          <div className="mini-track">
                            <i
                              style={{
                                width: `${metric(s, "math_proficiency").value ?? 0}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                      {eocMeasures.some(
                        ([, key]) => metric(s, key).status !== "unavailable",
                      ) && (
                        <div className="eoc-card-metrics">
                          {eocMeasures
                            .filter(
                              ([, key]) =>
                                metric(s, key).status !== "unavailable",
                            )
                            .map(([label, key]) => (
                              <span key={key}>
                                <i>{label}</i>
                                <b>{displayMetric(metric(s, key), "%")}</b>
                              </span>
                            ))}
                        </div>
                      )}
                      <div className="card-footer">
                        <span>{yearLabel(s)}</span>
                        <div className="card-footer-actions">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              locateSchool(s);
                            }}
                          >
                            Show on map <MapPin size={13} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openSchool(s);
                            }}
                          >
                            View profile <ArrowUpRight size={13} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            <div className="list-bottom">
              <span>
                School, achievement, and growth data represent different
                measures.
              </span>
              <a href={`${import.meta.env.BASE_URL}methodology.html`}>
                How to read this data <ArrowUpRight size={12} />
              </a>
            </div>
          </aside>
          <section
            ref={mapSectionRef}
            className={`map-column ${mobilePane === "results" ? "mobile-hidden" : ""} ${mapFullscreen ? "is-expanded" : ""}`}
            aria-label="Map of nearby schools"
          >
            <div className="map-topline">
              <span>
                <span className="map-live-dot" />
                {origin
                  ? `Showing ${matches.length} mapped ${matches.length === 1 ? "school" : "schools"}`
                  : "Nashville area map"}
              </span>
              <label className="map-color-label">
                Color by{" "}
                <select
                  aria-label="Map marker color"
                  value={mapColor}
                  onChange={(e) => setMapColor(e.target.value)}
                >
                  <option>School letter grade</option>
                  <option>TVAAS growth</option>
                </select>
              </label>
              <button
                className="map-control"
                title="Center map on search area"
                onClick={() => {
                  setMobilePane("map");
                  setMapRequest((value) => value + 1);
                  setMapSchool(null);
                }}
              >
                <LocateFixed size={15} />
              </button>
              <button
                className="map-control"
                title={
                  mapFullscreen
                    ? "Exit full-screen map"
                    : "Open full-screen map"
                }
                aria-label={
                  mapFullscreen
                    ? "Exit full-screen map"
                    : "Open full-screen map"
                }
                onClick={toggleMapFullscreen}
              >
                {mapFullscreen ? <Minimize2 size={16} /> : <Expand size={16} />}
              </button>
            </div>
            <MapContainer
              center={center}
              zoom={origin ? 11 : 10}
              scrollWheelZoom
              className="leaflet-map"
              zoomControl={false}
            >
              <MapViewport
                center={center}
                radius={radius}
                request={mapRequest}
                expanded={mapFullscreen}
                school={mapSchool}
              />
              <ZoomControl position="bottomright" />
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {origin && (
                <>
                  <Circle
                    center={center}
                    radius={radius * 1609.344}
                    pathOptions={{
                      color: "#548d70",
                      weight: 1.5,
                      fillColor: "#8eb99d",
                      fillOpacity: 0.1,
                      dashArray: "6 6",
                    }}
                  />
                  <Marker
                    position={center}
                    title={`${zip} ZIP center`}
                    alt={`${zip} ZIP center`}
                    icon={L.divIcon({
                      className: "origin-icon",
                      html: "<span></span>",
                      iconSize: [18, 18],
                      iconAnchor: [9, 9],
                    })}
                  >
                    <Popup>
                      <b>{origin.name} ZIP center</b>
                      <br />
                      {zip} · Census ZCTA
                    </Popup>
                  </Marker>
                </>
              )}
              {campusGroups.map((group) => {
                const s = group[0];
                const active = group.some(
                  (school) => school.id === activeMarker,
                );
                return (
                  <Marker
                    key={group.map((school) => school.id).join(":")}
                    ref={(marker) => {
                      marker
                        ?.getElement()
                        ?.setAttribute(
                          "aria-label",
                          group.map((school) => school.name).join(" / "),
                        );
                    }}
                    position={[s.location.lat!, s.location.lon!]}
                    title={group.map((school) => school.name).join(" / ")}
                    alt={group.map((school) => school.name).join(" / ")}
                    icon={markerIcon(markerColor(s), active, group.length)}
                    eventHandlers={{
                      add: (event) => {
                        event.target
                          .getElement()
                          ?.setAttribute(
                            "aria-label",
                            group.map((school) => school.name).join(" / "),
                          );
                      },
                      click: () => {
                        setActiveMarker(s.id);
                        if (group.length === 1) {
                          openSchool(s);
                          document
                            .querySelector<HTMLElement>(
                              `[data-school-id="${s.id}"]`,
                            )
                            ?.scrollIntoView({ block: "nearest" });
                        }
                      },
                      mouseover: () => setActiveMarker(s.id),
                    }}
                  >
                    {group.length > 1 && (
                      <Popup>
                        <div className="campus-picker">
                          <strong>
                            {group.length} schools at this location
                          </strong>
                          {group.map((school) => (
                            <button
                              key={school.id}
                              onClick={() => {
                                openSchool(school);
                                document
                                  .querySelector<HTMLElement>(
                                    `[data-school-id="${school.id}"]`,
                                  )
                                  ?.scrollIntoView({ block: "nearest" });
                              }}
                            >
                              {school.name}
                              <ArrowUpRight size={14} />
                            </button>
                          ))}
                        </div>
                      </Popup>
                    )}
                    {mapFullscreen && (
                      <Tooltip
                        permanent
                        direction="right"
                        offset={[9, 0]}
                        opacity={0.98}
                        className="school-name-tooltip"
                      >
                        {group.length > 1
                          ? `${group.length} schools · select to view`
                          : s.name}
                      </Tooltip>
                    )}
                  </Marker>
                );
              })}
            </MapContainer>
            <div className="map-legend">
              <span>
                <i className="legend-dot" />
                School location
              </span>
              <span>
                <i className="legend-ring" />
                Search radius
              </span>
              <span className="map-key">{mapColor}</span>
              <button
                onClick={() => setShowCompare(true)}
                disabled={!compare.length}
              >
                <Plus size={14} />
                Compare {compare.length > 0 && `(${compare.length})`}
              </button>
            </div>
          </section>
        </div>
        <section className="coverage-strip">
          <div className="coverage-icon">
            <Info size={17} />
          </div>
          <div>
            <b>
              {schools.length
                ? `Data coverage · ${schools.length} Davidson County campuses`
                : "Data coverage will appear here after a successful refresh"}
            </b>
            <span>
              ELA{" "}
              {
                schools.filter(
                  (s) => metric(s, "ela_proficiency").status === "reported",
                ).length
              }
              /{schools.length} · Math{" "}
              {
                schools.filter(
                  (s) => metric(s, "math_proficiency").status === "reported",
                ).length
              }
              /{schools.length} · TVAAS{" "}
              {
                schools.filter(
                  (s) => metric(s, "tvaas_growth_score").status === "reported",
                ).length
              }
              /{schools.length} · Letter grade{" "}
              {
                schools.filter(
                  (s) => metric(s, "letter_grade").status === "reported",
                ).length
              }
              /{schools.length}. Suppressed and unreported values stay
              unavailable.
            </span>
          </div>
          <a href={`${import.meta.env.BASE_URL}methodology.html`}>
            Data sources &amp; methodology <ArrowUpRight size={14} />
          </a>
        </section>
      </div>
      <footer className="footer">
        <div className="footer-brand">
          <span className="brand-mark small-mark">
            <GraduationCap size={15} />
          </span>
          Nashville School Explorer
        </div>
        <span>
          Informational tool only. Does not determine school assignment or
          guarantee enrollment.
        </span>
        <span>
          Sources: Tennessee Department of Education · NCES · U.S. Census Bureau
        </span>
        <a
          className="footer-method"
          href={`${import.meta.env.BASE_URL}methodology.html`}
        >
          Data methodology
        </a>
      </footer>
      {selected && (
        <Dialog
          className="profile-modal"
          labelledBy="profile-name"
          onClose={() => setSelected(null)}
        >
          <button
            className="modal-close"
            onClick={() => setSelected(null)}
            aria-label="Close profile"
          >
            <X size={19} />
          </button>
          <div className="modal-eyebrow">SCHOOL PROFILE · {selected.type}</div>
          <h2 id="profile-name">{selected.name}</h2>
          <p className="profile-address">
            {[
              selected.address.street,
              selected.address.city,
              selected.address.state,
              selected.address.zip,
            ]
              .filter(Boolean)
              .join(", ") || "Address unavailable"}{" "}
            · {Number((selected as any).distance ?? 0).toFixed(1)} miles from{" "}
            {zip}
          </p>
          <div className="profile-facts">
            <div>
              <span>Grades served</span>
              <b>{selected.grades.display || "Unavailable"}</b>
            </div>
            <div>
              <span>Enrollment</span>
              <b>{displayMetric(metric(selected, "enrollment"))}</b>
            </div>
            <div>
              <span>State school ID</span>
              <b>{selected.state_school_id || "Unavailable"}</b>
            </div>
          </div>
          <h3>Academic performance</h3>
          <p className="profile-note">
            Achievement, growth, and accountability are different measures.
            Reporting years can vary by metric.
          </p>
          <div className="profile-metrics">
            {[
              ["ELA proficiency", "ela_proficiency", "%"],
              ["Math proficiency", "math_proficiency", "%"],
              ["TVAAS composite", "tvaas_growth_score", ""],
              ["Official school letter grade", "letter_grade", ""],
              ["Graduation rate", "graduation_rate", "%"],
            ].map(([label, key, suffix]) => {
              const m = metric(
                selected,
                key as keyof School["academic_metrics"],
              );
              const src = manifest?.sources?.find(
                (x: any) => x.id === m.source_id,
              );
              return (
                <div key={key}>
                  <span>{label}</span>
                  <b>
                    {displayMetric(m, suffix)}
                    {m.year && <small>Reporting year {m.year}</small>}
                    {src && (
                      <a
                        className="metric-source"
                        href={src.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {src.name} <ArrowUpRight size={10} />
                      </a>
                    )}
                  </b>
                </div>
              );
            })}
          </div>
          {eocMeasures.some(
            ([, key]) => metric(selected, key).status !== "unavailable",
          ) && (
            <div className="course-metrics">
              {eocMeasures.map(([label, key]) => {
                const m = metric(selected, key);
                return (
                  <div key={key}>
                    <span>{label}</span>
                    <b>
                      {displayMetric(m, "%")}
                      {m.year && <small>Reporting year {m.year}</small>}
                    </b>
                  </div>
                );
              })}
            </div>
          )}
          <div className="source-note">
            <Info size={15} />
            <span>
              TVAAS is a growth measure (1–5), not a proficiency percentage. The
              school letter grade is the state's accountability measure.
            </span>
          </div>
          <button
            className="primary-action"
            onClick={() => toggleCompare(selected.id)}
          >
            {compare.includes(selected.id) ? (
              <>
                <Check size={16} /> Added to comparison
              </>
            ) : (
              <>
                <Plus size={16} /> Add to comparison
              </>
            )}
          </button>
          <div className="profile-secondary-actions">
            <button
              className="utility-button"
              onClick={() => toggleSaved(selected.id)}
            >
              <Bookmark size={16} />
              {saved.includes(selected.id)
                ? "Saved to shortlist"
                : "Save school"}
            </button>
            <button
              className="utility-button"
              onClick={() => shareSearch(selected.id)}
            >
              <Share2 size={16} />
              Share school
            </button>
          </div>
        </Dialog>
      )}
      {showCompare && (
        <Dialog
          className={`compare-modal compare-count-${compare.length}`}
          labelledBy="compare-title"
          onClose={() => setShowCompare(false)}
        >
          <button
            className="modal-close"
            onClick={() => setShowCompare(false)}
            aria-label="Close comparison"
          >
            <X size={19} />
          </button>
          <div className="modal-eyebrow">SIDE BY SIDE</div>
          <h2 id="compare-title">Compare schools</h2>
          <p className="profile-note">
            Each metric keeps its published year. No overall ranking is
            calculated.
          </p>
          <div
            className="compare-grid"
            style={{
              gridTemplateColumns: `140px repeat(${Math.max(compare.length, 1)},minmax(150px,1fr))`,
            }}
          >
            <div className="compare-labels">
              <b>School</b>
              <span>Type</span>
              <span>Grades</span>
              <span>Distance</span>
              <span>ELA proficiency</span>
              <span>Math proficiency</span>
              <span>TVAAS</span>
              <span>Letter grade</span>
            </div>
            {compare.map((id) => {
              const s = schools.find((x) => x.id === id);
              if (!s) return null;
              return (
                <div className="compare-school" key={id}>
                  <button
                    className="remove-compare"
                    onClick={() => toggleCompare(id)}
                    aria-label={`Remove ${s.name}`}
                  >
                    <X size={13} />
                  </button>
                  <b>{s.name}</b>
                  <span>{s.type}</span>
                  <span>{s.grades.display}</span>
                  <span>{(s as any).distance?.toFixed(1) ?? "—"} mi</span>
                  <span>
                    {displayMetric(metric(s, "ela_proficiency"), "%")}
                  </span>
                  <span>
                    {displayMetric(metric(s, "math_proficiency"), "%")}
                  </span>
                  <span>{displayMetric(metric(s, "tvaas_growth_score"))}</span>
                  <span>{displayMetric(metric(s, "letter_grade"))}</span>
                </div>
              );
            })}
            {compare.length === 0 && (
              <p>Select schools using the plus on each result card.</p>
            )}
          </div>
          <button
            className="primary-action"
            onClick={() => setShowCompare(false)}
          >
            Done
          </button>
        </Dialog>
      )}
      {compare.length > 0 && (
        <section
          className="comparison-tray"
          aria-label="Selected comparison schools"
        >
          <div className="tray-heading">
            <strong>Compare schools</strong>
            <span>{compare.length} of 3 selected</span>
          </div>
          <div className="tray-schools">
            {compare.map((id) => (
              <span key={id}>
                {schools.find((school) => school.id === id)?.name}
                <button
                  aria-label={`Remove ${schools.find((school) => school.id === id)?.name} from comparison`}
                  onClick={() => toggleCompare(id)}
                >
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
          <button
            className="search-button"
            onClick={() => setShowCompare(true)}
          >
            Compare selected <ArrowUpRight size={16} />
          </button>
          <button className="text-button" onClick={() => setCompare([])}>
            Clear
          </button>
        </section>
      )}
      {showHelp && (
        <Dialog
          className="help-modal"
          labelledBy="help-title"
          onClose={() => setShowHelp(false)}
        >
          <button
            className="modal-close"
            aria-label="Close help"
            onClick={() => setShowHelp(false)}
          >
            <X size={19} />
          </button>
          <div className="modal-eyebrow">QUICK GUIDE</div>
          <h2 id="help-title">Explore with confidence.</h2>
          <p>
            Find public schools in Davidson County near your selected ZIP code.
          </p>
          <ol>
            <li>
              <strong>Start nearby.</strong> Choose a ZIP and adjust your search
              radius. Results update automatically; Explore schools brings you
              to the results.
            </li>
            <li>
              <strong>Narrow your options.</strong> Filter by grades served,
              school level, or name.
            </li>
            <li>
              <strong>Explore the map.</strong> Zoom, recenter, or select a
              school. Shared locations open a list of schools.
            </li>
            <li>
              <strong>Build your shortlist.</strong> Save schools on this
              browser, or compare up to three side by side.
            </li>
          </ol>
          <p>
            Use Share search or Share school to copy a link to your current
            view.
          </p>
          <a href={`${import.meta.env.BASE_URL}methodology.html`}>
            Data sources &amp; methodology <ArrowUpRight size={14} />
          </a>
        </Dialog>
      )}
      {showSaved && (
        <Dialog
          className="saved-modal"
          labelledBy="saved-title"
          onClose={() => setShowSaved(false)}
        >
          <button
            className="modal-close"
            aria-label="Close saved schools"
            onClick={() => setShowSaved(false)}
          >
            <X size={19} />
          </button>
          <div className="modal-eyebrow">YOUR SHORTLIST</div>
          <h2 id="saved-title">Saved schools</h2>
          <p>Saved on this browser. No account needed.</p>
          {saved.length === 0 ? (
            <div className="saved-empty">
              <Bookmark size={28} />
              <p>Save a school using the bookmark on its card.</p>
            </div>
          ) : (
            saved.map((id) => {
              const school = schools.find((item) => item.id === id);
              return (
                <div className="saved-row" key={id}>
                  <strong>
                    {school?.name ??
                      (loaded
                        ? "School no longer in this directory"
                        : "Loading school…")}
                  </strong>
                  <div>
                    {school && (
                      <>
                        <button
                          className="utility-button"
                          onClick={() => {
                            setShowSaved(false);
                            openSchool({
                              ...school,
                              distance:
                                origin &&
                                school.location.lat !== null &&
                                school.location.lon !== null
                                  ? haversineMiles(origin, {
                                      lat: school.location.lat,
                                      lon: school.location.lon,
                                    })
                                  : null,
                            });
                          }}
                        >
                          View profile
                        </button>
                        <button
                          className="utility-button"
                          onClick={() => toggleCompare(id)}
                        >
                          {compare.includes(id)
                            ? "Remove from comparison"
                            : "Compare"}
                        </button>
                      </>
                    )}
                    <button
                      className="save-school is-saved"
                      aria-label={`Unsave ${school?.name ?? "school"}`}
                      onClick={() => toggleSaved(id)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </Dialog>
      )}
      {shareUrl && (
        <Dialog
          className="help-modal"
          labelledBy="share-title"
          onClose={() => setShareUrl("")}
        >
          <button
            className="modal-close"
            aria-label="Close share link"
            onClick={() => setShareUrl("")}
          >
            <X size={19} />
          </button>
          <h2 id="share-title">Share this search</h2>
          <p>Copy this link to share your current view.</p>
          <input
            className="share-link"
            aria-label="Share link"
            readOnly
            value={shareUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
        </Dialog>
      )}
      <div
        className={`app-notice ${notice ? "visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        {notice}
      </div>
    </main>
  );
}
export default App;
