import { readFileSync, writeFileSync } from "fs";
import { UserData } from "../types.js";

function cleanUsers() {
  try {
    // Read the users from repointeracters-3.json
    const users: UserData[] = JSON.parse(
      readFileSync("dataOutputs/repointeracters-3.json", "utf8")
    );
    console.log(`Loaded ${users.length} users from database`);

    // Filter users based on criteria
    const filteredUsers = users.filter((user) => {
      const llmScore = user.llmRoleMatchRatingScore?.score || 0;
      const role = user.llmRoleMatchRatingScore?.role || "No Match";
      const followers = user.followers || 0;

      // Keep user if:
      // 1. Followers <= 5000
      // 2. Either:
      //    a. Has a role match
      //    b. No role match but LLM score >= 70
      const keepUser =
        followers <= 5000 && (role !== "No Match" || llmScore >= 70);

      return keepUser;
    });

    // Write filtered users back to file
    writeFileSync(
      "dataOutputs/repointeracters-3.json",
      JSON.stringify(filteredUsers, null, 2)
    );

    // Print summary
    console.log("\nCleaning Summary:");
    console.log("----------------------------------------");
    console.log(`Original users: ${users.length}`);
    console.log(`Remaining users: ${filteredUsers.length}`);
    console.log(`Removed users: ${users.length - filteredUsers.length}`);

    // Print detailed breakdown
    const removedByNoRoleAndLowScore = users.filter(
      (u) =>
        (u.llmRoleMatchRatingScore?.role || "No Match") === "No Match" &&
        (u.llmRoleMatchRatingScore?.score || 0) < 70
    ).length;
    const removedByFollowers = users.filter(
      (u) => (u.followers || 0) > 5000
    ).length;

    console.log("\nRemoval Breakdown:");
    console.log(
      `- No role match AND low LLM score (<70): ${removedByNoRoleAndLowScore}`
    );
    console.log(`- Too many followers (>5k): ${removedByFollowers}`);

    // Print role distribution of remaining users
    const roleDistribution = filteredUsers.reduce(
      (acc: Record<string, number>, user) => {
        const role = user.llmRoleMatchRatingScore?.role || "No Match";
        acc[role] = (acc[role] || 0) + 1;
        return acc;
      },
      {}
    );

    console.log("\nRemaining Users Role Distribution:");
    Object.entries(roleDistribution).forEach(([role, count]) => {
      const percentage = ((count / filteredUsers.length) * 100).toFixed(1);
      console.log(`${role}: ${count} (${percentage}%)`);
    });

    // Additional stats for No Match users with high scores
    const highScoreNoMatch = filteredUsers.filter(
      (u) =>
        (u.llmRoleMatchRatingScore?.role || "No Match") === "No Match" &&
        (u.llmRoleMatchRatingScore?.score || 0) >= 70
    );

    if (highScoreNoMatch.length > 0) {
      console.log("\nHigh-Score No Match Users (>=70):");
      console.log(`Total: ${highScoreNoMatch.length}`);
      console.log("Top 5 by score:");
      highScoreNoMatch
        .sort(
          (a, b) =>
            (b.llmRoleMatchRatingScore?.score || 0) -
            (a.llmRoleMatchRatingScore?.score || 0)
        )
        .slice(0, 5)
        .forEach((u) => {
          console.log(
            `- ${u.login}: Score ${u.llmRoleMatchRatingScore?.score}`
          );
        });
    }
  } catch (error) {
    console.error("Error cleaning users:", error);
  }
}

cleanUsers();
