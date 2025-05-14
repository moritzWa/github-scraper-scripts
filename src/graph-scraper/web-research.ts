import { UserData } from "../types.js";
import openai from "./openai.js";

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

export const webResearchInfoPrompt = (user: UserData, email?: string | null) =>
  `Find key information about ${user.name || user.login} (Software Engineer)${
    email ? ` (email for disambiguation: ${email})` : ""
  }. ${user.xBio || user.bio ? "Their bio reads:" : ""} ${
    user.xBio ? user.xBio : user.bio ? user.bio : ""
  }${
    user.blog ? `Blog is: ${user.blog}` : ""
  }. Focus on most recent job/company experience, interests, and current role. Return null if no additional information found. Max 150 words.`;

export async function getWebResearchInfoOpenAI(
  user: UserData,
  email?: string | null
): Promise<{ promptText: string; researchResult: string | null }> {
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
    const result = response.output_text?.trim();
    return {
      promptText,
      researchResult: result && result !== "null" ? result : null,
    };
  } catch (error) {
    console.error("Error performing OpenAI web research:", error);
    return {
      promptText,
      researchResult: null,
    };
  }
}

export async function getWebResearchInfoGemini(
  user: UserData,
  email?: string | null
): Promise<{ promptText: string; researchResult: string | null }> {
  const promptText = webResearchInfoPrompt(user, email);
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=" +
        process.env.GOOGLE_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: promptText }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            topP: 0.8,
            topK: 40,
          },
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
        researchResult: null,
      };
    }

    const geminiResult = candidate.content.parts
      .map((part: GooglePart) => part.text)
      .join("\n")
      .trim();

    return {
      promptText,
      researchResult:
        geminiResult && geminiResult !== "null" ? geminiResult : null,
    };
  } catch (error) {
    console.error("Error performing Gemini web research:", error);
    return {
      promptText,
      researchResult: null,
    };
  }
}
