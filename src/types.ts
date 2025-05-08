import { DbGraphUser } from "./graph-scraper/types.js";

export interface ScrapedRepo {
  repoUrl: string;
  scrapedTypes: string[];
  lastProcessedPage?: {
    [interactionType: string]: number;
  };
}

export enum interactionTypes {
  contributor = "contributor",
  forker = "forker",
  stargazer = "stargazer",
  watcher = "watcher",
}

export interface RepoSummary {
  repoUrl: string;
  totalProcessed: number;
  qualifiedUsers: number;
  usersWithContributions: number;
  qualifiedUserLogins: string[];
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  created_at: string | null;
  updated_at: string | null;
  pushed_at: string | null;
  stargazers_count: number;
  forks_count: number;
  topics: string[];
  is_fork: boolean;
}

export interface UserData
  extends Omit<DbGraphUser, "_id" | "status" | "depth" | "scrapedConnections"> {
  login: string;
  repoInteractionScraped: Array<{
    scrapedFromUrl: string;
    interactionTypes: string[];
  }>;
  llmRoleMatchRatingScore?: {
    reasoning: string;
    score: number;
    role: string;
  };
  v2LlmRatingScore?: {
    reasoning: string;
    score: number;
    webResearchInfo: string;
  };
}
