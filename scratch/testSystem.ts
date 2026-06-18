import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function testSystemInstruction() {
  const apiKey = process.env.VITE_GEMINI_API_KEY;
  const ai = new GoogleGenAI({ apiKey });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: "Hello!" }] }],
      config: {
        systemInstruction: "You are a pirate. Always respond with 'Arrgh!' at the beginning."
      }
    });
    console.log("Response text:");
    console.log(response.text);
    if (response.text.includes("Arrgh")) {
      console.log("SYSTEM INSTRUCTION WORKED!");
    } else {
      console.log("SYSTEM INSTRUCTION FAILED!");
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

testSystemInstruction();
