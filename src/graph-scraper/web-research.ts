import OpenAI from "openai";
import { UserData } from "../types.js";

interface GooglePart {
  text: string;
}

interface GoogleCandidate {
  content?: {
    parts: GooglePart[];
    role?: string;
  };
  // We are ignoring groundingMetadata for now
}

interface GoogleResponse {
  candidates?: GoogleCandidate[];
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const webResearchInfoPrompt = (user: UserData, email?: string | null) =>
  `In a few bullet points tell me more about the background and skills of ${
    user.name || user.login
  } (Software Engineer)${
    email ? ` (email for disambiguation: ${email})` : ""
  }. ${user.xBio || user.bio ? "Their bio reads:" : ""} ${
    user.xBio ? user.xBio : user.bio ? user.bio : ""
  }${
    user.blog ? `Blog is: ${user.blog}` : ""
  }. Focus on most recent job/company experience (i.e. which specific copanies and roles they had most recently), interests, and current role.  No need for complete sentences. Max 250 words.`;

export async function getWebResearchInfoOpenAI(
  user: UserData,
  email?: string | null
): Promise<{ promptText: string; researchResult: string }> {
  const promptText = webResearchInfoPrompt(user, email);
  try {
    const response = await openai.responses.create({
      model: "gpt-4o",
      tools: [
        {
          type: "web_search_preview",
          search_context_size: "medium",
        },
      ],
      input: promptText,
    });
    return {
      promptText,
      researchResult:
        response.output_text || "No additional information found (OpenAI).",
    };
  } catch (error) {
    console.error("Error performing OpenAI web research:", error);
    return {
      promptText,
      researchResult: "No additional information found (OpenAI).",
    };
  }
}

export async function getWebResearchInfoGemini(
  user: UserData,
  email?: string | null
): Promise<{ promptText: string; researchResult: string }> {
  const promptText = webResearchInfoPrompt(user, email);
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
        process.env.GOOGLE_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [
              {
                text: "You are a helpful assistant performing web research to find background and skills information about a software engineer.",
              },
            ],
          },
          contents: [
            {
              parts: [{ text: promptText }],
            },
          ],
          tools: [
            {
              google_search: {},
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Google API Error:", response.status, errorBody);
      throw new Error(
        `Google API request failed with status ${response.status}`
      );
    }

    const completion = (await response.json()) as GoogleResponse;
    const candidate = completion.candidates?.[0];

    if (!candidate?.content?.parts) {
      console.error(
        "Bad completion from Google API",
        JSON.stringify(completion, null, 2)
      );
      return {
        promptText,
        researchResult: "No additional information found (Gemini).",
      };
    }

    const geminiResult = candidate.content.parts
      .map((part: GooglePart) => part.text)
      .join("\n");
    return {
      promptText,
      researchResult:
        geminiResult || "No additional information found (Gemini).",
    };
  } catch (error) {
    console.error("Error performing Gemini web research:", error);
    return {
      promptText,
      researchResult: "No additional information found (Gemini).",
    };
  }
}
