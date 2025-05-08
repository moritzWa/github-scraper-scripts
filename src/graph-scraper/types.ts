import { GitHubRepo } from "../types.js";
import { NormalizedLocation } from "../utils/location.js";

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
  normalizedLocation: NormalizedLocation;
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
  recentRepositories: Array<GitHubRepo> | null;
  depth: number;
  status: "pending" | "processing" | "processed" | "ignored";
  ignoredReason?: IgnoredReason;
  scrapedConnections?: {
    followers: boolean;
    following: boolean;
  };
  rating?: number;
  ratingReasoning?: string;
  webResearchInfo?: string;
  ratedAt?: Date;
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

export enum IgnoredReason {
  BANNED_COUNTRY = "BANNED_COUNTRY",
  ACCOUNT_TOO_NEW = "ACCOUNT_TOO_NEW",
  INSUFFICIENT_PROFILE_FIELDS = "INSUFFICIENT_PROFILE_FIELDS",
  TOO_MANY_FOLLOWERS = "TOO_MANY_FOLLOWERS",
  TOO_MANY_FOLLOWING = "TOO_MANY_FOLLOWING",
  COULD_NOT_FETCH_CONTRIBUTIONS = "COULD_NOT_FETCH_CONTRIBUTIONS",
  LOW_CONTRIBUTIONS_LOW_FOLLOWERS = "LOW_CONTRIBUTIONS_LOW_FOLLOWERS",
  LOW_CONTRIBUTIONS_MEDIUM_FOLLOWERS = "LOW_CONTRIBUTIONS_MEDIUM_FOLLOWERS",
  LOW_CONTRIBUTIONS_HIGH_FOLLOWERS = "LOW_CONTRIBUTIONS_HIGH_FOLLOWERS",
  NOT_ACTIVE_ENOUGH_MONTHS = "NOT_ACTIVE_ENOUGH_MONTHS",
  WEEKDAY_CODER = "WEEKDAY_CODER",
  ERROR_SCRAPING = "ERROR_SCRAPING",
  ERROR_SCRAPING_CONNECTIONS = "ERROR_SCRAPING_CONNECTIONS",
}
