/**
 * Type declarations for the Voice Cloner system
 */

export interface VoiceAnalysis {
  pitch: string;
  speed: string;
  timbre: string;
  genderAndTone: string;
  emotionalVibe: string;
  accent: string;
  customPromptInstruction: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  sampleAudioBase64: string;
  sampleAudioMimeType: string;
  analysis?: VoiceAnalysis;
  isPreset?: boolean;
  additionalClips?: {
    id: string;
    name: string;
    base64: string;
    mimeType: string;
    createdAt: string;
    size: number;
    duration?: number;
  }[];
}

export interface SynthesizedAudio {
  id: string;
  profileId: string;
  profileName: string;
  text: string;
  createdAt: string;
  audioUrl: string; // Blob URL prepared in current session
  audioBase64: string;
}

export interface ScriptSample {
  id: string;
  category: string;
  title: string;
  text: string;
}
