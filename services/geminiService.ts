
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

// Danh sách tất cả API Keys bạn cung cấp
const ORIGINAL_KEYS = [
  "AIzaSyDlqh2BVvo_qJ8KNcVKiZ-9OdNynnc8884",
  "AIzaSyCoD2B_VVKzZJCNl-RqBJy6SanQnX2lo0U",
  "AIzaSyBQIJnnAhffFJi1OMDshziXWIPwdZdWpOA",
  "AIzaSyDRM25nu8rhmRhDcSXu19_KhYV9UdouL30",
  "AIzaSyBjERleirTQHkeRexCx779DVtcaIeL1X4s",
  "AIzaSyBvLjurH8MNnP10lhvaFgOtN-wAh82BV2c",
  "AIzaSyBp-yrKVpHmoXaxz37pMqTjHmGUjTLbDmw",
  "AIzaSyBpBD-Npf2VGdckZsrq19bsW3MthUN-fi0"
];

// Xáo trộn danh sách key ngay khi load trang để tránh tập trung vào key đầu tiên
const SHUFFLED_KEYS = [...ORIGINAL_KEYS].sort(() => Math.random() - 0.5);
const FAILED_KEYS = new Set<string>();
let currentKeyIndex = 0;

function getAIClient() {
  // Tìm key tiếp theo không nằm trong danh sách đã lỗi
  let attempts = 0;
  while (FAILED_KEYS.has(SHUFFLED_KEYS[currentKeyIndex]) && attempts < SHUFFLED_KEYS.length) {
    currentKeyIndex = (currentKeyIndex + 1) % SHUFFLED_KEYS.length;
    attempts++;
  }
  
  const key = SHUFFLED_KEYS[currentKeyIndex];
  return new GoogleGenAI({ apiKey: key });
}

function markCurrentKeyAsFailed() {
  const failedKey = SHUFFLED_KEYS[currentKeyIndex];
  FAILED_KEYS.add(failedKey);
  console.error(`Key ${failedKey.substring(0, 10)}... marked as FAILED. Active keys left: ${SHUFFLED_KEYS.length - FAILED_KEYS.size}`);
  currentKeyIndex = (currentKeyIndex + 1) % SHUFFLED_KEYS.length;
}

const ABSOLUTE_MAX_CHARS = 500;

const FEMALE_PERSONAS = [
  { id: 'Kore', name: 'Anchor Alpha', style: 'Mature, authoritative female anchor.' },
  { id: 'Zephyr', name: 'Reporter Beta', style: 'Youthful, energetic reporter.' },
  { id: 'Kore', name: 'Narrator Gamma', style: 'Soft, calm narrator.' },
  { id: 'Zephyr', name: 'Host Delta', style: 'Warm morning show host.' },
  { id: 'Kore', name: 'Expert Epsilon', style: 'Crisp technical correspondent.' },
  { id: 'Zephyr', name: 'Specialist Zeta', style: 'Urgent breaking news style.' },
  { id: 'Kore', name: 'Global Eta', style: 'Prestigious global broadcast.' },
  { id: 'Zephyr', name: 'Tech Theta', style: 'Modern tech reader.' }
];

function shuffleArray<T>(array: T[]): T[] {
  const newArr = [...array];
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }
  return newArr;
}

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

async function processChunkWithRobustRotation(
  chunk: string, 
  persona: typeof FEMALE_PERSONAS[0], 
  index: number,
  settings: BioSettings
): Promise<{ index: number; audio: Uint8Array; metadata: AudioChunkMetadata } | null> {
    const humanized = humanizeText(chunk, settings);
    const systemPrompt = `TASK: PERFORM AS A PROFESSIONAL FEMALE NEWS ANCHOR. STYLE: ${persona.style} IDENTITY: ${persona.name}. BREATHING: ${settings.breathIntensity}. TEXT: ${humanized.ssml}`;

    // Thử quay vòng key cho đến khi tìm được key sống hoặc hết sạch key
    const maxGlobalAttempts = SHUFFLED_KEYS.length;
    
    for (let globalAttempt = 0; globalAttempt < maxGlobalAttempts; globalAttempt++) {
      try {
        const ai = getAIClient();
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
        if (!base64Audio) throw new Error("empty_response"); 
        
        const audioBytes = base64ToUint8Array(base64Audio);
        return {
          index,
          audio: audioBytes,
          metadata: { text: humanized.plain, durationMs: (audioBytes.length / 48000) * 1000 }
        };
      } catch (error: any) {
        const msg = error?.message || "";
        console.warn(`Request failed with current key. Reason: ${msg}. Attempting next key...`);
        
        // Nếu lỗi liên quan đến quota hoặc không tìm thấy model, loại bỏ key này khỏi danh sách sử dụng
        if (msg.includes("quota") || msg.includes("429") || msg.includes("limit") || msg.includes("empty_response")) {
          markCurrentKeyAsFailed();
        } else {
          // Với các lỗi khác, chỉ chuyển index mà không đánh dấu fail vĩnh viễn
          currentKeyIndex = (currentKeyIndex + 1) % SHUFFLED_KEYS.length;
        }

        if (FAILED_KEYS.size >= SHUFFLED_KEYS.length) {
          throw new Error("Tất cả API Keys hiện tại đều không khả dụng. Vui lòng kiểm tra lại hạn mức hoặc bổ sung key mới.");
        }
        
        // Đợi một chút trước khi thử key tiếp theo để tránh bị rate limit IP
        await new Promise(r => setTimeout(r, 500));
      }
    }
    return null;
}

export async function generateSpeech(params: GenerateSpeechParams): Promise<GeneratedSpeechResult> {
  const chunks = splitTextIntoSpeakerTurns(params.text);
  const results: { index: number; audio: Uint8Array; metadata: AudioChunkMetadata }[] = [];
  let shuffledPersonas = shuffleArray(FEMALE_PERSONAS);
  
  for (let i = 0; i < chunks.length; i++) {
    const persona = shuffledPersonas[i % shuffledPersonas.length];
    const res = await processChunkWithRobustRotation(chunks[i], persona, i, params.settings);
    if (res) results.push(res);
    if (params.onProgress) params.onProgress(Math.round(((i + 1) / chunks.length) * 100));
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
