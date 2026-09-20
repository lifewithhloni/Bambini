/**
 * search_nearby_products() already rounds distance_km to 1 decimal place
 * in SQL (see the Phase 3B migration) — this only decides display units
 * and wording, never re-derives precision the database didn't already
 * commit to. Under 1 km switches to metres (rounded to the nearest 50m,
 * since "270 m away" reads as falsely precise for a value PostGIS itself
 * only resolves to roughly building-level accuracy) rather than showing
 * "0.3 km away".
 */
export function formatDistanceKm(distanceKm: number): string {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return "";

  if (distanceKm < 1) {
    const meters = Math.max(50, Math.round((distanceKm * 1000) / 50) * 50);
    return `${meters} m away`;
  }

  return `${distanceKm.toFixed(1)} km away`;
}
