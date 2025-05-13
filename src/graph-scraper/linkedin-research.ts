import dotenv from "dotenv"; // Corrected dotenv import
dotenv.config(); // Load environment variables at the very top

// It's a good practice to load environment variables from a .env file for local development
// The lines below can be removed or kept commented as dotenv is now configured above
// import *dotenv* from 'dotenv';
// dotenv.config();

import { UserData } from "../types.js";
import { isLinkedInDomain } from "../utils/prime-scraper-api-utils.js";
import openai from "./openai.js"; // Import the shared OpenAI client
import { DbGraphUser } from "./types.js";

// If you are in an environment where fetch is not globally available (e.g., older Node.js versions),
// you might need to import it:
// import fetch from 'node-fetch';

interface Geo {
  country: string;
  city: string;
  full: string;
  countryCode: string;
}

interface Language {
  name: string;
  proficiency: string;
}

interface DateInfo {
  year: number;
  month: number;
  day: number;
}

interface LogoInfo {
  url: string;
  width: number;
  height: number;
}

interface Education {
  start: DateInfo;
  end: DateInfo;
  fieldOfStudy: string;
  degree: string;
  grade: string;
  schoolName: string;
  description: string;
  activities: string;
  url: string;
  schoolId: string;
  logo: LogoInfo[] | LogoInfo | null; // Can be an array or single object based on some APIs, or null
}

interface MultiLocaleText {
  [locale: string]: string;
}

interface Position {
  companyId: number | null; // Microsoft example has 1035, Waitlist has 76446298
  companyName: string;
  companyUsername: string;
  companyURL: string;
  companyLogo: string | null;
  companyIndustry: string;
  companyStaffCountRange: string;
  title: string;
  multiLocaleTitle: MultiLocaleText;
  multiLocaleCompanyName: MultiLocaleText;
  location: string;
  description: string;
  employmentType: string;
  start: DateInfo;
  end: DateInfo | null; // Current positions might not have an end date
}

interface Skill {
  name: string;
  passedSkillAssessment: boolean;
  endorsementsCount?: number; // Optional as per "Data Analysis"
}

interface Honor {
  title: string;
  description: string;
  issuer: string;
  issuerLogo: string;
  issuedOn: DateInfo;
}

export interface LinkedInProfile {
  id: number;
  urn: string;
  username: string;
  firstName: string;
  lastName: string;
  isPremium: boolean;
  headline: string;
  geo: Geo;
  languages: Language[];
  educations: Education[];
  position: Position[];
  fullPositions: Position[]; // Assuming same structure as Position for now
  skills: Skill[];
  honors: Honor[];
  projects: Record<string, unknown>; // Or a more specific type if structure is known
  supportedLocales: Array<{ country: string; language: string }>;
  multiLocaleFirstName: MultiLocaleText;
  multiLocaleLastName: MultiLocaleText;
  multiLocaleHeadline: MultiLocaleText;
}

const RAPIDAPI_HOST = "linkedin-data-api.p.rapidapi.com";

// $175/month for up to 50k requests
export async function fetchLinkedInExperienceViaRapidAPI(
  url: string
): Promise<LinkedInProfile | null> {
  const apiKey = process.env.RAPIDAPI_KEY;

  if (!apiKey) {
    console.error(
      "Error: RAPIDAPI_KEY is not set. Please set this environment variable."
    );
    return null;
  }

  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  const username = match ? match[1] : url;

  console.log("fetchLinkedInExperienceViaRapidAPI username", username);

  const options = {
    method: "GET",
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": RAPIDAPI_HOST,
    },
  };

  try {
    const response = await fetch(
      `https://${RAPIDAPI_HOST}/?username=${username}`,
      options
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        `Error fetching LinkedIn data for ${username}: ${response.status} ${response.statusText}`
      );
      console.error("Error response body:", errorBody);
      return null;
    }

    const text = await response.text();
    // console.log("Raw RapidAPI LinkedIn response:", text);
    const data: LinkedInProfile = JSON.parse(text);
    return data;
  } catch (error) {
    console.error(
      `Failed to fetch LinkedIn experience for ${username}:`,
      error
    );
    return null;
  }
}

export async function fetchLinkedInProfileUsingOpenai(
  user: UserData
): Promise<string | null> {
  try {
    const prompt = `Find the LinkedIn profile URL for ${
      user.name || user.login
    } (Software Engineer).
  Use the following information for disambiguation if multiple profiles are found:
  ${user.email ? `- Email: ${user.email}` : ""}
  ${user.xBio || user.bio ? `- Bio hints: ${user.xBio || user.bio}` : ""}
  Return ONLY the full LinkedIn profile URL. If you cannot confidently identify the correct profile, return null.`;

    const response = await openai.responses.create({
      model: "gpt-4.1",
      tools: [
        {
          type: "web_search_preview",
          search_context_size: "medium",
          user_location: {
            type: "approximate" as const,
            country: "US",
            region: "CA",
            city: "San Francisco",
          },
        },
      ],
      input: prompt,
    });

    console.log("fetchLinkedInProfile response", response);

    const result = response.output_text?.trim() || null;
    return result === "null" ? null : result;
  } catch (error) {
    console.error(`Error fetching LinkedIn profile for ${user.login}:`, error);
    return null;
  }
}

export async function fetchLinkedInProfileUsingGemini(
  user: UserData
): Promise<string | null> {
  const promptText = `Find the LinkedIn profile URL for ${
    user.name || user.login
  } (Software Engineer).
Use the following information for disambiguation if multiple profiles are found:
${user.email ? `- Email: ${user.email}` : ""}
${user.xBio || user.bio ? `- Bio hints: ${user.xBio || user.bio}` : ""}
Return ONLY the full LinkedIn profile URL. If you cannot confidently identify the correct profile, return null.`;

  try {
    if (!process.env.GOOGLE_API_KEY) {
      console.error(
        "Error: GOOGLE_API_KEY is not set. Please set this environment variable."
      );
      return null;
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
        process.env.GOOGLE_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // System instruction might not be available or needed for all Gemini models/tasks
          // If it causes issues or isn't desired for this specific profile lookup, it can be removed.
          system_instruction: {
            parts: [
              {
                text: "You are an assistant that finds LinkedIn profile URLs.",
              },
            ],
          },
          contents: [
            {
              parts: [{ text: promptText }],
            },
          ],
          tools: [
            // Ensuring the tool for web search is included
            {
              google_search: {}, // Using google_search as per the web-research.ts example
            },
          ],
          generationConfig: {
            // Adding generationConfig to try and get plain text
            response_mime_type: "text/plain",
          },
        }),
      }
    );

    console.log("fetchLinkedInProfileUsingGemini response", response);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(
        "Google API Error in fetchLinkedInProfileUsingGemini:",
        response.status,
        errorBody
      );
      return null; // Return null on API error
    }

    const completion = await response.json(); // Assuming response is JSON, adjust if plain text

    // Based on web-research.ts, the structure might be nested.
    // The direct text might be in response.text() if response_mime_type: "text/plain" works as expected.
    // If response is JSON (default for generateContent), then parse parts.
    let resultText = "";
    if (
      completion.candidates &&
      completion.candidates[0] &&
      completion.candidates[0].content &&
      completion.candidates[0].content.parts &&
      completion.candidates[0].content.parts[0]
    ) {
      resultText = completion.candidates[0].content.parts[0].text;
    } else if (typeof completion === "string") {
      // Fallback if response_mime_type: "text/plain" returns direct string
      resultText = completion;
    } else {
      console.error(
        "Unexpected response structure from Gemini API in fetchLinkedInProfileUsingGemini:",
        JSON.stringify(completion, null, 2)
      );
      return null;
    }

    const result = resultText.trim();

    console.log("fetchLinkedInProfile (Gemini) response raw text:", result);

    if (
      result === "null" ||
      result === "" ||
      !result.includes("linkedin.com")
    ) {
      return null;
    }
    return result;
  } catch (error) {
    console.error(
      `Error fetching LinkedIn profile with Gemini for ${user.login}:`,
      error
    );
    return null;
  }
}

// Define Perplexity response structure based on the provided snippet
interface PerplexityMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface PerplexityChoice {
  index: number;
  message: PerplexityMessage;
  finish_reason?: string; // Optional, as it might not always be present or needed
}

interface PerplexityResponse {
  id?: string; // Optional fields based on typical API responses
  model?: string;
  object?: string;
  created?: number;
  choices: PerplexityChoice[];
  usage?: unknown; // Define more specifically if needed
}

export async function fetchLinkedInProfileUsingPerplexity(
  user: UserData
): Promise<string | null> {
  const question = `Find the LinkedIn profile URL for ${
    user.name || user.login
  } (Software Engineer).
Use the following information for disambiguation if multiple profiles are found:
${user.email ? `- Email: ${user.email}` : ""}
${user.xBio || user.bio ? `- Bio hints: ${user.xBio || user.bio}` : ""}
Return ONLY the full LinkedIn profile URL as a string.`;

  const SYSTEM_PROMPT = `You are an expert assistant specialized in finding LinkedIn profile URLs using web search. You only return the URL as a string, or the string "null" if no suitable profile is found.`;

  console.log("fetchLinkedInProfileUsingPerplexity question", question);

  try {
    if (!process.env.PERPLEXITY_API_KEY) {
      console.error(
        "Error: PERPLEXITY_API_KEY is not set. Please set this environment variable."
      );
      return null;
    }

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: question,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Perplexity API Error:", response.status, errorBody);
      return null;
    }

    const completion = (await response.json()) as PerplexityResponse;
    console.log(
      "fetchLinkedInProfile (Perplexity) raw completion:",
      JSON.stringify(completion, null, 2)
    );

    if (
      completion.choices &&
      completion.choices.length > 0 &&
      completion.choices[0].message &&
      completion.choices[0].message.content
    ) {
      const resultText = completion.choices[0].message.content.trim();
      console.log("fetchLinkedInProfile (Perplexity) result text:", resultText);
      if (
        resultText.toLowerCase() === "null" ||
        !resultText.includes("linkedin.com")
      ) {
        return null;
      }
      return resultText;
    } else {
      console.error(
        "Invalid or empty response from Perplexity API:",
        completion
      );
      return null;
    }
  } catch (error) {
    console.error(
      `Error fetching LinkedIn profile with Perplexity for ${user.login}:`,
      error
    );
    return null;
  }
}

interface BraveSearchResult {
  title: string;
  url: string;
  description?: string;
}

interface BraveSearchResponse {
  query: {
    original: string;
  };
  web?: {
    results: BraveSearchResult[];
  };
}

export async function fetchLinkedInProfileUsingBrave(
  user: UserData,
  optimizedQuery?: string
): Promise<string | null> {
  const searchQuery = optimizedQuery
    ? `site:linkedin.com/in/ ${optimizedQuery}`
    : `site:linkedin.com/in/ ${user.name || user.login} ${
        user.email ? `email:${user.email}` : ""
      } ${user.xBio || user.bio || ""} (Software Engineer)`;

  console.log("fetchLinkedInProfileUsingBrave searchQuery", searchQuery);

  try {
    if (!process.env.BRAVE_API_KEY) {
      console.error(
        "Error: BRAVE_API_KEY is not set. Please set this environment variable."
      );
      return null;
    }

    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
        searchQuery
      )}&count=5&safesearch=moderate`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": process.env.BRAVE_API_KEY,
        },
      }
    );

    // console.log("Brave Search Response:", response);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Brave API Error:", response.status, errorBody);
      return null;
    }

    const data = (await response.json()) as BraveSearchResponse;
    // console.log("Brave Search Response:", JSON.stringify(data, null, 2));

    // Look for LinkedIn profile URLs in the results
    if (data.web?.results) {
      for (const result of data.web.results) {
        if (result.url.includes("linkedin.com/in/")) {
          // Extract the LinkedIn profile URL
          const linkedinUrl = result.url.split("?")[0]; // Remove any query parameters
          console.log("Found LinkedIn URL:", linkedinUrl);
          return linkedinUrl;
        }
      }
    }

    console.log("No LinkedIn profile found in Brave search results");
    return null;
  } catch (error) {
    console.error(
      `Error fetching LinkedIn profile with Brave for ${user.login}:`,
      error
    );
    return null;
  }
}

export async function generateLinkedInExperienceSummary(
  experience: LinkedInProfile
): Promise<string | null> {
  if (
    !experience ||
    !experience.fullPositions ||
    experience.fullPositions.length === 0
  ) {
    return null;
  }

  let summary = "";
  // Sort positions by end date (most recent first), handling null end dates (current positions)
  const sortedPositions = [...experience.fullPositions].sort((a, b) => {
    const endA = a.end?.year ?? Infinity;
    const endB = b.end?.year ?? Infinity;
    if (endA !== endB) return endB - endA; // Most recent year first
    // If years are the same (or both are current), sort by start year (most recent first)
    const startA = a.start?.year ?? -Infinity;
    const startB = b.start?.year ?? -Infinity;
    return startB - startA;
  });

  for (const position of sortedPositions) {
    const startDate = position.start
      ? `${position.start.month}/${position.start.year}`
      : "N/A";
    const endDate = position.end
      ? `${position.end.month}/${position.end.year}`
      : "Present";
    const durationStr = `${startDate} - ${endDate}`;

    summary += `Title: ${position.title} (${durationStr})\n`;
    summary += `Company: ${position.companyName}\n`;
    if (position.location) {
      summary += `Location: ${position.location}\n`;
    }
    if (position.description) {
      const cleanedDescription = position.description
        .replace(/\n+/g, "\n")
        .replace(/^/gm, "  ");
      summary += `Description:\n${cleanedDescription}\n`;
    }
    summary += "---\n";
  }

  return summary.trim() ? summary.trim() : null;
}

export async function generateOptimizedSearchQuery(
  user: DbGraphUser
): Promise<string> {
  const prompt = `You are a skilled detective specializing in finding people's LinkedIn profiles of Software Engineers. Your task is to craft the perfect search query that will lead us to the correct LinkedIn profile.

You have access to various clues about the person:
- Their GitHub username and display name
- Their email address (which might contain their full name)
- Their bio and social media presence
- Their current and past roles

Your mission is to combine these clues into a precise search query that will help us find their LinkedIn profile. Think like a detective - what unique combinations of information would make this person stand out in a search?

Here are some examples of how you've solved similar cases:

Case 1:
Clues:
- Name: Aman Karmani
- Email: aman@tmm1.net
- Bio: building Cursor @anysphere. full stack tinkerer and perf nerd. formerly vp of infra @github + ruby-core committer. founder @getchannels + ffmpeg committer.

Your Solution: "Aman Karmani Cursor VP infra Github"
Reasoning: Combined their full name with their current role at Cursor and their notable position at GitHub to create a unique identifier.

Case 2:
Clues:
- Name: JannikSt
- Email: info@jannik-straube.de
- Bio: Software Engineer

Your Solution: "Jannik Straube Software Engineer"
Reasoning: Extracted their full name from the email since the GitHub username was incomplete, and added their role for context.

Current Case:
Clues:
- Name: ${user.name || user._id}
- Email: ${user.email || "Not provided"}
- Bio: ${user.bio || "Not provided"}
- X Bio: ${user.xBio || "Not provided"}

What's your search query, detective?`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    return response.choices[0]?.message?.content?.trim() || "";
  } catch (error) {
    console.error("Error generating optimized search query:", error);
    return "";
  }
}

export function findLinkedInUrlInProfileData(user: UserData): string | null {
  // Check blog field first
  if (user.blog && isLinkedInDomain(user.blog)) {
    return user.blog;
  }

  // Check profile readme for LinkedIn URLs
  if (user.profileReadme) {
    // Look for common LinkedIn URL patterns in the readme
    const linkedinPatterns = [
      /https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9-]+/g,
      /https?:\/\/(?:www\.)?linkedin\.com\/profile\/[a-zA-Z0-9-]+/g,
      /https?:\/\/lnkd\.in\/[a-zA-Z0-9-]+/g,
    ];

    for (const pattern of linkedinPatterns) {
      const matches = user.profileReadme.match(pattern);
      if (matches && matches.length > 0) {
        // Return the first match, removing any query parameters
        return matches[0].split("?")[0];
      }
    }
  }

  return null;
}

// Script execution part
if (import.meta.url === `file://${process.argv[1]}`) {
  // Guard to run only when executed directly
  (async () => {
    // The username is derived from the URL: and https://www.linkedin.com/in/banisgh/
    const targetUsername = "banisgh";

    console.log(
      `Fetching LinkedIn profile data for username (RapidAPI): ${targetUsername}...`
    );
    const profileDataRapidAPI = await fetchLinkedInExperienceViaRapidAPI(
      targetUsername
    );

    if (profileDataRapidAPI) {
      console.log("Successfully fetched LinkedIn Profile Data (RapidAPI):");
      // Optionally, you might want to see the data when run directly:
      // console.log(JSON.stringify(profileDataRapidAPI, null, 2));
    } else {
      console.log(
        `Could not fetch LinkedIn profile data via RapidAPI for ${targetUsername}.`
      );
    }
  })();
}

// To run this script, you might need ts-node:
// ... existing code ...
