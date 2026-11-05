export const SHORTLIST_KEY = "nashville-school-explorer:shortlist";
export function readShortlist(): string[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(SHORTLIST_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === "string"))]
      : [];
  } catch {
    return [];
  }
}
export function readSearch() {
  const params = new URLSearchParams(window.location.search);
  const number = (key: string, fallback: number, min: number, max: number) => {
    const raw = params.get(key),
      value = Number(raw);
    return raw !== null &&
      Number.isInteger(value) &&
      value >= min &&
      value <= max
      ? value
      : fallback;
  };
  const min = number("min", 0, 0, 12),
    max = number("max", 12, 0, 12);
  const sort = params.get("sort") ?? "Distance";
  const letter = params.get("letter") ?? "Any letter grade";
  return {
    zip: /^\d{5}$/.test(params.get("zip") ?? "") ? params.get("zip")! : "37206",
    radius: number("radius", 2, 1, 25),
    query: (params.get("q") ?? "").slice(0, 200),
    gradeMin: Math.min(min, max),
    gradeMax: Math.max(min, max),
    levels: (params.get("levels") ?? "")
      .split(",")
      .filter((level) =>
        ["Elementary", "Middle", "High", "Grade span unavailable"].includes(
          level,
        ),
      ),
    sort: [
      "Distance",
      "School name",
      "ELA proficiency",
      "Math proficiency",
      "TVAAS growth",
      "Letter grade",
    ].includes(sort)
      ? sort
      : "Distance",
    letter: ["A", "B", "C", "D", "F"].includes(letter)
      ? letter
      : "Any letter grade",
    school: params.get("school"),
  };
}
