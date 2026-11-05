import { useEffect } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";

export function MapViewport({
  center,
  radius,
  request,
  expanded,
  school,
}: {
  center: [number, number];
  radius: number;
  request: number;
  expanded: boolean;
  school: { lat: number; lon: number; request: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const bounds = L.latLng(center[0], center[1]).toBounds(
      radius * 2 * 1609.344,
    );
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14, animate: false });
  }, [map, center[0], center[1], radius, request, expanded]);
  useEffect(() => {
    if (school)
      map.setView([school.lat, school.lon], Math.max(map.getZoom(), 14), {
        animate: false,
      });
  }, [map, school]);
  return null;
}
