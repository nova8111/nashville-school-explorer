// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent } from "@testing-library/react";
import App from "./App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
});
function mockRealData() {
  const schools = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "public/data/nashville_schools.json"),
      "utf8",
    ),
  );
  const zips = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "public/data/nashville_zipcodes.json"),
      "utf8",
    ),
  );
  const manifest = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "public/data/source_manifest.json"),
      "utf8",
    ),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("zipcodes")
          ? zips
          : url.includes("manifest")
            ? manifest
            : schools,
    })),
  );
}
describe("Nashville Explorer", () => {
  it("renders a clear empty-data state without inventing results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes("zipcodes")
            ? {
                "37206": {
                  lat: 36.179319,
                  lon: -86.731083,
                  name: "East Nashville",
                  coordinate_source: "US Census 2024 ZCTA Gazetteer",
                },
              }
            : url.includes("manifest")
              ? {}
              : [],
      })),
    );
    render(<App />);
    expect(
      screen.getByRole("heading", { name: /find the right school/i }),
    ).toBeTruthy();
    expect(
      await screen.findByText(/school data is not published yet/i),
    ).toBeTruthy();
    expect(screen.getByLabelText(/search radius/i)).toBeTruthy();
  });
  it("loads a real campus record and filters it by school name", async () => {
    const schools = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "public/data/nashville_schools.json"),
        "utf8",
      ),
    );
    const zips = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "public/data/nashville_zipcodes.json"),
        "utf8",
      ),
    );
    const manifest = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "public/data/source_manifest.json"),
        "utf8",
      ),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes("zipcodes")
            ? zips
            : url.includes("manifest")
              ? manifest
              : schools,
      })),
    );
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "Hattie Cotton Elementary" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search school name"), {
      target: { value: "Hattie Cotton" },
    });
    expect(
      screen.getByRole("heading", { name: "Hattie Cotton Elementary" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search school name"), {
      target: { value: "No Such School" },
    });
    expect(
      await screen.findByText(/no schools match this search/i),
    ).toBeTruthy();
  });
  it("adds comparison schools with the keyboard without opening a profile, and explains the limit", async () => {
    mockRealData();
    render(<App />);
    const add = await screen.findByRole("button", {
      name: "Add Lockeland Elementary to comparison",
    });
    fireEvent.keyDown(add, { key: "Enter" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(add);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Nashville Classical East to comparison",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Cora Howe School to comparison",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Rosebank Elementary to comparison",
      }),
    );
    expect(screen.getByText(/You can compare up to 3 schools/)).toBeTruthy();
    expect(
      within(
        screen.getByRole("region", { name: "Selected comparison schools" }),
      ).getByText("3 of 3 selected"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Compare selected" }));
    expect(
      screen.getByRole("dialog", { name: "Compare schools" }),
    ).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("persists saved schools and restores the shortlist after remounting", async () => {
    mockRealData();
    const view = render(<App />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Save Lockeland Elementary",
      }),
    );
    view.unmount();
    render(<App />);
    await screen.findByRole("heading", { name: "Lockeland Elementary" });
    expect(
      screen
        .getByRole("button", { name: "Unsave Lockeland Elementary" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Saved schools 1" }));
    expect(
      within(screen.getByRole("dialog", { name: "Saved schools" })).getByText(
        "Lockeland Elementary",
      ),
    ).toBeTruthy();
  });
  it("opens help, closes it with Escape, and returns focus to its trigger", () => {
    mockRealData();
    render(<App />);
    const help = screen.getByRole("button", { name: "About the data" });
    help.focus();
    fireEvent.click(help);
    expect(
      screen.getByRole("dialog", { name: "Explore with confidence." }),
    ).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(help);
  });
  it("restores a shared search and school profile from the URL", async () => {
    window.history.replaceState(
      {},
      "",
      "/?zip=37206&radius=5&q=Lockeland&school=TN-190-0435",
    );
    mockRealData();
    render(<App />);
    expect(
      (
        screen.getByRole("textbox", {
          name: "Search school name",
        }) as HTMLInputElement
      ).value,
    ).toBe("Lockeland");
    expect(
      await screen.findByRole("dialog", { name: "Lockeland Elementary" }),
    ).toBeTruthy();
  });
  it("copies a share link that retains the current search", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mockRealData();
    render(<App />);
    await screen.findByRole("heading", { name: "Lockeland Elementary" });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search school name" }),
      { target: { value: "Lockeland" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Share search" }));
    expect(writeText).toHaveBeenCalledOnce();
    const url = new URL(writeText.mock.calls[0][0]);
    expect(url.searchParams.get("q")).toBe("Lockeland");
    expect(url.searchParams.get("zip")).toBe("37206");
  });
});
