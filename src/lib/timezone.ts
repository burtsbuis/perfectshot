import tzlookup from "@photostructure/tz-lookup";

/**
 * IANA timezone for a location, computed offline. Times must never depend on a network call:
 * when the weather service was down, an earlier version fell back to UTC and showed every
 * time on the page hours off (ADR-016).
 */
export function timezoneAt(lat: number, lng: number): string {
  try {
    return tzlookup(lat, lng);
  } catch {
    return "UTC";
  }
}
