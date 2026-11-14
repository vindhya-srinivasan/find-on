// Person 4: pure location helpers, safe in browser and server. Contract: Team Tasks > Location functions.
import type { Building } from '@/types';

type LatLng = { lat: number; lng: number };

/** Great-circle distance in meters (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Closest building to a point. Callers treat distanceM > 300 as "off campus?". */
export function nearestBuilding(lat: number, lng: number, buildings: Building[]): { building: Building; distanceM: number } {
  if (buildings.length === 0) throw new Error('nearestBuilding: building list is empty');
  let best = buildings[0];
  let bestD = distanceMeters({ lat, lng }, best);
  for (const b of buildings) {
    const d = distanceMeters({ lat, lng }, b);
    if (d < bestD) { best = b; bestD = d; }
  }
  return { building: best, distanceM: bestD };
}

/** Buildings within `meters` of the given building, including itself. */
export function buildingsWithin(buildingId: string, meters: number, buildings: Building[]): Building[] {
  const origin = buildings.find((b) => b.id === buildingId);
  if (!origin) return [];
  return buildings.filter((b) => distanceMeters(origin, b) <= meters);
}
