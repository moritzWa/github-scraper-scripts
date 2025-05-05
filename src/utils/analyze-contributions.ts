import { Octokit } from "@octokit/core";
import dotenv from "dotenv";
import { johannesRecUserNames } from "../variables.js";
import { fetchContributions } from "./prime-scraper-api-utils.js";

// Load environment variables
dotenv.config();

// Debug: Check if token is loaded
const apiKey = process.env.GITHUB_ACCESS_TOKEN;
console.log("Token loaded:", apiKey ? "Yes" : "No");
if (!apiKey) {
  console.error("GITHUB_ACCESS_TOKEN is not set in .env file");
  process.exit(1);
}

const octokit = new Octokit({ auth: apiKey });

interface UserContributions {
  username: string;
  contributions: number;
  total_commits: number;
  total_issues: number;
  total_prs: number;
  restricted_contributions: number;
  calendar_total: number;
}

async function analyzeUserContributions(
  usernames: string[]
): Promise<UserContributions[]> {
  const results: UserContributions[] = [];

  for (const username of usernames) {
    try {
      const contributions = await fetchContributions(username);
      if (contributions) {
        results.push({
          username,
          contributions: contributions.totalSum,
          total_commits: contributions.total_commits,
          total_issues: contributions.total_issues,
          total_prs: contributions.total_prs,
          restricted_contributions: contributions.restricted_contributions,
          calendar_total: contributions.calendar_total,
        });
      } else {
        console.log(`Could not fetch contributions for ${username}`);
      }
    } catch (error) {
      console.error(`Error processing ${username}:`, error);
    }
  }

  return results;
}

async function main() {
  // Extract usernames from primeTeamMembers URLs
  const usernames = johannesRecUserNames.map((url) => {
    // Remove trailing slash if present
    const cleanUrl = url.endsWith("/") ? url.slice(0, -1) : url;
    // Extract username from URL
    const parts = cleanUrl.split("/");
    return parts[parts.length - 1];
  });

  console.log("Analyzing contributions for prime team members:", usernames);

  const results = await analyzeUserContributions(usernames);

  // Calculate averages
  const totalContributions = results.reduce(
    (sum, user) => sum + user.contributions,
    0
  );
  const totalCommits = results.reduce(
    (sum, user) => sum + user.total_commits,
    0
  );
  const totalIssues = results.reduce((sum, user) => sum + user.total_issues, 0);
  const totalPRs = results.reduce((sum, user) => sum + user.total_prs, 0);
  const totalRestricted = results.reduce(
    (sum, user) => sum + user.restricted_contributions,
    0
  );
  const totalCalendar = results.reduce(
    (sum, user) => sum + user.calendar_total,
    0
  );

  const averageContributions = totalContributions / results.length;
  const averageCommits = totalCommits / results.length;
  const averageIssues = totalIssues / results.length;
  const averagePRs = totalPRs / results.length;
  const averageRestricted = totalRestricted / results.length;
  const averageCalendar = totalCalendar / results.length;

  // Print results
  console.log("\nIndividual Results:");
  results.forEach((user) => {
    console.log(`\n${user.username}:`);
    console.log(`  Total Contributions: ${user.contributions}`);
    console.log(`  Public Contributions: ${user.calendar_total}`);
    console.log(`  Restricted Contributions: ${user.restricted_contributions}`);
    console.log(`  Commits: ${user.total_commits}`);
    console.log(`  Issues: ${user.total_issues}`);
    console.log(`  Pull Requests: ${user.total_prs}`);
  });

  console.log("\nAverages:");
  console.log(
    `  Average Total Contributions: ${averageContributions.toFixed(2)}`
  );
  console.log(`  Average Public Contributions: ${averageCalendar.toFixed(2)}`);
  console.log(
    `  Average Restricted Contributions: ${averageRestricted.toFixed(2)}`
  );
  console.log(`  Average Commits: ${averageCommits.toFixed(2)}`);
  console.log(`  Average Issues: ${averageIssues.toFixed(2)}`);
  console.log(`  Average Pull Requests: ${averagePRs.toFixed(2)}`);
}

main().catch(console.error);
