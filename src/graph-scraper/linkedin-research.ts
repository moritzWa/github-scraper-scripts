import dotenv from "dotenv"; // Corrected dotenv import
dotenv.config(); // Load environment variables at the very top

// It's a good practice to load environment variables from a .env file for local development
// The lines below can be removed or kept commented as dotenv is now configured above
// import *dotenv* from 'dotenv';
// dotenv.config();

import { UserData } from "../types.js";
import openai from "./openai.js"; // Import the shared OpenAI client

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
const EXAMPLE_API_KEY = "0d3445840fmshb924d806f5383bdp122411jsn444d71ae4cf7"; // Replace with your key

// $175/month for up to 50k requests
export async function fetchLinkedInExperienceViaRapidAPI(
  url: string
): Promise<LinkedInProfile | null> {
  const apiKey = process.env.RAPIDAPI_KEY || EXAMPLE_API_KEY;

  if (apiKey === EXAMPLE_API_KEY) {
    console.warn(
      "Warning: Using example RapidAPI key. Please set your RAPIDAPI_KEY environment variable for reliable use."
    );
  }
  if (!apiKey) {
    console.error(
      "Error: RAPIDAPI_KEY is not set. Please set this environment variable."
    );
    return null;
  }

  // https://www.linkedin.com/in/banisgh/
  // https://www.linkedin.com/in/sigil/

  const username = url.split("/in/")[1];

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

    const data: LinkedInProfile = await response.json();
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
    } (Software Engineer)${
      user.email ? ` (email for disambiguation: ${user.email})` : ""
    }. ${user.xBio || user.bio ? "Their bio reads:" : ""} ${
      user.xBio ? user.xBio : user.bio ? user.bio : ""
    }. Return ONLY the full LinkedIn profile URL. If you cannot find the LinkedIn profile, return null.`;

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
  for (const position of experience.fullPositions) {
    summary += `Title: ${position.title}\n`;
    summary += `Company: ${position.companyName}\n`;
    if (position.location) {
      summary += `Location: ${position.location}\n`;
    }
    if (position.description) {
      // Replace multiple newlines with a single one, then indent description
      const cleanedDescription = position.description
        .replace(/\n+/g, "\n")
        .replace(/^/gm, "  ");
      summary += `Description:\n${cleanedDescription}\n`;
    }
    summary += "---\n";
  }

  return summary.trim() ? summary.trim() : null;
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
