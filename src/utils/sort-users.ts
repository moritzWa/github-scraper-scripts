import { readFileSync, writeFileSync } from "fs";
import { UserData } from "../types.js";

function calculateCombinedScore(user: UserData): number {
  const followers = user.followers || 0;
  const contributions = user.contributions?.totalSum || 0;
  const llmScore = user.llmRoleMatchRatingScore?.score || 0;
  const v2Score = user.v2LlmRatingScore?.score || 0;
  // Normalize scores to be between 0 and 1
  const normalizedFollowers = Math.min(followers / 1000, 1); // Cap at 1000 followers
  const normalizedContributions = Math.min(contributions / 3000, 1); // Cap at 1000 contributions
  const normalizedLLMScore = llmScore / 100; // Already 0-100, just convert to 0-1
  const normalizedV2Score = v2Score / 100; // Already 0-100, just convert to 0-1

  // Weight the different factors
  const v2Weight = 0.7; // 15% weight to LLM score
  const contributionsWeight = 0.2; // 25% weight to contributions
  const followersWeight = 0.1; // 15% weight to followers

  const finalScoreNotRounded =
    (normalizedV2Score * v2Weight +
      normalizedFollowers * followersWeight +
      normalizedContributions * contributionsWeight) *
    100;

  return Math.round(finalScoreNotRounded);
}

function sortUsers() {
  try {
    // Read the existing users
    const users: UserData[] = JSON.parse(
      readFileSync("dataOutputs/repointeracters-3.json", "utf8")
    );
    console.log(`Loaded ${users.length} users from repointeracters-3.json`);

    // Calculate combined scores and sort
    const usersWithScores = users.map((user) => ({
      ...user,
      combinedScore: calculateCombinedScore(user),
    }));

    // Sort by combined score in descending order
    usersWithScores.sort((a, b) => b.combinedScore - a.combinedScore);

    // Create a summary of the top users
    console.log("\nTop 50 Users by Combined Score:");
    console.log("----------------------------------------");
    usersWithScores.slice(0, 50).forEach((user, index) => {
      console.log(`${index + 1}. https://github.com/${user.login}`);
      console.log(`   Score: ${user.combinedScore.toFixed(2)}`);
      console.log(
        `   LLM Score: ${user.v2LlmRatingScore?.score || "Not Rated"}`
      );
      console.log(`   Followers: ${user.followers}`);
      console.log(`   Contributions: ${user.contributions?.totalSum || 0}`);
      console.log("----------------------------------------");
    });

    // Save sorted users back to repointeracters-3.json
    writeFileSync(
      "dataOutputs/repointeracters-3.json",
      JSON.stringify(usersWithScores, null, 2)
    );
    console.log("\nSaved sorted users back to repointeracters-3.json");
  } catch (error) {
    console.error("Error sorting users:", error);
  }
}

// Run the script
sortUsers();
