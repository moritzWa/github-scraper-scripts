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

export interface CalendarWeek {
  contributionDays: CalendarDay[];
}

export interface CalendarDay {
  date: string;
  contributionCount: number;
}

export interface ContributionData {
  total_commits: number;
  total_issues: number;
  total_prs: number;
  restricted_contributions: number;
  calendar_total: number;
  calendar_weeks: CalendarWeek[];
  totalSum: number;
}

export interface GraphUser {
  login: string;
  profileUrl: string;
  createdAt: string;
  followers: number;
  following: number;
  name: string | null;
  bio: string | null;
  company: string | null;
  blog: string | null;
  location: string | null;
  normalizedLocation: any;
  email: string | null;
  twitter_username: string | null;
  xUrl: string | null;
  xBio: string | null;
  xName: string | null;
  xLocation: string | null;
  public_repos: number;
  contributions: ContributionData | null | undefined;
  profileReadme: string | null;
  websiteContent: string | null;
  depth: number;
}

export interface DbGraphUser extends Omit<GraphUser, "login"> {
  _id: string; // username
  status: "pending" | "processing" | "processed" | "ignored";
  depth: number;
}

export interface GraphData {
  users: GraphUser[];
  edges: Array<{
    from: string;
    to: string;
  }>;
  processedUsernames: Set<string>;
  ignoredUsernames: Set<string>;
  maxDepth: number;
}

export interface GitHubUser {
  login: string;
  created_at: string;
  followers: number;
  name?: string | null;
  bio?: string | null;
  company?: string | null;
  blog?: string | null;
  location?: string | null;
  email?: string | null;
  twitter_username?: string | null;
  public_repos?: number;
  public_gists?: number;
  avatar_url?: string;
  html_url?: string;
  type?: string;
  site_admin?: boolean;
  id?: number;
  node_id?: string;
  gravatar_id?: string | null;
  url?: string;
  followers_url?: string;
  following_url?: string;
  gists_url?: string;
  starred_url?: string;
  subscriptions_url?: string;
  organizations_url?: string;
  repos_url?: string;
  events_url?: string;
  received_events_url?: string;
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
