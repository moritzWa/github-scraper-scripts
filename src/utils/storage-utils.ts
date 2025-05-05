import fs from "fs";
import { ScrapedRepo } from "../types.js";

// Add these helper functions
export function loadScrapedRepos(): ScrapedRepo[] {
  try {
    const data = fs.readFileSync("dataOutputs/scrapedRepos.json", "utf8");
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

// Modified to ONLY update the last processed page
export function saveScrapedRepo(
  repoUrl: string,
  type: string,
  lastProcessedPage: number
) {
  const scrapedRepos = loadScrapedRepos();
  const existingRepo = scrapedRepos.find((repo) => repo.repoUrl === repoUrl);

  if (existingRepo) {
    if (!existingRepo.lastProcessedPage) {
      existingRepo.lastProcessedPage = {};
    }
    existingRepo.lastProcessedPage[type] = lastProcessedPage;
  } else {
    scrapedRepos.push({
      repoUrl,
      scrapedTypes: [], // Start with empty array
      lastProcessedPage: {
        [type]: lastProcessedPage,
      },
    });
  }

  fs.writeFileSync(
    "dataOutputs/scrapedRepos.json",
    JSON.stringify(scrapedRepos, null, 2)
  );
}

// New function to mark a type as fully completed
export function markTypeAsCompleted(repoUrl: string, type: string) {
  const scrapedRepos = loadScrapedRepos();
  const existingRepo = scrapedRepos.find((repo) => repo.repoUrl === repoUrl);

  if (existingRepo) {
    if (!existingRepo.scrapedTypes.includes(type)) {
      existingRepo.scrapedTypes.push(type);
    }
  } else {
    scrapedRepos.push({
      repoUrl,
      scrapedTypes: [type],
    });
  }

  fs.writeFileSync(
    "dataOutputs/scrapedRepos.json",
    JSON.stringify(scrapedRepos, null, 2)
  );
}

export function hasBeenScraped(repoUrl: string, type: string): boolean {
  const scrapedRepos = loadScrapedRepos();
  const existingRepo = scrapedRepos.find((repo) => repo.repoUrl === repoUrl);
  return existingRepo ? existingRepo.scrapedTypes.includes(type) : false;
}

export function getLastProcessedPage(
  repoUrl: string,
  interactionType: string
): number | null {
  const scrapedRepos = loadScrapedRepos();
  const repo = scrapedRepos.find((r) => r.repoUrl === repoUrl);
  console.log(
    `Debug - Looking for last processed page for ${repoUrl} and ${interactionType}`
  );
  console.log(`Debug - Found repo:`, repo);
  if (
    repo &&
    repo.lastProcessedPage &&
    repo.lastProcessedPage[interactionType]
  ) {
    console.log(
      `Debug - Found last processed page: ${repo.lastProcessedPage[interactionType]}`
    );
    return repo.lastProcessedPage[interactionType];
  }
  console.log(`Debug - No last processed page found`);
  return null;
}
