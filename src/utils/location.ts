import { readFileSync, writeFileSync } from "fs";
import { UserData } from "../types.js";
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

function addNormalizedLocations() {
  try {
    // Read the existing users
    const users: UserData[] = JSON.parse(
      readFileSync("dataOutputs/repointeracters-3.json", "utf8")
    );
    console.log(`Loaded ${users.length} users from repointeracters-3.json`);

    let updatedCount = 0;
    let skippedCount = 0;
    let noLocationCount = 0;

    // Process each user
    const updatedUsers = users.map((user) => {
      // Skip if no location data
      if (!user.location) {
        noLocationCount++;
        return user;
      }

      // Skip if already has normalized location
      if (user.normalizedLocation) {
        skippedCount++;
        return user;
      }

      // Add normalized location
      const normalizedLocation = normalizeLocation(user.location);
      updatedCount++;

      return {
        ...user,
        normalizedLocation,
      };
    });

    // Print summary
    console.log("\nLocation Processing Summary:");
    console.log("----------------------------------------");
    console.log(`Total users processed: ${users.length}`);
    console.log(`Users with no location: ${noLocationCount}`);
    console.log(`Users already normalized: ${skippedCount}`);
    console.log(`Users updated: ${updatedCount}`);
    console.log("----------------------------------------");

    // Save updated users back to repointeracters-3.json
    writeFileSync(
      "dataOutputs/repointeracters-3.json",
      JSON.stringify(updatedUsers, null, 2)
    );
    console.log("\nSaved updated users back to repointeracters-3.json");

    // Print some examples of the updates
    if (updatedCount > 0) {
      console.log("\nExample Updates:");
      console.log("----------------------------------------");
      updatedUsers
        .filter(
          (user) =>
            user.normalizedLocation &&
            !users.find((u) => u.login === user.login)?.normalizedLocation
        )
        .slice(0, 5)
        .forEach((user) => {
          console.log(`\nUser: ${user.login}`);
          console.log(`Original location: ${user.location}`);
          console.log(`Normalized location:`, user.normalizedLocation);
        });
    }
  } catch (error) {
    console.error("Error processing locations:", error);
  }
}

// Run the script
addNormalizedLocations();
