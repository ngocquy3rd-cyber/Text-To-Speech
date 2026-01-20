
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

// Danh sách tất cả API Keys mới của bạn
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

const LAST_KEY_STORAGE = "last_used_gemini_key";
const FAILED_KEYS = new Set<string>();

/**
 * Lấy API Key thông minh:
 * 1. Không dùng lại key vừa dùng lần cuối (lưu trong localStorage)
 * 2. Tránh các key đã bị lỗi (FAILED_KEYS)
 * 3. Chọn ngẫu nhiên từ những key còn lại
 */
function getSmartApiKey(): string {
  const lastUsed = localStorage.getItem(LAST_KEY_STORAGE);
  
  // Lọc ra các key khả dụng (không nằm trong danh sách lỗi)
  let availableKeys = ALL_KEYS.filter(k => !FAILED_KEYS.has(k));
  
  // Nếu tất cả các key đều bị đánh dấu lỗi (có thể do IP bị chặn), reset danh sách lỗi để thử lại
  if (availableKeys.length === 0) {
    FAILED_KEYS.clear();
    availableKeys = [...ALL_KEYS];
  }

  // Cố gắng loại trừ key vừa dùng gần nhất nếu còn lựa chọn khác
  let finalChoices = availableKeys.filter(k => k !== lastUsed);
  if (finalChoices.length === 0) finalChoices = availableKeys;

  // Chọn ngẫu nhiên
  const pickedKey = finalChoices[Math.floor(Math.random() * finalChoices.length)];
  
  // Lưu lại để lần sau không dùng trùng
  localStorage.setItem(LAST_KEY_STORAGE, pickedKey);
  return pickedKey;
}

const ABSOLUTE_MAX_CHARS = 300;

const FEMALE_PERSONAS = [
  { id: 'Kore', name: 'Anchor Alpha', style: 'Mature, authoritative female anchor.' },
  { id: 'Zephyr', name: 'Reporter Beta', style: 'Youthful, energetic reporter.' },
  { id: 'Kore', name: 'Narrator Gamma', style: 'Soft, calm narrator.' },
  { id: 'Zephyr', name: 'Host Delta', style: 'Warm morning show host.' }
];

function humanizeText(text: string, settings: BioSettings): { ssml: string, plain: string } {
    const sentences = text.match(/[^.!?\n]+[.!?\n]*(\s+|$)/g) || [text];
    let richSSML = `<speak>`;
    let plainSynthesized = "";
    
    sentences.forEach((sentence, index) => {
        let processedSentence = sentence.trim();
        if (Math.random() < (settings.stutterRate / 100)) {
            const words = processedSentence.split(' ');
            if (words.length > 2) {
                const idx = Math.floor(Math.random() * Math.min(words.length, 3));
                words[idx] = `${words[idx]}... ${words[idx]}`;
                processedSentence = words.join(' ');
            }
        }
        const words = processedSentence.split(' ');
        let wordSSML = "";
        for (let i = 0; i < words.length; i++) {
            const speedRange = settings.speedVariation / 100;
            const randomSpeed = (1.05 + (Math.random() * speedRange * 2 - speedRange)).toFixed(2);
            wordSSML += `<prosody volume="medium" rate="${randomSpeed}">${words[i]} </prosody>`;
        }
        let extraTag = '';
        if (index > 0) {
            let waitTime = settings.waitDuration === 'long' ? 1000 : (settings.waitDuration === 'random' ? Math.floor(Math.random() * 800 + 200) : 400);
            extraTag += `<break time="${waitTime}ms"/>`;
        }
        richSSML += wordSSML + extraTag;
        plainSynthesized += (plainSynthesized ? " " : "") + processedSentence;
    });
    richSSML += `</speak>`;
    return { ssml: richSSML, plain: plainSynthesized };
}

async function processWithRetry(
  chunk: string, 
  persona: typeof FEMALE_PERSONAS[0], 
  index: number,
  settings: BioSettings
): Promise<{ index: number; audio: Uint8Array; metadata: AudioChunkMetadata } | null> {
    const humanized = humanizeText(chunk, settings);
    const systemPrompt = `PERFORM AS: ${persona.name}. STYLE: ${persona.style}. BREATHING: ${settings.breathIntensity}. TEXT: ${humanized.ssml}`;

    // Thử tối đa 10 lần bằng cách đổi key liên tục
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
        return {
          index,
          audio: audioBytes,
          metadata: { text: humanized.plain, durationMs: (audioBytes.length / 48000) * 1000 }
        };
      } catch (error: any) {
        const errorMsg = error?.message || "";
        console.warn(`[Lần thử ${attempt + 1}] Key ${currentApiKey.substring(0, 10)}... lỗi: ${errorMsg}`);

        // Nếu lỗi do hạn mức (429, Quota), đánh dấu key này là "FAILED" tạm thời
        if (errorMsg.includes("429") || errorMsg.includes("quota") || errorMsg.includes("limit")) {
            FAILED_KEYS.add(currentApiKey);
            console.warn(`Key ${currentApiKey.substring(0, 10)}... đã hết hạn mức và bị tạm dừng.`);
        }

        if (attempt === MAX_ATTEMPTS - 1) {
          throw new Error("Tất cả API Keys đều đang bận hoặc quá tải. Vui lòng nghỉ 30 giây rồi thử lại.");
        }

        // Đợi một chút rồi đổi key khác
        await new Promise(r => setTimeout(r, 800));
      }
    }
    return null;
}

export async function generateSpeech(params: GenerateSpeechParams): Promise<GeneratedSpeechResult> {
  const chunks = splitTextIntoSpeakerTurns(params.text);
  const results: { index: number; audio: Uint8Array; metadata: AudioChunkMetadata }[] = [];
  
  const personas = [...FEMALE_PERSONAS].sort(() => Math.random() - 0.5);
  
  for (let i = 0; i < chunks.length; i++) {
    const persona = personas[i % personas.length];
    const res = await processWithRetry(chunks[i], persona, i, params.settings);
    if (res) results.push(res);
    if (params.onProgress) params.onProgress(Math.round(((i + 1) / chunks.length) * 100));
    
    // Độ trễ nhỏ để Google không coi là spam request từ cùng 1 client
    if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 600));
    }
  }

  if (results.length === 0) throw new Error("Không thể tạo dữ liệu âm thanh.");

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
