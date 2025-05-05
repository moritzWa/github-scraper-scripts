import { Octokit } from "@octokit/core";
import dotenv from "dotenv";
import { withRateLimitRetry } from "./prime-scraper-api-utils.js";
import { organisationsToScrape } from "./variables.js";

// Load environment variables
dotenv.config();

const apiKey = process.env.GITHUB_ACCESS_TOKEN;
const octokit = new Octokit({ auth: apiKey });

async function getReposFromOrganization(orgUrl: string) {
  // Extract org name from URL
  const orgName = orgUrl.replace("https://github.com/", "");
  const qualifiedRepos: string[] = [];

  try {
    let page = 1;
    while (true) {
      const response = await withRateLimitRetry(() =>
        octokit.request("GET /orgs/{org}/repos", {
          org: orgName,
          per_page: 100,
          page,
          sort: "updated",
          direction: "desc",
        })
      );

      if (!response.data || response.data.length === 0) break;

      for (const repo of response.data) {
        if ((repo.stargazers_count ?? 0) >= 3 || (repo.forks_count ?? 0) >= 5) {
          qualifiedRepos.push(`https://github.com/${repo.full_name}`);
        }
      }

      if (response.data.length < 100) break;
      page++;
    }
  } catch (error) {
    console.error(`Error processing organization ${orgUrl}:`, error);
  }

  return qualifiedRepos;
}

async function scrapeReposFromOrganizations() {
  console.log("Starting organization repository scraping...\n");
  const allQualifiedRepos: string[] = [];

  for (const orgUrl of organisationsToScrape) {
    console.log(`Processing organization: ${orgUrl}`);
    const qualifiedRepos = await getReposFromOrganization(orgUrl);
    allQualifiedRepos.push(...qualifiedRepos);
  }

  console.log("\nAll qualified repositories (≥3 stars or ≥5 forks):");
  console.log("----------------------------------------");
  allQualifiedRepos.forEach((repo) => console.log(`"${repo}",`));
  console.log("----------------------------------------");
  console.log(
    `\nTotal qualified repositories found: ${allQualifiedRepos.length}`
  );
}

// Run the scraper
scrapeReposFromOrganizations().catch(console.error);
