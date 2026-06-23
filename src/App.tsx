import { useState, useEffect, useRef, ChangeEvent, FormEvent, MouseEvent } from "react";
import {
  Mic,
  Square,
  Plus,
  Trash2,
  Play,
  Pause,
  Download,
  Sparkles,
  Upload,
  Music,
  Info,
  Sliders,
  X,
  Volume2,
  Check,
  AlertCircle,
  FileAudio,
  Brain,
  RefreshCw,
  Clock
} from "lucide-react";
import { VoiceProfile, VoiceAnalysis, SynthesizedAudio, ScriptSample } from "./types";
import { TRAINING_SCRIPTS } from "./data/scripts";
import { PRESET_PROFILES } from "./data/presets";
import { getAllProfilesFromDB, saveProfileToDB, deleteProfileFromDB } from "./voiceDb";

// Helper to write string to DataView
function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Convert Raw 16-bit PCM (from Gemini) to playable WAV
function pcmToWav(rawPcmBase64: string, sampleRate: number = 24000): string {
  const binaryString = atob(rawPcmBase64);
  const len = binaryString.length;
  const rawBuffer = new ArrayBuffer(len);
  const rawView = new Uint8Array(rawBuffer);
  for (let i = 0; i < len; i++) {
    rawView[i] = binaryString.charCodeAt(i);
  }

  const wavBuffer = new ArrayBuffer(44 + len);
  const view = new DataView(wavBuffer);

  /* RIFF identifier */
  writeString(view, 0, "RIFF");
  /* file length */
  view.setUint32(4, 36 + len, true);
  /* RIFF type */
  writeString(view, 8, "WAVE");
  /* format chunk identifier */
  writeString(view, 12, "fmt ");
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (1 = PCM) */
  view.setUint16(20, 1, true);
  /* channel count (1 = Mono) */
  view.setUint16(22, 1, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * 1 * 2, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, 1 * 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, "data");
  /* data chunk length */
  view.setUint32(40, len, true);

  // Write headers + raw bytes
  const wavBytes = new Uint8Array(wavBuffer);
  wavBytes.set(rawView, 44);

  const wavBlob = new Blob([wavBytes], { type: "audio/wav" });
  return URL.createObjectURL(wavBlob);
}

export default function App() {
  // Profiles state
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<VoiceProfile | null>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<"library" | "create">("library");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedBase64, setRecordedBase64] = useState<string>("");
  const [recordedMimeType, setRecordedMimeType] = useState<string>("audio/webm");
  const [uploadedFileName, setUploadedFileName] = useState<string>("");

  // Create profile form
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileDesc, setNewProfileDesc] = useState("");
  const [selectedScript, setSelectedScript] = useState<ScriptSample>(TRAINING_SCRIPTS[0]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState("");

  // Synthesis state
  const [synthesisText, setSynthesisText] = useState("");
  const [synthesisEngine, setSynthesisEngine] = useState<"neural" | "local">("neural");
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [synthesizedList, setSynthesizedList] = useState<SynthesizedAudio[]>([]);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [emotionSelection, setEmotionSelection] = useState<string>("auto");
  const [isRefining, setIsRefining] = useState(false);

  // Feedback notifications
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Audio recording references
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  // Web Audio Context & Canvas references for live record wave
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Standard audio HTML tags play state tracker
  const currentAudioElementRef = useRef<HTMLAudioElement | null>(null);

  // Init - load profiles from DB and set presets
  useEffect(() => {
    async function loadAllProfiles() {
      try {
        const customProfiles = await getAllProfilesFromDB();
        const mergedList = [...PRESET_PROFILES, ...customProfiles];
        setProfiles(mergedList);
        
        // Select first preset by default
        if (mergedList.length > 0) {
          setSelectedProfile(mergedList[0]);
        }
      } catch (err) {
        console.error("No se pudo iniciar IndexedDB:", err);
        setProfiles(PRESET_PROFILES);
        setSelectedProfile(PRESET_PROFILES[0]);
      }
    }
    loadAllProfiles();

    // Load synthesized audios history from local storage metadata if exists
    let storedHistory: string | null = null;
    try {
      storedHistory = localStorage.getItem("cloned_audio_history");
    } catch (e) {
      console.warn("localStorage is not accessible in this sandbox/iframe:", e);
    }

    if (storedHistory) {
      try {
        const parsed = JSON.parse(storedHistory) as any[];
        // Re-construct blob URLs from stored base64 inside session
        const reconstructed = parsed.map((item) => {
          const wavUrl = pcmToWav(item.audioBase64, 24000);
          return {
            ...item,
            audioUrl: wavUrl
          };
        });
        setSynthesizedList(reconstructed);
      } catch (e) {
        console.error("Error al procesar el historial guardado:", e);
      }
    }

    return () => {
      stopRecordingResources();
    };
  }, []);

  const stopRecordingResources = () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
      }
    }
  };

  // Live audio recording handlers
  const startRecording = async () => {
    setErrorMsg(null);
    setRecordedBlob(null);
    setRecordedBase64("");
    setUploadedFileName("");
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Determine optimum mimeType
      let options = { mimeType: "audio/webm" };
      if (!MediaRecorder.isTypeSupported("audio/webm")) {
        if (MediaRecorder.isTypeSupported("audio/mp4")) {
          options = { mimeType: "audio/mp4" };
        } else if (MediaRecorder.isTypeSupported("audio/ogg")) {
          options = { mimeType: "audio/ogg" };
        } else {
          options = { mimeType: "" }; // Fallback to browser default
        }
      }
      setRecordedMimeType(options.mimeType || "audio/wav");

      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        setRecordedBlob(audioBlob);
        
        // Convert Blob to Base64 to send to server
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result as string;
          // Extract only the raw base64 string without data:audio/... prefix
          const base64Raw = base64data.split(",")[1];
          setRecordedBase64(base64Raw);
        };
        reader.readAsDataURL(audioBlob);

        // Turn off stream tracks
        stream.getTracks().forEach(track => track.stop());
      };

      // Set up real-time voice meter and visualization using Web Audio
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const audioSource = audioContextRef.current.createMediaStreamSource(stream);
      audioSource.connect(analyserRef.current);
      analyserRef.current.fftSize = 256;

      drawWaveform();

      recorder.start(250); // Collect data slices every 250ms
      setIsRecording(true);
      setRecordingTime(0);

      recordTimerRef.current = window.setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

    } catch (err: any) {
      console.error("Error al acceder al micrófono:", err);
      setErrorMsg("No se pudo acceder al micrófono. Por favor, concede los permisos en el navegador.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      stopRecordingResources();
    }
  };

  // Draw dancing bars in record visualizer
  const drawWaveform = () => {
    if (!canvasRef.current || !analyserRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const width = canvas.width;
    const height = canvas.height;

    const renderFrame = () => {
      const isRecordingActive = mediaRecorderRef.current && mediaRecorderRef.current.state === "recording";
      if (!isRecordingActive || !analyserRef.current) return;
      
      animationFrameRef.current = requestAnimationFrame(renderFrame);
      analyserRef.current.getByteFrequencyData(dataArray);

      ctx.fillStyle = "#f9fafb"; // match slate-50 background
      ctx.fillRect(0, 0, width, height);

      const barWidth = (width / bufferLength) * 1.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 1.5;

        // Gradient color for beautiful aesthetic
        const grad = ctx.createLinearGradient(0, height, 0, 0);
        grad.addColorStop(0, "#0f172a"); // slate-900
        grad.addColorStop(1, "#3b82f6"); // blue-500

        ctx.fillStyle = grad;
        // Centered drawing
        const yPos = (height - barHeight) / 2;
        ctx.fillRect(x, yPos, barWidth - 1, barHeight || 4); // minimum 4px height

        x += barWidth;
      }
    };

    renderFrame();
  };

  // File Upload handler
  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    setRecordedBlob(null);
    setRecordedBase64("");
    setUploadedFileName(file.name);
    setRecordedMimeType(file.type || "audio/wav");

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = reader.result as string;
      const base64Raw = base64data.split(",")[1];
      setRecordedBase64(base64Raw);
      
      // Simulate recorded blob for local playing
      const byteCharacters = atob(base64Raw);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const fileBlob = new Blob([byteArray], { type: file.type });
      setRecordedBlob(fileBlob);
    };
    reader.readAsDataURL(file);
  };

  // Dedicated auxiliary clips refinement handlers
  const handleAddRefinementClip = async (file: File) => {
    if (!selectedProfile) return;
    if (selectedProfile.isPreset) {
      setErrorMsg("No se pueden añadir clips adicionales a las voces predefinidas de sistema.");
      return;
    }
    
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsRefining(true);

    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64data = reader.result as string;
        const base64Raw = base64data.split(",")[1];
        
        const newClip = {
          id: `clip-${Date.now()}`,
          name: file.name,
          base64: base64Raw,
          mimeType: file.type || "audio/wav",
          createdAt: new Date().toISOString(),
          size: file.size,
        };

        const updatedClips = [...(selectedProfile.additionalClips || []), newClip];
        const updatedProfile = {
          ...selectedProfile,
          additionalClips: updatedClips,
        };

        // Save DB
        await saveProfileToDB(updatedProfile);

        // Update lists
        setSelectedProfile(updatedProfile);
        setProfiles((prev) =>
          prev.map((p) => (p.id === selectedProfile.id ? updatedProfile : p))
        );

        setSuccessMsg(`Firma refinada: Se integró exitosamente "${file.name}" para enriquecer la síntesis.`);
      } catch (err: any) {
        setErrorMsg("Error al guardar el clip de refinamiento.");
      } finally {
        setIsRefining(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveRefinementClip = async (clipId: string) => {
    if (!selectedProfile) return;
    try {
      const updatedClips = (selectedProfile.additionalClips || []).filter(c => c.id !== clipId);
      const updatedProfile = {
        ...selectedProfile,
        additionalClips: updatedClips,
      };

      await saveProfileToDB(updatedProfile);
      
      setSelectedProfile(updatedProfile);
      setProfiles((prev) =>
        prev.map((p) => (p.id === selectedProfile.id ? updatedProfile : p))
      );
      setSuccessMsg("Clip de refinamiento eliminado del modelo de voz.");
    } catch (err) {
      setErrorMsg("Error al remover el clip de refinamiento.");
    }
  };

  // Analyze Voice & Create Profile
  const handleAnalyzeAndCreateProfile = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!newProfileName.trim()) {
      setErrorMsg("Introduce un nombre para el perfil de voz.");
      return;
    }
    if (!recordedBase64) {
      setErrorMsg("Graba un audio o sube un archivo de voz para realizar la clonación.");
      return;
    }

    setIsAnalyzing(true);
    setAnalysisProgress("Enviando muestra a la IA de audio...");

    try {
      // Step simulated updates for elegant feedback rhythm
      setTimeout(() => setAnalysisProgress("Modelando frecuencias físicas..."), 1200);
      setTimeout(() => setAnalysisProgress("Analizando timbre y entonación vocal..."), 2400);
      setTimeout(() => setAnalysisProgress("Generando directivas de modulación..."), 3600);

      const response = await fetch("/api/analyze-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: recordedBase64,
          mimeType: recordedMimeType
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Ocurrió un error analizando la muestra de voz.");
      }

      const generatedId = `custom-${Date.now()}`;
      
      // Save original audio locally as object URL or standard blob url
      const newProfile: VoiceProfile = {
        id: generatedId,
        name: newProfileName.trim(),
        description: newProfileDesc.trim() || `Voz clonada de: ${newProfileName}`,
        createdAt: new Date().toISOString(),
        sampleAudioBase64: recordedBase64,
        sampleAudioMimeType: recordedMimeType,
        analysis: data.analysis,
        isPreset: false
      };

      // Save to IndexedDB persistence
      await saveProfileToDB(newProfile);

      // Add to state and set as active
      setProfiles((prev) => [newProfile, ...prev]);
      setSelectedProfile(newProfile);
      setSuccessMsg(`¡Voz de "${newProfileName}" analizada y clonada con éxito! Ya puedes usarla en el sintetizador.`);
      
      // Reset form setup
      setNewProfileName("");
      setNewProfileDesc("");
      setRecordedBlob(null);
      setRecordedBase64("");
      setUploadedFileName("");
      setRecordingTime(0);
      setActiveTab("library");

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "Error al conectar con el servidor de análisis.");
    } finally {
      setIsAnalyzing(false);
      setAnalysisProgress("");
    }
  };

  // Delete Voice Profile
  const handleDeleteProfile = async (id: string, e: MouseEvent) => {
    e.stopPropagation();
    if (confirm("¿Estás seguro de que deseas eliminar este perfil de voz clonado?")) {
      try {
        await deleteProfileFromDB(id);
        const filtered = profiles.filter(p => p.id !== id);
        setProfiles(filtered);
        
        // Select fallback preset
        if (selectedProfile?.id === id) {
          setSelectedProfile(filtered[0] || PRESET_PROFILES[0]);
        }
        setSuccessMsg("Perfil de voz eliminado correctamente.");
      } catch (err) {
        setErrorMsg("No se pudo eliminar el perfil de la base de datos.");
      }
    }
  };

  // Test custom text generation (Neural Synthesis)
  const handleSynthesizeText = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!selectedProfile) {
      setErrorMsg("Por favor, selecciona o crea un perfil de voz primero.");
      return;
    }
    if (!synthesisText.trim()) {
      setErrorMsg("Escribe el texto que deseas que lea la voz clonada.");
      return;
    }

    setIsSynthesizing(true);

    // Fallback: Local Browser Speech Synthesis
    if (synthesisEngine === "local") {
      try {
        if (!window.speechSynthesis) {
          throw new Error("La síntesis local no es compatible con este navegador.");
        }

        // Setup utterance
        const utterance = new SpeechSynthesisUtterance(synthesisText);
        
        // Map pitch/rate variables parsed from profile rules
        const pitchText = (selectedProfile.analysis?.pitch || "").toLowerCase();
        const speedText = (selectedProfile.analysis?.speed || "").toLowerCase();

        if (pitchText.includes("grave") || pitchText.includes("bajo")) utterance.pitch = 0.7;
        else if (pitchText.includes("agud") || pitchText.includes("alt")) utterance.pitch = 1.3;
        else utterance.pitch = 1.0;

        if (speedText.includes("paus") || speedText.includes("lent")) utterance.rate = 0.82;
        else if (speedText.includes("ráp") || speedText.includes("veloz")) utterance.rate = 1.25;
        else utterance.rate = 1.0;

        // Localized language select
        const accentText = (selectedProfile.analysis?.accent || "").toLowerCase();
        if (accentText.includes("españa") || accentText.includes("castellano")) {
          utterance.lang = "es-ES";
        } else {
          utterance.lang = "es-MX";
        }

        // Trigger local playback
        window.speechSynthesis.speak(utterance);
        
        // Append local item to history logs (without physical file storage)
        const localAudit: SynthesizedAudio = {
          id: `synth-${Date.now()}`,
          profileId: selectedProfile.id,
          profileName: selectedProfile.name,
          text: synthesisText,
          createdAt: new Date().toISOString(),
          audioUrl: "", // plays on synthesis queue natively
          audioBase64: ""
        };
        
        setSynthesizedList(prev => [localAudit, ...prev]);
        setSuccessMsg("Lectura local iniciada con éxito.");
        setIsSynthesizing(false);
      } catch (err: any) {
        setErrorMsg(err.message || "Error al realizar la síntesis por voz local.");
        setIsSynthesizing(false);
      }
      return;
    }

    // High Fidelity Neural Cloning (Server side calling Gemini with actual audio context)
    try {
      const response = await fetch("/api/clone-voice-tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: synthesisText.trim(),
          audioBase64: selectedProfile.sampleAudioBase64,
          mimeType: selectedProfile.sampleAudioMimeType,
          voiceProperties: selectedProfile.analysis,
          additionalClips: selectedProfile.additionalClips || [],
          emotion: emotionSelection
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Fallo en la síntesis neural.");
      }

      // Convert raw 15-24kHz PCM from Gemini into native Audio Blob ObjectURL
      const sampleRate = data.mimeType?.includes("rate=24000") ? 24000 : 24000;
      const wavBlobUrl = pcmToWav(data.audioBase64, sampleRate);

      const newSynthAudio: SynthesizedAudio = {
        id: `synth-${Date.now()}`,
        profileId: selectedProfile.id,
        profileName: selectedProfile.name,
        text: synthesisText.trim(),
        createdAt: new Date().toISOString(),
        audioUrl: wavBlobUrl,
        audioBase64: data.audioBase64
      };

      const updatedHistory = [newSynthAudio, ...synthesizedList];
      setSynthesizedList(updatedHistory);
      
      // Save JSON index list to local storage to persist between compiles (excluding raw binary if too large, wait, we can store it)
      const shrinkHistory = updatedHistory.map(item => ({
        id: item.id,
        profileId: item.profileId,
        profileName: item.profileName,
        text: item.text,
        createdAt: item.createdAt,
        audioBase64: item.audioBase64
      })).slice(0, 10); // persist up to 10 speeches inside LocalStorage limits safely
      
      try {
        localStorage.setItem("cloned_audio_history", JSON.stringify(shrinkHistory));
      } catch (err) {
        console.warn("Failed to write to localStorage:", err);
      }

      setSynthesisText(""); // clear input on success read
      setSuccessMsg("¡Voz sintetizada con éxito! Escúchala en el historial inferior.");

    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "No se pudo conectar al motor de síntesis neural.");
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Play / Pause generated clip
  const handlePlayAudio = (audioObj: SynthesizedAudio) => {
    // If local speech synthesised, use speech synthesiser repeat
    if (!audioObj.audioUrl) {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(audioObj.text);
        window.speechSynthesis.speak(utterance);
      }
      return;
    }

    if (playingAudioId === audioObj.id) {
      if (currentAudioElementRef.current) {
        currentAudioElementRef.current.pause();
        setPlayingAudioId(null);
      }
    } else {
      // Pause current
      if (currentAudioElementRef.current) {
        currentAudioElementRef.current.pause();
      }

      const audio = new Audio(audioObj.audioUrl);
      currentAudioElementRef.current = audio;
      setPlayingAudioId(audioObj.id);

      audio.onended = () => {
        setPlayingAudioId(null);
      };

      audio.onerror = () => {
        setErrorMsg("Error al cargar o reproducir el archivo de audio.");
        setPlayingAudioId(null);
      };

      audio.play().catch((err) => {
        console.warn("Audio playback was suspended or blocked:", err);
        setPlayingAudioId(null);
      });
    }
  };

  // Play profile raw sample voice
  const [playingSampleProfileId, setPlayingSampleProfileId] = useState<string | null>(null);
  const profileAudioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlaySampleAudio = (profile: VoiceProfile) => {
    if (playingSampleProfileId === profile.id) {
      if (profileAudioRef.current) {
        profileAudioRef.current.pause();
        setPlayingSampleProfileId(null);
      }
    } else {
      if (profileAudioRef.current) {
        profileAudioRef.current.pause();
      }

      // Convert stored base64 sample back to playable object URL
      let wavUrl = "";
      if (profile.sampleAudioBase64.includes("UklGR")) {
        // If dummy preset placeholder, play a polite speech voice Synthesis
        if (window.speechSynthesis) {
          window.speechSynthesis.cancel();
          const greeting = new SpeechSynthesisUtterance(
            `Hola, soy la plantilla para ${profile.name}. Graba tu propia voz para sintonizar un clon real.`
          );
          greeting.lang = "es-ES";
          window.speechSynthesis.speak(greeting);
          return;
        }
      }

      // If user voice, reconstruct WAV or use recorded block
      const binaryString = atob(profile.sampleAudioBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const voiceBlob = new Blob([bytes], { type: profile.sampleAudioMimeType });
      wavUrl = URL.createObjectURL(voiceBlob);

      const audio = new Audio(wavUrl);
      profileAudioRef.current = audio;
      setPlayingSampleProfileId(profile.id);

      audio.onended = () => {
        setPlayingSampleProfileId(null);
      };

      audio.play().catch((err) => {
        console.warn("Sample audio playback was suspended or blocked:", err);
        setPlayingSampleProfileId(null);
      });
    }
  };

  const handleDownloadAudio = (audioObj: SynthesizedAudio) => {
    if (!audioObj.audioUrl) return;
    const a = document.createElement("a");
    a.href = audioObj.audioUrl;
    a.download = `VozClonada_${audioObj.profileName.replace(/\s+/g, "_")}_${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const getPresetSamplePlayStatus = (id: string) => {
    return playingSampleProfileId === id;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-200 font-sans antialiased" id="voice-cloner-app">
      {/* Upper Navigation Hub */}
      <header className="border-b border-white/10 bg-[#0d0d0f] sticky top-0 z-30" id="main-header">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-violet-500 to-fuchsia-600 p-2 rounded-lg text-white flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-display font-medium text-lg tracking-tight text-white">
                VoxClone<span className="text-violet-400">.ai</span>
              </h1>
              <p className="text-[10px] font-mono text-zinc-500">ESTUDIO DE SÍNTESIS</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
              Servidor Listo
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8" id="studio-workplace">
        {/* Banner Hero */}
        <div className="glass rounded-2xl p-6 sm:p-8 mb-8 relative overflow-hidden bg-gradient-to-r from-violet-950/20 via-black/20 to-transparent" id="studio-banner">
          <div className="max-w-2xl relative z-10">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-violet-500/10 text-violet-300 border border-violet-500/20 mb-3">
              <Sparkles className="w-3.5 h-3.5" /> Tecnología de Clonación Homóloga
            </span>
            <h2 className="font-display font-bold text-2xl sm:text-3xl text-white tracking-tight mb-2">
              Clona cualquier voz de forma natural
            </h2>
            <p className="text-gray-400 text-sm sm:text-base leading-relaxed">
              Registra una grabación de voz leyendo uno de los guiones de prueba. Nuestro motor de IA analizará de forma exhaustiva sus componentes acústicos para replicarla de manera precisa sobre cualquier texto sin contratiempos.
            </p>
          </div>
          <div className="absolute right-0 bottom-0 top-0 w-1/3 opacity-[0.03] pointer-events-none hidden md:block">
            <Music className="w-full h-full text-white" />
          </div>
        </div>

        {/* Global Notifications Panel */}
        {errorMsg && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-start gap-3 text-rose-200 text-sm animate-fade-in" id="error-notification">
            <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
            <div className="grow">
              <p className="font-semibold">Ha ocurrido un inconveniente</p>
              <p className="text-rose-300 mt-0.5">{errorMsg}</p>
            </div>
            <button onClick={() => setErrorMsg(null)} className="text-rose-400 hover:text-rose-200 font-bold p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {successMsg && (
          <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-3 text-emerald-200 text-sm animate-fade-in" id="success-notification">
            <Check className="w-5 h-5 shrink-0 text-emerald-400" />
            <div className="grow">
              <p className="font-bold">Acción completada</p>
              <p className="text-emerald-300 mt-0.5">{successMsg}</p>
            </div>
            <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-200 font-bold p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Main Workspace Column Split */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8" id="workspace-grid">
          
          {/* LEFT: Perfiles de Audio Management */}
          <div className="lg:col-span-5 flex flex-col gap-6" id="left-column">
            
            <div className="glass rounded-2xl shadow-xl overflow-hidden bg-white/[0.01]">
              {/* Card Header Selector Tabs */}
              <div className="flex border-b border-white/5 bg-black/20 p-1">
                <button
                  onClick={() => setActiveTab("library")}
                  className={`flex-1 py-2.5 px-4 text-xs font-semibold rounded-lg transition-all ${
                    activeTab === "library"
                      ? "bg-white/10 text-white shadow-md border border-white/10"
                      : "text-zinc-400 hover:text-white"
                  }`}
                  id="tab-library"
                >
                  Tus Voces ({profiles.length})
                </button>
                <button
                  onClick={() => setActiveTab("create")}
                  className={`flex-1 py-2.5 px-4 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    activeTab === "create"
                      ? "bg-white/10 text-white shadow-md border border-white/10"
                      : "text-zinc-400 hover:text-white"
                  }`}
                  id="tab-create"
                >
                  <Plus className="w-3.5 h-3.5" /> Nueva Voz
                </button>
              </div>

              {/* LIST OF VOICES */}
              {activeTab === "library" ? (
                <div className="p-5 flex flex-col gap-4 max-h-[580px] overflow-y-auto custom-scrollbar" id="profiles-list-container">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">
                    Selecciona un perfil para síntesis
                  </div>
                  
                  {profiles.length === 0 ? (
                    <div className="text-center py-12 text-zinc-500" id="empty-profiles">
                      <FileAudio className="w-12 h-12 mx-auto mb-3 text-zinc-700" />
                      <p className="font-semibold text-zinc-400">No hay perfiles de voz</p>
                      <p className="text-xs text-zinc-500 mt-1">Crea una nueva voz para empezar.</p>
                    </div>
                  ) : (
                    profiles.map((profile) => (
                      <div
                        key={profile.id}
                        onClick={() => setSelectedProfile(profile)}
                        className={`p-4 rounded-xl border transition-all cursor-pointer relative group ${
                          selectedProfile?.id === profile.id
                            ? "border-violet-500/80 bg-violet-500/10 active-voice"
                            : "border-white/5 bg-white/[0.01] hover:border-white/20"
                        }`}
                        id={`profile-card-${profile.id}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="grow">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-sm text-white">{profile.name}</h3>
                              {profile.isPreset ? (
                                <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white/5 text-zinc-400 font-mono">
                                  PRESET
                                </span>
                              ) : (
                                <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-300 font-mono">
                                  PROPIO
                                </span>
                              )}
                            </div>
                            <p className="text-zinc-400 text-xs mt-1 line-clamp-2">{profile.description}</p>
                          </div>
                          
                          {/* Play training Sample audio trigger */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlaySampleAudio(profile);
                            }}
                            className={`p-2 rounded-full border transition-all hover:scale-105 shrink-0 ${
                              getPresetSamplePlayStatus(profile.id)
                                ? "bg-violet-600 text-white border-violet-500 shadow-lg shadow-violet-500/20"
                                : "bg-white/5 text-zinc-300 border-white/10 hover:text-white hover:bg-white/10"
                            }`}
                            title="Oír muestra vocal"
                          >
                            {getPresetSamplePlayStatus(profile.id) ? (
                              <Square className="w-3.5 h-3.5 fill-white" />
                            ) : (
                              <Play className="w-3.5 h-3.5 fill-current" />
                            )}
                          </button>
                        </div>

                        {/* Metadata row */}
                        <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/5 text-[10px] text-zinc-500 font-mono">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5" />
                            {new Date(profile.createdAt).toLocaleDateString("es-ES")}
                          </span>
                          {!profile.isPreset && (
                            <button
                              onClick={(e) => handleDeleteProfile(profile.id, e)}
                              className="text-rose-400 hover:text-rose-500 p-1 rounded-sm hover:bg-rose-500/15 transition-colors"
                              title="Eliminar voz"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : (
                /* CREATION FORM FOR VOICE PROFILES */
                <form onSubmit={handleAnalyzeAndCreateProfile} className="p-6 flex flex-col gap-5" id="profile-creation-form">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
                    Registrar nueva voz
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Nombre de la Voz</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 rounded-lg border border-white/10 text-sm text-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 bg-white/[0.02]"
                      placeholder="Ej. Mi Voz Natural, Tío Juan, Locutor Corporativo"
                      value={newProfileName}
                      onChange={(e) => setNewProfileName(e.target.value)}
                      required
                      disabled={isAnalyzing}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">Descripción Breve</label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 rounded-lg border border-white/10 text-sm text-white focus:outline-none focus:border-violet-500 bg-white/[0.02]"
                      placeholder="Ej. Tono cálido con un acento suave del norte"
                      value={newProfileDesc}
                      onChange={(e) => setNewProfileDesc(e.target.value)}
                      disabled={isAnalyzing}
                    />
                  </div>

                  {/* Sample Reading Assistant */}
                  <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl" id="script-assistant">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-zinc-300">Guión de Entrenamiento Recomendado</span>
                      <span className="text-[10px] font-bold text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded-full font-mono uppercase">
                        Lectura
                      </span>
                    </div>

                    <p className="text-zinc-400 text-xs leading-relaxed italic border-l-2 border-violet-500 pl-3 py-1 font-sans">
                      "{selectedScript.text}"
                    </p>

                    <div className="flex gap-1.5 flex-wrap mt-3 pt-3 border-t border-white/5">
                      {TRAINING_SCRIPTS.map((script) => (
                        <button
                          key={script.id}
                          type="button"
                          onClick={() => setSelectedScript(script)}
                          className={`text-[10px] px-2.5 py-1 rounded-md transition-colors ${
                            selectedScript.id === script.id
                              ? "bg-violet-600 text-white font-medium"
                              : "bg-white/5 text-zinc-400 hover:bg-white/10 border border-white/5"
                          }`}
                        >
                          {script.title}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Audio source choice (Mic or upload) */}
                  <div className="border border-white/5 rounded-xl p-4 bg-white/[0.01]" id="audio-record-box">
                    <div className="text-xs font-semibold text-zinc-300 mb-3 flex items-center justify-between">
                      <span>Muestra de Audio</span>
                      {uploadedFileName && (
                        <span className="text-[10px] font-mono text-emerald-400 truncate max-w-[150px]">
                          📎 {uploadedFileName}
                        </span>
                      )}
                    </div>

                    {/* Canvas Waveform Visualizer */}
                    {isRecording && (
                      <div className="mb-4 rounded-lg overflow-hidden border border-white/10">
                        <canvas ref={canvasRef} width="300" height="80" className="w-full h-20 bg-zinc-950" />
                      </div>
                    )}

                    <div className="flex items-center gap-4">
                      {/* Live Recorder Button */}
                      {isRecording ? (
                        <button
                          type="button"
                          onClick={stopRecording}
                          className="flex-1 min-h-11 bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-sm animate-pulse"
                        >
                          <Square className="w-4 h-4 fill-white" />
                          Detener ({recordingTime}s)
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={startRecording}
                          disabled={isAnalyzing}
                          className="flex-1 min-h-11 bg-[#16161a] border border-white/10 hover:bg-white/10 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-semibold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-sm"
                        >
                          <Mic className="w-4 h-4" />
                          Grabar Micro
                        </button>
                      )}

                      {/* File Uploader Fallback */}
                      <div className="relative flex-1 min-h-11">
                        <input
                          type="file"
                          accept="audio/*"
                          onChange={handleFileUpload}
                          disabled={isRecording || isAnalyzing}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
                          id="file-upload-input"
                        />
                        <div className="w-full h-full border border-white/10 hover:border-white/20 bg-white/5 text-zinc-300 hover:text-white font-semibold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-all">
                          <Upload className="w-4 h-4 text-zinc-400" />
                          Subir Archivo
                        </div>
                      </div>
                    </div>

                    {recordedBlob && !isRecording && (
                      <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between bg-white/[0.02] p-3 rounded-lg border border-white/5">
                        <span className="text-xs text-zinc-500 font-mono">
                          🎙️ Muestra lista ({recordedBlob.size > 1024 * 1024 ? `${(recordedBlob.size / (1024 * 1024)).toFixed(2)} MB` : `${(recordedBlob.size / 1024).toFixed(0)} KB`})
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const aud = new Audio(URL.createObjectURL(recordedBlob));
                            aud.play().catch((err) => {
                              console.warn("Recorded voice playback blocked:", err);
                            });
                          }}
                          className="text-xs text-violet-400 hover:text-violet-300 font-semibold flex items-center gap-1"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" /> Oír grabada
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Submit Action */}
                  <button
                    type="submit"
                    disabled={isAnalyzing || isRecording || !recordedBase64}
                    className="w-full min-h-11 bg-violet-600 hover:bg-violet-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-semibold py-3 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-violet-500/25"
                    id="analyze-submit-button"
                  >
                    {isAnalyzing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>{analysisProgress}</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Analizar e Iniciar Clonación de Voz</span>
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>

            {/* Vocal Physical Characteristics Card Details */}
            {selectedProfile && (
              <div className="glass rounded-2xl p-5 shadow-lg bg-white/[0.01]" id="vocal-analysis-card">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/5">
                  <Brain className="w-5 h-5 text-violet-400" />
                  <h3 className="font-display font-semibold text-sm text-white">Firma Acústica Evaluada</h3>
                </div>

                {!selectedProfile.analysis ? (
                  <div className="text-center py-4 text-zinc-500 text-xs italic">
                    Sin datos de análisis acústicos consolidados para este perfil.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4 text-xs" id="analysis-grid">
                    <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl">
                      <span className="block text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1">Tono (Pitch)</span>
                      <span className="font-mono font-semibold text-white">{selectedProfile.analysis.pitch}</span>
                    </div>

                    <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl">
                      <span className="block text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1">Ritmo (Cadencia)</span>
                      <span className="font-mono font-semibold text-white">{selectedProfile.analysis.speed}</span>
                    </div>

                    <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl">
                      <span className="block text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1">Timbre / Resonancia</span>
                      <span className="font-semibold text-white leading-tight block">{selectedProfile.analysis.timbre}</span>
                    </div>

                    <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl">
                      <span className="block text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1">Acento / Dialecto</span>
                      <span className="font-semibold text-white block">{selectedProfile.analysis.accent}</span>
                    </div>

                    <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl col-span-2">
                      <span className="block text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1">Tono Actoral / Carácter</span>
                      <span className="text-zinc-300 block">{selectedProfile.analysis.genderAndTone} ({selectedProfile.analysis.emotionalVibe})</span>
                    </div>

                    <div className="p-3 bg-violet-500/5 rounded-xl col-span-2 border border-violet-500/20">
                      <span className="block text-[10px] text-violet-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1">
                        <Sliders className="w-3 h-3" /> Directiva de Replicación de IA
                      </span>
                      <p className="text-zinc-300 text-xs leading-relaxed italic mt-1 font-sans">
                        "{selectedProfile.analysis.customPromptInstruction}"
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Refinement auxiliary clips uploading card */}
            {selectedProfile && (
              <div className="glass rounded-2xl p-5 shadow-lg bg-white/[0.01]" id="voice-refiner-card">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-violet-400 animate-pulse" />
                    <h3 className="font-display font-semibold text-sm text-white">Refinamiento y Calidad del Clon</h3>
                  </div>
                  {selectedProfile.isPreset && (
                    <span className="text-[10px] bg-white/5 border border-white/5 text-zinc-400 px-2.5 py-0.5 rounded-lg font-mono">
                      Lectura-Solo
                    </span>
                  )}
                </div>

                <p className="text-zinc-400 text-xs leading-relaxed mb-4 font-sans">
                  Sube grabaciones secundarias de 20 a 30 segundos (en cualquier formato de audio) para nutrir de más matices, timbre y naturalidad al modelo de síntesis neural.
                </p>

                {selectedProfile.isPreset ? (
                  <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl text-center text-xs text-zinc-500 italic font-sans">
                    Las voces predefinidas de sistema no se pueden refinar. Crea un perfil de voz personalizado en la pestaña superior de clonación para adjuntar tus propios clips de audio.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Tiny drag & drop or button zone */}
                    <div className="relative group">
                      <input
                        type="file"
                        accept="audio/*"
                        disabled={isRefining}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleAddRefinementClip(file);
                        }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
                      />
                      <div className="w-full py-4 border border-dashed border-white/10 group-hover:border-violet-500/30 bg-white/[0.01] group-hover:bg-violet-950/20 text-zinc-400 group-hover:text-violet-300 rounded-xl text-xs flex flex-col items-center justify-center gap-2 transition-all">
                        {isRefining ? (
                          <>
                            <RefreshCw className="w-5 h-5 animate-spin text-violet-400" />
                            <span className="font-sans">Procesando y modulando nuevo clip...</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-5 h-5" />
                            <span className="font-semibold font-sans">Subir clip de voz adicional (~30s)</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Integrated list of auxiliary training files */}
                    <div>
                      <span className="block text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-2">
                        Clips de Refino Integrados ({selectedProfile.additionalClips?.length || 0})
                      </span>
                      
                      {(!selectedProfile.additionalClips || selectedProfile.additionalClips.length === 0) ? (
                        <div className="text-center py-4 border border-dashed border-white/5 bg-white/[0.01] rounded-xl text-zinc-500 text-xs italic font-sans">
                          Aún no has agregado clips extras. Sube muestras de audio de unos 30s de duración para una duplicación vocal de escala cinemática.
                        </div>
                      ) : (
                        <div className="max-h-44 overflow-y-auto space-y-2 pr-1" id="custom-refinement-clips-list">
                          {selectedProfile.additionalClips.map((clip) => (
                            <div key={clip.id} className="flex items-center justify-between p-2.5 bg-white/[0.02] border border-white/5 rounded-xl transition-all hover:bg-white/[0.04]">
                              <div className="flex items-center gap-2 truncate flex-1 min-w-0 pr-2">
                                <div className="p-1 px-1.5 bg-violet-600/10 text-violet-400 rounded-md font-mono text-[9px] border border-violet-500/10 shrink-0">
                                  Refil
                                </div>
                                <div className="truncate text-xs text-zinc-300 font-medium font-sans">
                                  {clip.name}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[9px] font-mono text-zinc-500">
                                  {(clip.size / 1024).toFixed(0)} KB
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveRefinementClip(clip.id)}
                                  className="text-zinc-500 hover:text-rose-400 p-1 rounded-md transition-colors"
                                  title="Remover clip"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT: Text synthesiser & Reader Speech Station */}
          <div className="lg:col-span-7 flex flex-col gap-6 animate-fade-in-right" id="right-column">
            
            <div className="glass rounded-2xl p-6 shadow-xl bg-white/[0.01]" id="synthesize-workspace-box">
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-5 h-5 text-violet-400" />
                  <h3 className="font-display font-medium text-white">Estación de Narración con Voz Clonada</h3>
                </div>
                {selectedProfile && (
                  <span className="text-xs bg-violet-500/10 text-violet-300 rounded-lg px-2.5 py-1 font-semibold border border-violet-500/20">
                    Voz activa: {selectedProfile.name}
                  </span>
                )}
              </div>

              <form onSubmit={handleSynthesizeText} className="flex flex-col gap-5">
                {/* Engine Selector */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wide">Motor de Síntesis Vocal</label>
                  <div className="grid grid-cols-2 gap-3" id="engine-selector">
                    <button
                      type="button"
                      onClick={() => setSynthesisEngine("neural")}
                      className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition-all ${
                        synthesisEngine === "neural"
                          ? "border-violet-500 bg-violet-950/30 shadow-md"
                          : "border-white/5 bg-white/[0.01] hover:border-white/20 text-zinc-300"
                      }`}
                    >
                      <Sparkles className={`w-4 h-4 shrink-0 mt-0.5 ${synthesisEngine === "neural" ? "text-violet-400" : "text-zinc-500"}`} />
                      <div>
                        <span className="block text-xs font-bold text-white">Clonación Neural Homóloga</span>
                        <span className="block text-[10px] text-zinc-400 mt-0.5">Replica timbre y entonación 100% natural con IA.</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSynthesisEngine("local")}
                      className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition-all ${
                        synthesisEngine === "local"
                          ? "border-violet-500 bg-violet-950/30 shadow-md"
                          : "border-white/5 bg-white/[0.01] hover:border-white/20 text-zinc-300"
                      }`}
                    >
                      <Sliders className={`w-4 h-4 shrink-0 mt-0.5 ${synthesisEngine === "local" ? "text-violet-400" : "text-zinc-500"}`} />
                      <div>
                        <span className="block text-xs font-bold text-white">Síntesis Rápida Local</span>
                        <span className="block text-[10px] text-zinc-400 mt-0.5">Sintetizador local ajustando el tono y velocidad.</span>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Tone and Emotional Modulation Variations */}
                {synthesisEngine === "neural" && (
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-2.5 uppercase tracking-wide">
                      Modulación de Ánimo y Entonación Emocional
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5" id="emotion-variations">
                      {[
                        { id: "auto", label: "Auto 🔮", desc: "Análisis inteligente según el contexto" },
                        { id: "friendly", label: "Cercano 😊", desc: "Tono empático, comprensivo y amigable" },
                        { id: "cheerful", label: "Alegre 🎉", desc: "Narración entusiasta, radiante y motivadora" },
                        { id: "serious", label: "Formal 💼", desc: "Estilo corporativo, serio y sofisticado" },
                        { id: "sad", label: "Melancólico 😔", desc: "Cadencia pausada, sentimental y nostálgica" },
                        { id: "dramatic", label: "Dramático 🎭", desc: "Intensidad expresiva, teatral y misteriosa" }
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setEmotionSelection(item.id)}
                          className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                            emotionSelection === item.id
                              ? "border-violet-500 bg-violet-500/10 text-white shadow-lg shadow-violet-500/5"
                              : "border-white/5 bg-white/[0.01] hover:border-white/10 text-zinc-400 hover:text-white"
                          }`}
                          title={item.desc}
                        >
                          <div>
                            <span className="block text-xs font-bold font-sans">{item.label.split(" ")[0]}</span>
                            <span className="block text-[9px] text-zinc-500 mt-0.5 mt-0.5 line-clamp-1">{item.desc}</span>
                          </div>
                          <span className="text-[15px] select-none">{item.label.split(" ")[1] || ""}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Input text body */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wide">Texto a Narrar</label>
                    <span className="text-[10px] font-mono text-zinc-500 font-semibold">{synthesisText.length}/500 caracteres</span>
                  </div>

                  <textarea
                    rows={6}
                    maxLength={500}
                    className="w-full p-4 rounded-xl border border-white/10 text-sm text-gray-200 focus:outline-none focus:border-violet-500 bg-white/[0.02] leading-relaxed font-sans"
                    placeholder="Escribe el párrafo que deseas escuchar recitado con la voz clonada que seleccionaste en la columna izquierda..."
                    value={synthesisText}
                    onChange={(e) => setSynthesisText(e.target.value)}
                    required
                    disabled={isSynthesizing}
                  />

                  {/* Suggestive short prompt feeds */}
                  <div className="flex items-center gap-1.5 flex-wrap mt-2.5" id="suggestive-texts-container">
                    <span className="text-[10px] font-semibold text-zinc-500 mr-1 uppercase">Sugerencias:</span>
                    <button
                      type="button"
                      disabled={isSynthesizing}
                      onClick={() => setSynthesisText("Hola, qué tal. Este es mi primer prototipo de clonación de voz operando con IA y síntesis generativa. ¿Qué te parece cómo suena?")}
                      className="text-[10px] px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/5 text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
                    >
                      🗣️ Probar Clon
                    </button>
                    <button
                      type="button"
                      disabled={isSynthesizing}
                      onClick={() => setSynthesisText("Estimados clientes, nos alegra presentar este nuevo catálogo comercial completamente locutado por agentes de voz homólogos de alta fidelidad.")}
                      className="text-[10px] px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/5 text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
                    >
                      💼 Anuncio Comercial
                    </button>
                    <button
                      type="button"
                      disabled={isSynthesizing}
                      onClick={() => setSynthesisText("Había una vez, un bosque silencioso guardado por hermosos árboles sagrados. Pocos sabían que por las noches, el viento susurraba antiguas fábulas perdidas.")}
                      className="text-[10px] px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/5 text-zinc-300 hover:bg-white/10 hover:text-white transition-colors"
                    >
                      📖 Cuento Fantástico
                    </button>
                  </div>
                </div>

                {/* Synthesis Trigger */}
                <button
                  type="submit"
                  disabled={isSynthesizing || !selectedProfile || !synthesisText.trim()}
                  className="w-full min-h-12 bg-violet-600 hover:bg-violet-700 disabled:bg-zinc-850 disabled:text-zinc-600 text-white font-semibold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-violet-500/25"
                  id="synthesis-submit-button"
                >
                  {isSynthesizing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Clonando y Generando Onda de Audio Neural...</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-4 h-4" />
                      <span>Sintetizar y Leer con la Voz de "{selectedProfile?.name || '...'}"</span>
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Synthesised Speech History Log */}
            <div className="glass rounded-2xl p-6 shadow-xl bg-white/[0.01] flex-1" id="history-scaffolding">
              <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-4 flex items-center justify-between">
                <span>Historial de Narraciones Generadas</span>
                <span className="text-[10px] bg-white/5 py-0.5 px-2 rounded-full font-mono text-zinc-400 font-bold border border-white/5">
                  {synthesizedList.length} clips
                </span>
              </div>

              {synthesizedList.length === 0 ? (
                <div className="text-center py-12 text-zinc-500" id="empty-history">
                  <Music className="w-10 h-10 mx-auto mb-2 text-zinc-700" />
                  <p className="font-semibold text-zinc-400 font-sans">Historial vacío</p>
                  <p className="text-xs text-zinc-500 mt-1">Escribe un texto arriba y pulsa sintetizar para escuchar tu primera clonación.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4 max-h-[460px] overflow-y-auto pr-1" id="history-clips-stack">
                  {synthesizedList.map((audio) => (
                    <div
                      key={audio.id}
                      className="p-4 bg-white/[0.01] border border-white/5 rounded-xl flex flex-col gap-3 hover:border-white/10 transition-all"
                      id={`history-clip-${audio.id}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="grow">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-white">{audio.profileName}</span>
                            <span className="text-[9px] font-mono text-zinc-500">
                              • {new Date(audio.createdAt).toLocaleTimeString("es-ES", { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {!audio.audioUrl && (
                              <span className="text-[8px] font-bold px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-md font-mono uppercase">
                                Local
                              </span>
                            )}
                          </div>
                          <p className="text-zinc-400 text-xs mt-1.5 italic font-sans">
                            "{audio.text}"
                          </p>
                        </div>

                        {/* Player elements */}
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Play Generated Audio Button */}
                          <button
                            onClick={() => handlePlayAudio(audio)}
                            className={`p-2 rounded-lg border transition-all ${
                              playingAudioId === audio.id
                                ? "bg-violet-600 border-violet-500 text-white shadow-lg shadow-violet-500/25"
                                : "bg-white/5 border-white/10 text-zinc-300 hover:text-white hover:bg-white/10"
                            }`}
                            title="Reproducir discurso"
                          >
                            {playingAudioId === audio.id ? (
                              <Square className="w-4 h-4 fill-white" />
                            ) : (
                              <Play className="w-4 h-4 fill-current animate-pulse" />
                            )}
                          </button>

                          {/* Export/Download Audio Link */}
                          {audio.audioUrl && (
                            <button
                              onClick={() => handleDownloadAudio(audio)}
                              className="p-2 rounded-lg border border-white/10 bg-white/5 text-zinc-300 hover:text-white hover:bg-white/10 transition-all "
                              title="Descargar archivo WAV"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </div>
      </main>

      {/* Decorative Brand footer */}
      <footer className="border-t border-white/10 py-8 bg-[#0d0d0f] mt-20 text-center text-xs text-zinc-500" id="brand-footer">
        <div className="max-w-7xl mx-auto px-6">
          <p className="font-display font-medium text-zinc-400">VoxClone.ai — Herramienta Profesional de Síntesis de Voz Humana</p>
          <p className="mt-1 text-zinc-600">© 2026 VoxClone.ai. Funcionando con modelos multimodales Gemini 2.5 Flash de alta fidelidad.</p>
        </div>
      </footer>
    </div>
  );
}
