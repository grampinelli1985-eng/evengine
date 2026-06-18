import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function testCall() {
  const apiKey = process.env.VITE_GEMINI_API_KEY;
  const ai = new GoogleGenAI({ apiKey });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: "Hello!" }] }],
      config: {
        systemInstruction: "You are a helpful assistant."
      }
    });
    console.log("Success!");
    console.log(response.text);
  } catch (error) {
    console.error("Failed:", error);
  }
}

testCall();
