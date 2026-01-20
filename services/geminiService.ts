
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

const ALL_KEYS = [
  "AIzaSyDlqh2BVvo_qJ8KNcVKiZ-9OdNynnc8884",
  "AIzaSyCoD2B_VVKzZJCNl-RqBJy6SanQnX2lo0U",
  "AIzaSyBQIJnnAhffFJi1OMDshziXWIPwdZdWpOA",
  "AIzaSyDRM25nu8rhmRhDcSXu19_KhYV9UdouL30",
  "AIzaSyBjERleirTQHkeRexCx779DVtcaIeL1X4s",
  "AIzaSyBvLjurH8MNnP10lhvaFgOtN-wAh82BV2c",
  "AIzaSyBp-yrKVpHmoXaxz37pMqTjHmGUjTLbDmw",
  "AIzaSyBpBD-Npf2VGdckZsrq19bsW3MthUN-fi0",
  "AIzaSyCHIfB4f2g_tzX8mYqR0zSYrkGK4vF8P6c",
  "AIzaSyC8ODkt-eweiL9ol-3nLvmyoPmEVifGmHk",
  "AIzaSyBmtmNqfbkBIPCcz_gYiRnTymazGbu0_qE",
  "AIzaSyBaYnPYtCsOfHWSjbqrjGRhFH7giIAaH6g",
  "AIzaSyDxusDolkZeVHANlilKkw-pCykPD3xfyoI",
  "AIzaSyCzgdnMJnVKNFEouSdBVRpLJYNMj9UZusk"
];

const LAST_KEY_STORAGE = "last_used_gemini_key_v2";
const FAILED_KEYS_IN_SESSION = new Set<string>();

/**
 * Lấy API Key thông minh:
 * 1. Loại bỏ các key bị lỗi trong phiên làm việc.
 * 2. Loại bỏ key vừa sử dụng gần nhất (từ localStorage).
 * 3. Chọn ngẫu nhiên 1 key trong danh sách còn lại.
 */
function getSmartApiKey(): string {
  const lastUsed = localStorage.getItem(LAST_KEY_STORAGE);
  
  // Lọc lấy những key chưa bị lỗi
  let healthyKeys = ALL_KEYS.filter(k => !FAILED_KEYS_IN_SESSION.has(k));
  
  // Nếu tất cả các key đều bị đánh dấu lỗi, reset danh sách lỗi để thử lại
  if (healthyKeys.length === 0) {
    FAILED_KEYS_IN_SESSION.clear();
    healthyKeys = [...ALL_KEYS];
  }

  // Lọc bỏ key vừa dùng ở lần yêu cầu trước đó
  let candidates = healthyKeys.filter(k => k !== lastUsed);
  
  // Nếu chỉ còn 1 key và nó trùng với key cũ, buộc phải dùng tiếp
  if (candidates.length === 0) candidates = healthyKeys;

  // Chọn ngẫu nhiên
  const pickedKey = candidates[Math.floor(Math.random() * candidates.length)];
  
  // Lưu lại để lần sau không trùng
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
        if (Math.random() < (settings.stutterRate / 200)) { 
            const words = processedSentence.split(' ');
            if (words.length > 3) {
                const idx = Math.floor(Math.random() * Math.min(words.length, 3));
                words[idx] = `${words[idx]}... ${words[idx]}`;
                processedSentence = words.join(' ');
            }
        }
        
        const speedRange = settings.speedVariation / 100;
        const baseRate = parseFloat(personaRate);
        const randomSpeed = (baseRate + (Math.random() * speedRange * 0.2 - (speedRange * 0.1))).toFixed(2);
        
        let pause = "";
        if (index > 0) {
            let waitTime = settings.waitDuration === 'long' ? 1000 : (settings.waitDuration === 'random' ? Math.floor(Math.random() * 600 + 200) : 400);
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
    const systemPrompt = `ACT AS: ${persona.name}. STYLE: ${persona.style}. 
    MANDATORY: Pronounce 100% of the words provided in the SSML. Do NOT skip, summarize, or edit any words. 
    TEXT TO SPEAK: ${humanized.ssml}`;

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
        // Nếu lỗi do giới hạn hoặc key chết, đưa vào danh sách đen của phiên này
        if (errorMsg.includes("429") || errorMsg.includes("quota") || errorMsg.includes("API key not valid")) {
            FAILED_KEYS_IN_SESSION.add(currentApiKey);
        }
        console.warn(`API Error with key ${currentApiKey.substring(0, 8)}...:`, errorMsg);
        await new Promise(r => setTimeout(r, 1000));
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
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 800));
  }

  if (results.length === 0) throw new Error("Không thể tạo dữ liệu âm thanh sau nhiều lần thử với các API Key khác nhau.");
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
