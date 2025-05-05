import { readFileSync } from "fs";
import { UserData } from "./types.js";

function calculateCombinedScore(user: UserData): number {
  const followers = user.followers || 0;
  const contributions = user.contributions?.totalSum || 0;
  const llmScore = user.v2LlmRatingScore?.score || 0;

  const normalizedFollowers = Math.min(followers / 1000, 1);
  const normalizedContributions = Math.min(contributions / 3000, 1);
  const normalizedLLMScore = llmScore / 100;

  const llmWeight = 0.65;
  const followersWeight = 0.15;
  const contributionsWeight = 0.2;

  return (
    (normalizedLLMScore * llmWeight +
      normalizedFollowers * followersWeight +
      normalizedContributions * contributionsWeight) *
    100
  );
}

function calculateStats() {
  try {
    const users: UserData[] = JSON.parse(
      readFileSync("dataOutputs/repoInteracters-3.json", "utf8")
    );

    const totalProfiles = users.length;
    const ratedUsersV2 = users.filter((user) => user.v2LlmRatingScore);

    const avgV2Score =
      ratedUsersV2.reduce(
        (sum, user) => sum + (user.v2LlmRatingScore?.score || 0),
        0
      ) / ratedUsersV2.length;

    const avgContributions =
      users.reduce(
        (sum, user) => sum + (user.contributions?.totalSum || 0),
        0
      ) / totalProfiles;

    const avgOverallScore =
      users.reduce((sum, user) => sum + calculateCombinedScore(user), 0) /
      totalProfiles;

    // Calculate score distributions
    const scoreThresholds = [100, 90, 80, 70, 60, 50, 40, 30];
    const scoreDistributions = scoreThresholds.reduce(
      (acc: Record<number, number>, threshold) => {
        acc[threshold] = ratedUsersV2.filter(
          (user) => (user.v2LlmRatingScore?.score || 0) >= threshold
        ).length;
        return acc;
      },
      {}
    );

    console.log("\nRepository Stats:");
    console.log("----------------------------------------");
    console.log(`Total Profiles: ${totalProfiles}`);
    console.log(`Rated Profiles (V2): ${ratedUsersV2.length}`);
    console.log(`Average LLM Score (V2): ${avgV2Score.toFixed(2)}`);
    console.log(`Average Contributions: ${avgContributions.toFixed(0)}`);
    console.log(`Average Overall Score: ${avgOverallScore.toFixed(2)}`);

    console.log("\nScore Distribution:");
    scoreThresholds.forEach((threshold) => {
      const count = scoreDistributions[threshold];
      const percentage = ((count / totalProfiles) * 100).toFixed(1);
      console.log(`Score ≥ ${threshold}: ${count} (${percentage}%)`);
    });
  } catch (error) {
    console.error("Error calculating stats:", error);
  }
}

calculateStats();
