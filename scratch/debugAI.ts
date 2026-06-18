import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function debugAI() {
  const apiKey = process.env.VITE_GEMINI_API_KEY;
  const ai = new GoogleGenAI({ apiKey });
  console.log("AI Models methods:", Object.getOwnPropertyNames((ai as any).models));
  console.log("AI prototype:", Object.getOwnPropertyNames(Object.getPrototypeOf(ai)));
}

debugAI();
