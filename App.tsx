
import React, { useState, useRef, useEffect } from 'react';
import { generateSpeech, BioSettings } from './services/geminiService';
import { createMp3Blob, createSrtBlob, createZipBlob } from './utils/audioUtils';

const downloadFile = (blob: Blob, fileName: string) => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
};

interface ProductionResult {
  mp3Blob: Blob;
  srtBlob: Blob;
  charCount: number;
  durationStr: string;
  generationTime: string;
  timestamp: string;
}

const App: React.FC = () => {
  const [text, setText] = useState("Good evening. Our top story tonight: Artificial Intelligence continues to redefine the boundaries of synthetic media. From professional newsrooms in Washington to broadcast centers across the globe, high-fidelity voice synthesis is providing a glimpse into the future of digital communication.");
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<ProductionResult | null>(null);
  
  const [bioSettings, setBioSettings] = useState<BioSettings>({
    stutterRate: 35,       
    breathIntensity: 'loud', 
    fillerRate: 35,        
    volumeVariation: 60,   
    speedVariation: 50,    
    asymmetry: true,
    ambientSounds: true,
    waitDuration: 'random'
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const notifyAudioRef = useRef<HTMLAudioElement | null>(null);

  const handleGenerate = async () => {
    if (!text.trim()) return;
    setIsGenerating(true);
    setProgress(0);
    setErrorMsg(null);
    setResult(null);
    const startTime = performance.now();
    
    try {
      const speechResult = await generateSpeech({
        text,
        isSSML: false,
        settings: bioSettings,
        onProgress: (p) => setProgress(p)
      });
      
      const endTime = performance.now();
      const generationTimeSec = ((endTime - startTime) / 1000).toFixed(1);
      
      const mp3Blob = createMp3Blob(speechResult.audioData);
      const srtBlob = createSrtBlob(speechResult.metadata);
      
      // Tính toán độ dài âm thanh
      const totalMs = speechResult.metadata.reduce((acc, m) => acc + m.durationMs, 0);
      const mins = Math.floor(totalMs / 60000);
      const secs = Math.floor((totalMs % 60000) / 1000);
      const durationStr = `${mins}:${secs.toString().padStart(2, '0')}`;

      const now = new Date();
      const timestamp = `VOICE_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
      
      setResult({
        mp3Blob,
        srtBlob,
        charCount: text.length,
        durationStr,
        generationTime: generationTimeSec,
        timestamp
      });

      // Phát âm thanh thông báo thành công (Ping)
      if (notifyAudioRef.current) {
        notifyAudioRef.current.play().catch(() => {});
      }
      
    } catch (error: any) {
      console.error(error);
      setErrorMsg(error.message || "Lỗi: Không thể tạo âm thanh. Vui lòng kiểm tra API Key.");
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadZip = async () => {
    if (!result) return;
    const zipBlob = await createZipBlob(result.mp3Blob, result.srtBlob, result.timestamp);
    downloadFile(zipBlob, `${result.timestamp}_Full.zip`);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-slate-100 p-4 md:p-10 font-sans selection:bg-orange-500/30 relative">
      <header className="mb-12 text-center max-w-4xl mx-auto">
        <div className="inline-block px-3 py-1 bg-orange-500/10 border border-orange-500/20 rounded-full text-orange-400 text-[10px] font-bold tracking-[0.4em] uppercase mb-4">
          US News Broadcaster System v12.1
        </div>
        <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-white uppercase italic">
          Anchor<span className="text-orange-600">Sync</span>
        </h1>
        <p className="text-slate-500 mt-2 font-mono text-xs uppercase tracking-widest italic">Professional US English News Anchors - Perfect SRT Synchronization.</p>
      </header>

      <main className="max-w-7xl mx-auto grid lg:grid-cols-3 gap-8">
        
        {/* Left Column: Input */}
        <div className="lg:col-span-2 space-y-8">
            <div className="bg-slate-900/30 border border-white/5 rounded-[2.5rem] p-8 shadow-2xl relative overflow-hidden group min-h-[500px] flex flex-col">
                <textarea 
                    className="flex-1 w-full bg-transparent border-none text-2xl font-medium focus:ring-0 outline-none resize-none placeholder:text-slate-800 leading-relaxed custom-scrollbar"
                    placeholder="Nhập kịch bản tin tức tại đây... Hệ thống sẽ tự động điều phối API và đảo giọng đọc chuyên nghiệp."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                />
                {errorMsg && (
                  <div className="mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-xs font-mono uppercase tracking-wider">
                    {errorMsg}
                  </div>
                )}
                <div className="flex justify-between items-center mt-6 pt-6 border-t border-white/5 text-[10px] font-mono text-slate-500 tracking-widest uppercase">
                    <span>{text.length} characters</span>
                    <span className="text-orange-500/50">Smart API Load Balancing Active</span>
                </div>
            </div>
            
            <div className="bg-slate-950 border border-white/5 rounded-[2.5rem] p-8 flex items-center justify-center text-center opacity-40">
                <div className="text-slate-400 text-[9px] leading-loose max-w-lg uppercase tracking-widest">
                    Optimized for General American Broadcast Cadence. SRT blocks optimized for 30-80 character readability with syllable-weighted sync.
                </div>
            </div>
        </div>

        {/* Right Column: Bio Settings */}
        <div className="space-y-6">
            <div className="bg-slate-900 border border-white/10 rounded-[2.5rem] p-8 shadow-2xl">
                <h2 className="text-xs font-black uppercase tracking-[0.3em] text-orange-500 mb-8 border-b border-white/5 pb-4">Biometric Parameters</h2>
                
                <div className="space-y-8">
                    <div className="space-y-4">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            <span>Stutter Probability</span>
                            <span className="text-orange-500">{bioSettings.stutterRate}%</span>
                        </div>
                        <input type="range" min="5" max="50" value={bioSettings.stutterRate} 
                               onChange={(e) => setBioSettings({...bioSettings, stutterRate: parseInt(e.target.value)})}
                               className="w-full accent-orange-600" />
                    </div>

                    <div className="space-y-4">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            <span>Filler Density</span>
                            <span className="text-orange-500">{bioSettings.fillerRate}%</span>
                        </div>
                        <input type="range" min="5" max="50" value={bioSettings.fillerRate} 
                               onChange={(e) => setBioSettings({...bioSettings, fillerRate: parseInt(e.target.value)})}
                               className="w-full accent-orange-600" />
                    </div>

                    <div className="space-y-4">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            <span>Vocal Dynamics</span>
                            <span className="text-orange-500">{bioSettings.volumeVariation}%</span>
                        </div>
                        <input type="range" min="5" max="80" value={bioSettings.volumeVariation} 
                               onChange={(e) => setBioSettings({...bioSettings, volumeVariation: parseInt(e.target.value)})}
                               className="w-full accent-orange-600" />
                    </div>

                    <div className="space-y-4">
                        <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            <span>Cadence Jitter</span>
                            <span className="text-orange-500">{bioSettings.speedVariation}%</span>
                        </div>
                        <input type="range" min="5" max="70" value={bioSettings.speedVariation} 
                               onChange={(e) => setBioSettings({...bioSettings, speedVariation: parseInt(e.target.value)})}
                               className="w-full accent-orange-600" />
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4">
                        <button 
                            className={`p-4 rounded-2xl text-[9px] font-bold uppercase border transition-all ${bioSettings.asymmetry ? 'border-orange-500 text-orange-500 bg-orange-500/5 shadow-[0_0_20px_rgba(249,115,22,0.1)]' : 'border-white/5 text-slate-600'}`}
                            onClick={() => setBioSettings({...bioSettings, asymmetry: !bioSettings.asymmetry})}
                        >Natural Flow</button>
                        <button 
                            className={`p-4 rounded-2xl text-[9px] font-bold uppercase border transition-all ${bioSettings.ambientSounds ? 'border-orange-500 text-orange-500 bg-orange-500/5 shadow-[0_0_20px_rgba(249,115,22,0.1)]' : 'border-white/5 text-slate-600'}`}
                            onClick={() => setBioSettings({...bioSettings, ambientSounds: !bioSettings.ambientSounds})}
                        >Ambient FX</button>
                    </div>

                    <div className="space-y-4">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Breathing Effort</label>
                        <select 
                            value={bioSettings.breathIntensity}
                            onChange={(e) => setBioSettings({...bioSettings, breathIntensity: e.target.value as any})}
                            className="w-full bg-black border border-white/10 rounded-xl p-3 text-[10px] text-white focus:ring-1 focus:ring-orange-500 outline-none appearance-none"
                        >
                            <option value="none">Suppressed</option>
                            <option value="soft">Subtle</option>
                            <option value="loud">Deep Anchor Breaths</option>
                        </select>
                    </div>

                    <div className="space-y-4">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Punctuation Pause</label>
                        <select 
                            value={bioSettings.waitDuration}
                            onChange={(e) => setBioSettings({...bioSettings, waitDuration: e.target.value as any})}
                            className="w-full bg-black border border-white/10 rounded-xl p-3 text-[10px] text-white focus:ring-1 focus:ring-orange-500 outline-none appearance-none"
                        >
                            <option value="natural">Natural (400ms)</option>
                            <option value="long">News Standard (1000ms)</option>
                            <option value="random">Organic Variation</option>
                        </select>
                    </div>
                </div>
            </div>

            <button 
                disabled={isGenerating}
                onClick={handleGenerate}
                className={`w-full py-8 rounded-[2.5rem] font-black uppercase tracking-[0.8em] text-xs transition-all shadow-2xl relative overflow-hidden group ${isGenerating ? 'bg-slate-900 text-slate-700 cursor-wait' : 'bg-orange-600 text-white hover:bg-orange-500 hover:scale-[1.01] active:scale-[0.99]'}`}
            >
                <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform"></div>
                <span className="relative z-10">{isGenerating ? `Processing ${progress}%` : 'Broadcast Sequence'}</span>
            </button>
        </div>
      </main>

      {/* Popup Kết Quả */}
      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-slate-900 border border-white/10 w-full max-w-lg rounded-[3rem] p-8 shadow-[0_0_100px_rgba(234,88,12,0.15)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-orange-600"></div>
            
            <button 
                onClick={() => setResult(null)}
                className="absolute top-6 right-8 text-slate-500 hover:text-white transition-colors text-xl"
            >✕</button>

            <h3 className="text-2xl font-black italic uppercase text-white mb-2">Production <span className="text-orange-600">Complete</span></h3>
            <p className="text-slate-500 text-[10px] font-mono uppercase tracking-widest mb-8">Hệ thống đã hoàn tất xử lý kịch bản của bạn.</p>

            <div className="grid grid-cols-2 gap-4 mb-8">
                <div className="bg-black/40 border border-white/5 p-5 rounded-3xl">
                    <span className="block text-[9px] uppercase tracking-tighter text-slate-500 mb-1">Text Volume</span>
                    <span className="text-xl font-bold text-white">{result.charCount} <span className="text-[10px] text-slate-600">CHARS</span></span>
                </div>
                <div className="bg-black/40 border border-white/5 p-5 rounded-3xl">
                    <span className="block text-[9px] uppercase tracking-tighter text-slate-500 mb-1">Audio Duration</span>
                    <span className="text-xl font-bold text-white">{result.durationStr} <span className="text-[10px] text-slate-600">MINS</span></span>
                </div>
                <div className="bg-black/40 border border-white/5 p-5 rounded-3xl col-span-2">
                    <span className="block text-[9px] uppercase tracking-tighter text-slate-500 mb-1">Latency / Generation Speed</span>
                    <span className="text-xl font-bold text-orange-500">{result.generationTime} <span className="text-[10px] text-slate-600 uppercase">Seconds</span></span>
                </div>
            </div>

            <div className="mb-8">
                <audio 
                  controls 
                  className="w-full accent-orange-600 h-10" 
                  src={URL.createObjectURL(result.mp3Blob)} 
                />
            </div>

            <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                    <button 
                        onClick={() => downloadFile(result.mp3Blob, `${result.timestamp}.mp3`)}
                        className="bg-white/5 hover:bg-white/10 border border-white/5 py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all"
                    >Download MP3</button>
                    <button 
                        onClick={() => downloadFile(result.srtBlob, `${result.timestamp}.srt`)}
                        className="bg-white/5 hover:bg-white/10 border border-white/5 py-4 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all"
                    >Download SRT</button>
                </div>
                <button 
                    onClick={downloadZip}
                    className="w-full bg-orange-600 hover:bg-orange-500 py-5 rounded-2xl text-[11px] font-black uppercase tracking-[0.4em] transition-all shadow-xl shadow-orange-600/10"
                >Get Production Package (ZIP)</button>
            </div>
          </div>
        </div>
      )}

      {/* Âm thanh hệ thống */}
      <audio ref={audioRef} className="hidden" />
      <audio ref={notifyAudioRef} className="hidden" src="https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3" />

      <style>{`
        body { background: radial-gradient(circle at top right, #0a0a0a, #020202); }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1a1a1a; border-radius: 10px; }
        input[type=range] { -webkit-appearance: none; background: transparent; }
        input[type=range]::-webkit-slider-runnable-track { width: 100%; height: 2px; cursor: pointer; background: #1a1a1a; border-radius: 2px; }
        input[type=range]::-webkit-slider-thumb { height: 14px; width: 14px; border-radius: 50%; background: #ea580c; cursor: pointer; -webkit-appearance: none; margin-top: -6px; border: 2px solid #000; box-shadow: 0 0 10px rgba(234, 88, 12, 0.4); }
        select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='white'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 1rem center; background-size: 1em; }
        audio::-webkit-media-controls-panel { background-color: #0f172a; }
        audio::-webkit-media-controls-current-time-display,
        audio::-webkit-media-controls-time-remaining-display { color: #f8fafc; }
      `}</style>
    </div>
  );
};

export default App;
