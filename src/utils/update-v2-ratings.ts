import { config } from "dotenv";
import { readFileSync, writeFileSync } from "fs";
import { rateUserV2 } from "../rating/rate-users-v2.js";
import { UserData } from "../types.js";

// Load environment variables
config();

// Set this to true to override existing v2 ratings
const overrideExistingV2LlmRatingScore = false;

async function updateV2Ratings() {
  try {
    // Read the existing users
    const users: UserData[] = JSON.parse(
      readFileSync("dataOutputs/repoInteracters-1.json", "utf8")
    );
    console.log(`Loaded ${users.length} users from repoInteracters-1.json`);

    // Count how many users already have v2 ratings
    const ratedCount = users.filter((user) => user.v2LlmRatingScore).length;
    console.log(`Found ${ratedCount} users with existing v2 ratings`);
    if (overrideExistingV2LlmRatingScore) {
      console.log("WARNING: Will override existing v2 ratings");
    }

    // Process users in batches of 10
    const BATCH_SIZE = 10;
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      console.log(
        `\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(
          users.length / BATCH_SIZE
        )}`
      );

      // Process batch in parallel
      await Promise.all(
        batch.map(async (user) => {
          // Skip if already rated and not overriding
          if (user.v2LlmRatingScore && !overrideExistingV2LlmRatingScore) {
            console.log(`Skipping already rated user: ${user.login}`);
            return;
          }

          try {
            console.log(`\nProcessing user: ${user.login}`);
            if (user.v2LlmRatingScore) {
              console.log(`Previous rating:`, user.v2LlmRatingScore);
            }
            const rating = await rateUserV2(user);
            user.v2LlmRatingScore = rating;
            console.log(`New V2 Rating for ${user.login}:`, rating);
          } catch (error) {
            console.error(`Error rating user ${user.login}:`, error);
          }
        })
      );

      // Save after each batch to avoid losing progress
      writeFileSync(
        "dataOutputs/repoInteracters-1.json",
        JSON.stringify(users, null, 2)
      );
      console.log(
        `Saved updated data for batch ${Math.floor(i / BATCH_SIZE) + 1}`
      );
    }

    console.log("\nCompleted updating all V2 ratings!");
  } catch (error) {
    console.error("Error updating V2 ratings:", error);
  }
}

// Run the script if it's the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  updateV2Ratings().catch(console.error);
}
