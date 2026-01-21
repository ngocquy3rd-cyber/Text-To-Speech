
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
  "AIzaSyBp-yrKVpHmoXaxz37pMqTjHmGUjTLbDmw",
  "AIzaSyCHIfB4f2g_tzX8mYqR0zSYrkGK4vF8P6c",
  "AIzaSyC8ODkt-eweiL9ol-3nLvmyoPmEVifGmHk",
  "AIzaSyBmtmNqfbkBIPCcz_gYiRnTymazGbu0_qE",
  "AIzaSyBaYnPYtCsOfHWSjbqrjGRhFH7giIAaH6g",
  "AIzaSyDxusDolkZeVHANlilKkw-pCykPD3xfyoI",
  "AIzaSyCzgdnMJnVKNFEouSdBVRpLJYNMj9UZusk"
];

const LAST_KEY_STORAGE = "last_used_gemini_key_v12_8";
// Chuyển sang Map để lưu thời điểm Key bị lỗi, cho phép hồi phục sau 45 giây
const FAILED_KEYS_TIMESTAMP = new Map<string, number>();
const RECOVERY_TIME_MS = 45000; 

function getSmartApiKey(): string {
  const now = Date.now();
  const lastUsed = localStorage.getItem(LAST_KEY_STORAGE);
  
  // Lọc các key khỏe mạnh (không lỗi hoặc đã quá thời gian hồi phục)
  let healthyKeys = ALL_KEYS.filter(k => {
    const errorTime = FAILED_KEYS_TIMESTAMP.get(k);
    if (!errorTime) return true;
    return (now - errorTime) > RECOVERY_TIME_MS;
  });
  
  // Nếu tất cả đều "ốm", lấy toàn bộ danh sách để thử vận may
  if (healthyKeys.length === 0) {
    healthyKeys = [...ALL_KEYS];
  }

  // Loại bỏ key vừa dùng ở lần ngay trước đó nếu có thể
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
    NO SUMMARIZATION. 1:1 TRANSCRIPT TO SPEECH ONLY.
    TEXT: ${humanized.ssml}`;

    // Tăng số lần thử lại lên 10 để bao phủ hết 8 key và có độ trễ
    const MAX_ATTEMPTS = 10;
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
        
        // Thành công: Xóa khỏi danh sách lỗi nếu có
        FAILED_KEYS_TIMESTAMP.delete(currentApiKey);
        
        return {
          index,
          audio: audioBytes,
          metadata: { text: chunk, durationMs: (audioBytes.length / 48000) * 1000 }
        };
      } catch (error: any) {
        const errorMsg = error?.message || "";
        console.warn(`Attempt ${attempt+1} failed with key ${currentApiKey.substring(0,6)}: ${errorMsg}`);
        
        // Đánh dấu lỗi kèm timestamp
        FAILED_KEYS_TIMESTAMP.set(currentApiKey, Date.now());

        // Nghỉ tăng dần (exponential backoff) để API hồi phục
        const delay = Math.min(1000 * (attempt + 1), 5000);
        await new Promise(r => setTimeout(r, delay));
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
    
    if (res) {
        results.push(res);
    } else {
        // Nếu một đoạn thất bại hoàn toàn sau 10 lần thử, chúng ta dừng cả tiến trình
        throw new Error(`Broadcast Interrupted: Đoạn thứ ${i+1} không thể xử lý sau nhiều lần thử lại. Hãy kiểm tra kết nối mạng hoặc thử lại sau ít phút.`);
    }

    if (params.onProgress) params.onProgress(Math.round(((i + 1) / chunks.length) * 100));
    
    // Nghỉ cố định 1s giữa các đoạn để tránh hit Rate Limit quá nhanh
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 1200));
  }

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
