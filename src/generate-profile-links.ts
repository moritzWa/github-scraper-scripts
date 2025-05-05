import { readFileSync, writeFileSync } from "fs";
import { UserData } from "./types.js";

function generateProfileLinks() {
  try {
    // Read the users from repointeracters-3.json
    const users: UserData[] = JSON.parse(
      readFileSync("dataOutputs/repointeracters-3.json", "utf8")
    );
    console.log(`Loaded ${users.length} users from repointeracters-3.json`);

    // Filter users with LLM V2 score between 60 and 70
    const scoringUsers = users.filter((user) => {
      const score = user.v2LlmRatingScore?.score || 0;
      return score >= 60 && score < 70;
    });
    const profileLinks = scoringUsers.map((user) => user.profileUrl);

    // Write links to a file
    writeFileSync(
      "dataOutputs/scoring-profiles-60-to-70.txt",
      profileLinks.join("\n")
    );
    console.log(
      `\nGenerated ${profileLinks.length} profile links for users with LLM V2 score between 60-70 in dataOutputs/scoring-profiles-60-to-70.txt`
    );
  } catch (error) {
    console.error("Error generating profile links:", error);
  }
}

// Run the script
generateProfileLinks();
