import { cityMapping } from "city-timezones";

export interface NormalizedLocation {
  city: string | null;
  province: string | null;
  country: string | null;
  timezone: string | null;
}

export function normalizeLocation(location: string | null): NormalizedLocation {
  if (!location) {
    return {
      city: null,
      province: null,
      country: null,
      timezone: null,
    };
  }

  const cleanLocation = location
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const cityResults = cityMapping.filter((city) => {
    const searchStr = cleanLocation.toLowerCase();
    const cityStr = city.city.toLowerCase();
    return searchStr.includes(cityStr) || cityStr.includes(searchStr);
  });

  if (cityResults.length > 0) {
    const bestMatch = cityResults.sort(
      (a, b) => (b.pop || 0) - (a.pop || 0)
    )[0];
    return {
      city: bestMatch.city,
      province: bestMatch.province || bestMatch.state_ansi || null,
      country: bestMatch.country,
      timezone: bestMatch.timezone,
    };
  }

  const parts = cleanLocation.split(/,\s*/);

  if (parts.length >= 2) {
    return {
      city: parts[0] || null,
      province: parts.length > 2 ? parts[1] : null,
      country: parts[parts.length - 1] || null,
      timezone: null,
    };
  }

  return {
    city: cleanLocation || null,
    province: null,
    country: null,
    timezone: null,
  };
}

export function isLocationInBadCountries(location: string | null): boolean {
  if (!location) return false;

  const normalized = normalizeLocation(location);
  const country = normalized.country?.toLowerCase();

  return country === "china" || country === "south korea";
}
