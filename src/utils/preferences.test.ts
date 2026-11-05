// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readSearch, readShortlist, SHORTLIST_KEY } from "./preferences";
afterEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});
describe("search and shortlist preferences", () => {
  it("rejects unsupported query parameters and normalizes grade bounds", () => {
    window.history.replaceState(
      {},
      "",
      "/?zip=bad&radius=999&min=9&max=2&sort=unknown&letter=Z&levels=High,invalid",
    );
    expect(readSearch()).toMatchObject({
      zip: "37206",
      radius: 2,
      gradeMin: 2,
      gradeMax: 9,
      sort: "Distance",
      letter: "Any letter grade",
      levels: ["High"],
    });
  });
  it("recovers from malformed browser storage and deduplicates IDs", () => {
    localStorage.setItem(SHORTLIST_KEY, "broken");
    expect(readShortlist()).toEqual([]);
    localStorage.setItem(
      SHORTLIST_KEY,
      JSON.stringify(["one", "one", 4, "two"]),
    );
    expect(readShortlist()).toEqual(["one", "two"]);
  });
});
