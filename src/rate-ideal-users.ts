import fs from "fs";
import { rateUserV2 } from "./rate-users-v2.js";
import { rateUser } from "./rate-users.js";
import { UserData } from "./types.js";

async function rateIdealUsers() {
  try {
    // Read the ideal users from the JSON file
    const idealUsers: UserData[] = JSON.parse(
      fs.readFileSync("dataOutputs/idealUsers.json", "utf8")
    );

    console.log(`Loaded ${idealUsers.length} ideal users to rate`);

    // Rate each user
    for (let i = 0; i < idealUsers.length; i++) {
      const user = idealUsers[i];
      console.log(`\nRating user ${i + 1}/${idealUsers.length}: ${user.login}`);

      // Rate the user
      const rating = await rateUser(user);

      // Update the user object with the rating
      user.llmRoleMatchRatingScore = rating;

      console.log(`Rating for ${user.login}:`, rating);

      // Call rateUserV2 and store the result in v2LlmRatingScore
      const v2Rating = await rateUserV2(user);
      user.v2LlmRatingScore = v2Rating;
      console.log(`V2 Rating for ${user.login}:`, v2Rating);

      // Save after each user to avoid losing progress
      fs.writeFileSync(
        "dataOutputs/idealUsers.json",
        JSON.stringify(idealUsers, null, 2)
      );
    }

    console.log("\nCompleted rating all ideal users!");
  } catch (error) {
    console.error("Error rating ideal users:", error);
  }
}

// Run the rating script
rateIdealUsers().catch(console.error);
