import { ContributionData } from "./graph-scraper/types.js";
import { NormalizedLocation } from "./utils/location.js";

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
}

export interface UserData {
  login: string;
  profileUrl: string;
  createdAt: string;
  followers: number;
  name: string | null;
  bio: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  email: string | null;
  twitter_username: string | null;
  xUrl: string | null;
  xBio: string | null;
  xName: string | null;
  xLocation: string | null;
  public_repos: number;
  repoInteractionScraped: Array<{
    scrapedFromUrl: string;
    interactionTypes: string[];
  }>;
  contributions?: ContributionData;
  profileReadme: string | null;
  websiteContent: string | null;
  recentRepositories?: Array<GitHubRepo>;
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
  normalizedLocation: NormalizedLocation;
}
