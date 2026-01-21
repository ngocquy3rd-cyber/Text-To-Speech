
import { GoogleGenAI, Modality } from "@google/genai";
import { base64ToUint8Array } from "../utils/audioUtils";

export interface BioSettings {
  stutterRate: number;      
  breathIntensity: 'soft' | 'loud' | 'none';
  fillerRate: number;       
  volumeVariation: number;  
  speedVariation: number;   
  asymmetry: boolean;
  ambientSounds: boolean;   
  waitDuration: 'natural' | 'long' | 'random';
}

interface GenerateSpeechParams {
  text: string;
  isSSML: boolean;
  settings: BioSettings;
  onProgress?: (percentage: number) => void;
}

export interface AudioChunkMetadata {
  text: string;
  durationMs: number;
}

export interface GeneratedSpeechResult {
  audioData: Uint8Array;
  metadata: AudioChunkMetadata[];
}

// Danh sách 8 API Key mới cung cấp cho bản v12.7
const ALL_KEYS = [
  "AIzaSyDlqh2BVvo_qJ8KNcVKiZ-9OdNynnc8884",
  "AIzaSyBp-yrKVpHmoXaxz37pMqTjHmGUjTLbDmw",
  "AIzaSyCHIfB4f2g_tzX8mYqR0zSYrkGK4vF8P6c",
  "AIzaSyC8ODkt-eweiL9ol-3nLvmyoPmEVifGmHk",
  "AIzaSyBmtmNqfbkBIPCcz_gYiRnTymazGbu0_qE",
  "AIzaSyBaYnPYtCsOfHWSjbqrjGRhFH7giIAaH6g",
  "AIzaSyDxusDolkZeVHANlilKkw-pCykPD3xfyoI",
  "AIzaSyCzgdnMJnVKNFEouSdBVRpLJYNMj9UZusk"
];

const LAST_KEY_STORAGE = "last_used_gemini_key_v12_7";
const FAILED_KEYS_IN_SESSION = new Set<string>();

/**
 * Smart API Rotation v12.7:
 * - Ưu tiên các key chưa lỗi.
 * - Không dùng lại key vừa dùng ở request trước đó.
 * - Chọn ngẫu nhiên để phân phối tải đều.
 */
function getSmartApiKey(): string {
  const lastUsed = localStorage.getItem(LAST_KEY_STORAGE);
  let healthyKeys = ALL_KEYS.filter(k => !FAILED_KEYS_IN_SESSION.has(k));
  
  if (healthyKeys.length === 0) {
    FAILED_KEYS_IN_SESSION.clear();
    healthyKeys = [...ALL_KEYS];
  }

  let candidates = healthyKeys.filter(k => k !== lastUsed);
  if (candidates.length === 0) candidates = healthyKeys;

  const pickedKey = candidates[Math.floor(Math.random() * candidates.length)];
  localStorage.setItem(LAST_KEY_STORAGE, pickedKey);
  return pickedKey;
}

const ABSOLUTE_MAX_CHARS = 250;

const NEWS_PERSONAS = [
  { id: 'Kore', name: 'Elite Anchor (Fast)', style: 'High energy, fast-paced breaking news.', rate: "1.15" },
  { id: 'Zephyr', name: 'Prime Time News', style: 'Steady, authoritative, deep resonance.', rate: "1.02" },
  { id: 'Kore', name: 'Global Correspondent', style: 'Clear, articulate, formal tone.', rate: "1.08" },
  { id: 'Zephyr', name: 'Morning Briefing', style: 'Cheerful, lighter, engaging.', rate: "1.10" },
  { id: 'Kore', name: 'Late Night Report', style: 'Serious, calm, slow delivery.', rate: "0.95" },
  { id: 'Zephyr', name: 'Financial Desk', style: 'Precise, fast, information-dense.', rate: "1.12" },
  { id: 'Kore', name: 'Investigative News', style: 'Intense, whispered dynamics, dramatic.', rate: "1.00" },
  { id: 'Zephyr', name: 'Weather & Traffic', style: 'Rapid fire, energetic, high pitch.', rate: "1.18" }
];

function humanizeText(text: string, settings: BioSettings, personaRate: string): { ssml: string, plain: string } {
    const sentences = text.match(/[^.!?\n]+[.!?\n]*(\s+|$)/g) || [text];
    let richSSML = `<speak>`;
    let plainSynthesized = "";
    
    sentences.forEach((sentence, index) => {
        let processedSentence = sentence.trim();
        if (Math.random() < (settings.stutterRate / 250)) { 
            const words = processedSentence.split(' ');
            if (words.length > 4) {
                const idx = Math.floor(Math.random() * Math.min(words.length, 3));
                words[idx] = `${words[idx]}... ${words[idx]}`;
                processedSentence = words.join(' ');
            }
        }
        
        const speedRange = settings.speedVariation / 100;
        const baseRate = parseFloat(personaRate);
        const randomSpeed = (baseRate + (Math.random() * speedRange * 0.15 - (speedRange * 0.07))).toFixed(2);
        
        let pause = "";
        if (index > 0) {
            let waitTime = settings.waitDuration === 'long' ? 1000 : (settings.waitDuration === 'random' ? Math.floor(Math.random() * 500 + 200) : 400);
            pause = `<break time="${waitTime}ms"/>`;
        }
        
        richSSML += `${pause}<prosody volume="medium" rate="${randomSpeed}">${processedSentence}</prosody>`;
        plainSynthesized += (plainSynthesized ? " " : "") + processedSentence;
    });
    richSSML += `</speak>`;
    return { ssml: richSSML, plain: plainSynthesized };
}

async function processWithRetry(
  chunk: string, 
  persona: typeof NEWS_PERSONAS[0], 
  index: number,
  settings: BioSettings
): Promise<{ index: number; audio: Uint8Array; metadata: AudioChunkMetadata } | null> {
    const humanized = humanizeText(chunk, settings, persona.rate);
    const systemPrompt = `YOU ARE A PROFESSIONAL BROADCASTER: ${persona.name}. 
    MANDATORY RULE: Pronounce EVERY SINGLE WORD in the provided text. 
    DO NOT skip any adjectives or content. 
    NO SUMMARIZATION. 1:1 TRANSCRIPT TO SPEECH ONLY.
    TEXT: ${humanized.ssml}`;

    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const currentApiKey = getSmartApiKey();
      try {
        const ai = new GoogleGenAI({ apiKey: currentApiKey });
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: systemPrompt }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: persona.id },
              },
            },
          },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) throw new Error("API_NO_DATA");
        
        const audioBytes = base64ToUint8Array(base64Audio);
        return {
          index,
          audio: audioBytes,
          metadata: { text: chunk, durationMs: (audioBytes.length / 48000) * 1000 }
        };
      } catch (error: any) {
        const errorMsg = error?.message || "";
        if (errorMsg.includes("429") || errorMsg.includes("quota") || errorMsg.includes("key not valid")) {
            FAILED_KEYS_IN_SESSION.add(currentApiKey);
        }
        await new Promise(r => setTimeout(r, 800));
      }
    }
    return null;
}

export async function generateSpeech(params: GenerateSpeechParams): Promise<GeneratedSpeechResult> {
  const chunks = splitTextIntoSpeakerTurns(params.text);
  const results: { index: number; audio: Uint8Array; metadata: AudioChunkMetadata }[] = [];
  const personas = [...NEWS_PERSONAS].sort(() => Math.random() - 0.5);
  
  for (let i = 0; i < chunks.length; i++) {
    const persona = personas[i % personas.length];
    const res = await processWithRetry(chunks[i], persona, i, params.settings);
    if (res) results.push(res);
    if (params.onProgress) params.onProgress(Math.round(((i + 1) / chunks.length) * 100));
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 600));
  }

  if (results.length === 0) throw new Error("Broadcast Failed: All API keys exhausted or network error. Please check your connections.");
  results.sort((a, b) => a.index - b.index);
  const totalByteLength = results.reduce((acc, r) => acc + r.audio.length, 0);
  const combinedAudio = new Uint8Array(totalByteLength);
  let currentOffset = 0;
  for (const res of results) {
    combinedAudio.set(res.audio, currentOffset);
    currentOffset += res.audio.length;
  }
  return { audioData: combinedAudio, metadata: results.map(r => r.metadata) };
}

function splitTextIntoSpeakerTurns(text: string): string[] {
    const sentences = text.match(/[^.!?\n]+[.!?\n]*(\s+|$)/g) || [text];
    const chunks: string[] = [];
    let currentChunk = "";
    sentences.forEach(s => {
        const trimmedS = s.trim();
        if (!trimmedS) return;
        if ((currentChunk.length + trimmedS.length > ABSOLUTE_MAX_CHARS) && currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = trimmedS;
        } else {
            currentChunk += (currentChunk ? " " : "") + trimmedS;
        }
    });
    if (currentChunk.trim()) chunks.push(currentChunk.trim());
    return chunks;
}
