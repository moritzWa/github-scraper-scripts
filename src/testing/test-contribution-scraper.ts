// scraper/src/testContributionScraper.ts
import dotenv from "dotenv";
import {
  isActiveInEnoughMonths,
  isWeekdayCoder,
} from "../graph-scraper/helpers.js";
import { fetchContributions } from "../utils/prime-scraper-api-utils.js"; // Assuming fetchContributions is here

dotenv.config(); // Load environment variables (like GITHUB_ACCESS_TOKEN)

const testUsernames = [
  "kayserifserif", // Potential "weekday coder"
  "shiraz88", // Potential "recent activity only"
  "mwvd", // Example from previous logs
  "mikex86", // Added for testing
  "JohannesHa", // Added for testing
  "mattdf", // Added for testing
];

// --- Analysis Functions (to be implemented) ---

// --- Main Testing Logic ---

async function analyzeTestProfiles() {
  console.log("Analyzing Test Profiles...");

  for (const username of testUsernames) {
    console.log(`\n--- Analyzing ${username} ---`);
    const contributions = await fetchContributions(username);

    if (contributions && contributions.calendar_weeks) {
      // Log Summary (Moved from main scraper)
      const { calendar_weeks, ...summaryContributions } = contributions;
      console.log(
        `Contributions summary:`,
        JSON.stringify(summaryContributions, null, 2)
      );

      const totalWeeks = calendar_weeks.length;
      const midPointWeekIndex = Math.floor(totalWeeks / 2);
      const firstHalfContributions = calendar_weeks
        .slice(0, midPointWeekIndex)
        .reduce(
          (sum, week) =>
            sum +
            week.contributionDays.reduce(
              (daySum, day) => daySum + day.contributionCount,
              0
            ),
          0
        );
      const secondHalfContributions = calendar_weeks
        .slice(midPointWeekIndex)
        .reduce(
          (sum, week) =>
            sum +
            week.contributionDays.reduce(
              (daySum, day) => daySum + day.contributionCount,
              0
            ),
          0
        );
      console.log(
        `  Calendar Activity: First ~6mo: ${firstHalfContributions}, Last ~6mo: ${secondHalfContributions} (Total Weeks: ${totalWeeks})`
      );

      // Run Checks
      const enoughMonths = isActiveInEnoughMonths(contributions.calendar_weeks);
      const isWeekday = isWeekdayCoder(contributions.calendar_weeks);

      console.log(`  Check Results:`);
      console.log(`    - Active in >= 8 months? ${enoughMonths}`);
      console.log(`    - Primarily Weekday Coder (>90%)? ${isWeekday}`);
    } else {
      console.log(`Could not fetch or process contributions for ${username}.`);
    }
  }

  console.log("\nAnalysis Complete.");
}

analyzeTestProfiles().catch(console.error);
