// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const { map } = vi.hoisted(() => ({
  map: {
    invalidateSize: vi.fn(),
    fitBounds: vi.fn(),
    setView: vi.fn(),
    getZoom: vi.fn(() => 11),
  },
}));
vi.mock("react-leaflet", () => ({ useMap: () => map }));
import { MapViewport } from "./MapViewport";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("refits the search area on radius changes and recenter requests", () => {
  const view = render(
    <MapViewport
      center={[36.18, -86.73]}
      radius={2}
      request={0}
      expanded={false}
      school={null}
    />,
  );
  const initialBounds = map.fitBounds.mock.calls[0][0];
  view.rerender(
    <MapViewport
      center={[36.18, -86.73]}
      radius={10}
      request={0}
      expanded={false}
      school={null}
    />,
  );
  const widerBounds = map.fitBounds.mock.calls[1][0];
  expect(widerBounds.getNorth() - widerBounds.getSouth()).toBeGreaterThan(
    initialBounds.getNorth() - initialBounds.getSouth(),
  );
  view.rerender(
    <MapViewport
      center={[36.18, -86.73]}
      radius={10}
      request={1}
      expanded={false}
      school={null}
    />,
  );
  expect(map.fitBounds).toHaveBeenCalledTimes(3);
});
it("focuses a selected campus and resizes the expanded map", () => {
  const school = { lat: 36.17, lon: -86.7, request: 1 };
  const view = render(
    <MapViewport
      center={[36.18, -86.73]}
      radius={2}
      request={0}
      expanded={false}
      school={school}
    />,
  );
  expect(map.setView).toHaveBeenCalledWith([36.17, -86.7], 14, {
    animate: false,
  });
  view.rerender(
    <MapViewport
      center={[36.18, -86.73]}
      radius={2}
      request={0}
      expanded={true}
      school={school}
    />,
  );
  expect(map.invalidateSize).toHaveBeenCalledTimes(2);
});
