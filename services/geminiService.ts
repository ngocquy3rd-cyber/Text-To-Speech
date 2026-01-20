
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

// API Key duy nhất của người dùng
const API_KEY = "AIzaSyD3XsfJUkK3X5-z720lx7P_SV2OplHcbfw";

function getAIClient() {
  return new GoogleGenAI({ apiKey: API_KEY });
}

// Giảm xuống 300 ký tự để đảm bảo an toàn tuyệt đối cho Quota miễn phí
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

    // Tăng số lần thử lại và giãn cách thời gian lâu hơn cho Key duy nhất
    const MAX_ATTEMPTS = 5;
    
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
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
        if (!base64Audio) {
            // Nếu không có audio, có thể do Google chặn nội dung hoặc lỗi model
            throw new Error("Google không trả về dữ liệu âm thanh (có thể do nội dung nhạy cảm hoặc lỗi model).");
        }
        
        const audioBytes = base64ToUint8Array(base64Audio);
        return {
          index,
          audio: audioBytes,
          metadata: { text: humanized.plain, durationMs: (audioBytes.length / 48000) * 1000 }
        };
      } catch (error: any) {
        const errorStatus = error?.status || "";
        const errorMsg = error?.message || "Lỗi không xác định";
        console.error(`[Lần thử ${attempt + 1}] Thất bại:`, errorMsg);

        // Nếu là lỗi 429 (Too many requests), cần đợi lâu hơn
        const isRateLimit = errorMsg.includes("429") || errorMsg.toLowerCase().includes("quota");
        
        if (attempt === MAX_ATTEMPTS - 1) {
          throw new Error(`API Key lỗi: ${errorMsg}. Vui lòng kiểm tra lại Key hoặc thử văn bản ngắn hơn.`);
        }

        // Delay tăng dần (Exponential Backoff): 1s, 3s, 5s...
        const waitTime = isRateLimit ? 3000 * (attempt + 1) : 1000 * (attempt + 1);
        await new Promise(r => setTimeout(r, waitTime));
      }
    }
    return null;
}

export async function generateSpeech(params: GenerateSpeechParams): Promise<GeneratedSpeechResult> {
  const chunks = splitTextIntoSpeakerTurns(params.text);
  const results: { index: number; audio: Uint8Array; metadata: AudioChunkMetadata }[] = [];
  
  // Trộn giọng đọc
  const personas = [...FEMALE_PERSONAS].sort(() => Math.random() - 0.5);
  
  for (let i = 0; i < chunks.length; i++) {
    const persona = personas[i % personas.length];
    const res = await processWithRetry(chunks[i], persona, i, params.settings);
    if (res) results.push(res);
    if (params.onProgress) params.onProgress(Math.round(((i + 1) / chunks.length) * 100));
    
    // NGHỈ 1 GIÂY giữa các đoạn để tránh bị Google khóa IP/Quota tạm thời
    if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, 1200));
    }
  }

  if (results.length === 0) throw new Error("Không tạo được bất kỳ đoạn âm thanh nào.");

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
    // Tách theo câu để đảm bảo ngắt nghỉ tự nhiên
    const sentences = text.match(/[^.!?\n]+[.!?\n]*(\s+|$)/g) || [text];
    const chunks: string[] = [];
    let currentChunk = "";
    
    sentences.forEach(s => {
        const trimmedS = s.trim();
        if (!trimmedS) return;
        
        // Nếu thêm câu mới vào vượt quá giới hạn an toàn, đóng đoạn cũ
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
