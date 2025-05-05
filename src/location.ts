import { readFileSync, writeFileSync } from "fs";
import { normalizeLocation } from "./prime-scraper-location.js";
import { UserData } from "./types.js";

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
