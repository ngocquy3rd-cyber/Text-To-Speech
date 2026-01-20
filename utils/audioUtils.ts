
export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export function createWavBlob(audioData: string | Uint8Array): Blob {
  const pcmData = typeof audioData === 'string' ? base64ToUint8Array(audioData) : audioData;
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  const headerLength = 44;
  const buffer = new ArrayBuffer(headerLength + pcmData.length);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, pcmData.length, true);

  const pcm = new Uint8Array(pcmData);
  const data = new Uint8Array(view.buffer, headerLength);
  data.set(pcm);

  return new Blob([view], { type: 'audio/wav' });
}

export function createMp3Blob(audioData: string | Uint8Array): Blob {
  const pcmData = typeof audioData === 'string' ? base64ToUint8Array(audioData) : audioData;
  const samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2);

  const channels = 1; 
  const sampleRate = 24000; 
  const kbps = 128; 
  
  const lamejs = (window as any).lamejs;
  if (!lamejs) return new Blob([], { type: 'audio/mp3' });

  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
  const mp3Data = [];
  const sampleBlockSize = 1152; 
  
  for (let i = 0; i < samples.length; i += sampleBlockSize) {
    const sampleChunk = samples.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
    if (mp3buf.length > 0) mp3Data.push(mp3buf);
  }
  
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) mp3Data.push(mp3buf);
  
  return new Blob(mp3Data, { type: 'audio/mp3' });
}

function formatSrtTime(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const milliseconds = Math.floor(ms % 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
}

function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const syllables = word.match(/[aeiouy]{1,2}/g);
  return syllables ? syllables.length : 1;
}

interface SrtSegment {
  text: string;
  durationMs: number;
}

export function createSrtBlob(chunks: SrtSegment[]): Blob {
  let srtContent = "";
  let counter = 1;
  let globalTimeMs = 0;

  chunks.forEach((chunk, chunkIdx) => {
    // Lead-in offset to sync with audio buffering start
    const startOffsetMs = 150; 
    const totalChunkDuration = chunk.durationMs;
    
    const words = chunk.text.trim().split(/\s+/);
    if (words.length === 0) {
      globalTimeMs += totalChunkDuration;
      return;
    }

    const PAUSE_END_SENTENCE = 600;
    const PAUSE_COMMA = 250;
    const PAUSE_STUTTER = 400;
    const PAUSE_FILLER = 350;

    let totalPauseTime = 0;
    const wordData = words.map(w => {
      let pause = 0;
      if (w.match(/[.!?]$/)) pause = PAUSE_END_SENTENCE;
      else if (w.match(/[,;:]$/)) pause = PAUSE_COMMA;
      else if (w.includes('...')) pause = PAUSE_STUTTER;
      
      const clean = w.toLowerCase().replace(/[.,!?;:]/g, '');
      if (clean === 'uhm' || clean === 'err') pause += PAUSE_FILLER;

      totalPauseTime += pause;
      return { 
        original: w, 
        syllables: countSyllables(clean),
        pauseAfter: pause 
      };
    });

    const leadOutMs = 100;
    const vocalDuration = totalChunkDuration - startOffsetMs - leadOutMs - totalPauseTime;
    const safeVocalDuration = Math.max(vocalDuration, 100);
    const totalSyllables = wordData.reduce((acc, w) => acc + w.syllables, 0);
    const msPerSyllable = safeVocalDuration / totalSyllables;

    let clusterStartTimeOffset = startOffsetMs;
    let currentClusterText = "";
    let currentClusterSyllables = 0;
    let currentClusterPause = 0;

    for (let i = 0; i < wordData.length; i++) {
      const w = wordData[i];
      const potentialText = currentClusterText ? currentClusterText + " " + w.original : w.original;
      
      const isLastWord = i === wordData.length - 1;
      const exceedsLimit = potentialText.length > 80;
      const meetsMinimum = potentialText.length >= 30;

      // Logic: Flush cluster if adding next word exceeds 80 characters, OR if it's the last word
      if ((exceedsLimit && currentClusterText.length > 0) || isLastWord) {
        
        // Nếu là từ cuối cùng, bắt buộc gộp vào cluster hiện tại
        if (isLastWord) {
            currentClusterText = potentialText;
            currentClusterSyllables += w.syllables;
            currentClusterPause += w.pauseAfter;
        }

        const startTime = globalTimeMs + clusterStartTimeOffset;
        const duration = (currentClusterSyllables * msPerSyllable) + currentClusterPause;
        const endTime = startTime + duration;

        srtContent += `${counter}\n${formatSrtTime(startTime)} --> ${formatSrtTime(endTime)}\n${currentClusterText}\n\n`;
        
        counter++;
        clusterStartTimeOffset += duration;
        
        // Nếu chưa phải từ cuối mà phải flush do dài, thì từ hiện tại bắt đầu cluster mới
        if (!isLastWord) {
            currentClusterText = w.original;
            currentClusterSyllables = w.syllables;
            currentClusterPause = w.pauseAfter;
        } else {
            currentClusterText = "";
        }
      } else {
        // Gộp thêm vào cụm hiện tại
        currentClusterText = potentialText;
        currentClusterSyllables += w.syllables;
        currentClusterPause += w.pauseAfter;
      }
    }

    globalTimeMs += totalChunkDuration;
  });

  return new Blob([srtContent], { type: 'text/srt' });
}

export async function createZipBlob(mp3Blob: Blob, srtBlob: Blob, baseName: string): Promise<Blob> {
  if (!(window as any).JSZip) return new Blob([]);
  const zip = new (window as any).JSZip();
  const safeName = baseName.replace(/:/g, '.');
  zip.file(`${safeName}.mp3`, mp3Blob);
  zip.file(`${safeName}.srt`, srtBlob);
  return await zip.generateAsync({ type: "blob" });
}
