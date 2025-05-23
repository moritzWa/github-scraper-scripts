import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

if (!process.env.OPENAI_API_KEY) {
  console.error(
    "OpenAIError: The OPENAI_API_KEY environment variable is missing or empty; " +
      "either provide it, or instantiate the OpenAI client with an apiKey option, " +
      "like new OpenAI({ apiKey: 'My API Key' })."
  );
  // Potentially throw an error here or exit, depending on desired behavior
  // For now, we'll log and proceed, which might lead to runtime errors if the key is truly needed immediately.
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // This will be undefined if not set, OpenAI constructor handles it
});

export default openai;
