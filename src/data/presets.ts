import { VoiceProfile } from "../types";

// A tiny valid 1-second muted WAV file base64 to avoid startup crashes if custom presets are selected.
// Users can use these presets directly as demo templates.
const DUMMY_AUDIO_BASE64 = "UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAAAD";

export const PRESET_PROFILES: VoiceProfile[] = [
  {
    id: "preset-1",
    name: "Alejandro (Locutor de Radio)",
    description: "Voz masculina profunda, ideal para narraciones dramáticas y anuncios de impacto.",
    createdAt: "2026-06-22T12:00:00Z",
    sampleAudioBase64: DUMMY_AUDIO_BASE64,
    sampleAudioMimeType: "audio/wav",
    isPreset: true,
    analysis: {
      pitch: "Grave y resonante",
      speed: "Pausada con cadencia dramática",
      timbre: "Cálido con notable presencia de armónicos de pecho",
      genderAndTone: "Masculino maduro e institucional",
      emotionalVibe: "Seguro, elegante y persuasivo",
      accent: "Español castellano con articulación definida de consonantes",
      customPromptInstruction: "Habla con un tono de barítono profundo, pronunciando lentamente cada sílaba, proyectando calidez e introduciendo pausas reflexivas naturales."
    }
  },
  {
    id: "preset-2",
    name: "Sofia (Socia Tecnológica)",
    description: "Voz femenina clara, moderna y ágil, perfecta para videos educativos o corporativos.",
    createdAt: "2026-06-22T13:00:00Z",
    sampleAudioBase64: DUMMY_AUDIO_BASE64,
    sampleAudioMimeType: "audio/wav",
    isPreset: true,
    analysis: {
      pitch: "Medio-agudo definido",
      speed: "Moderada y fluida",
      timbre: "Brillante, cristalino y aireado",
      genderAndTone: "Femenino joven, profesional y enérgico",
      emotionalVibe: "Dinámico, empático y entusiasta",
      accent: "Latinoamericano neutro",
      customPromptInstruction: "Usa una voz femenina dinámica de rango medio, articulación jovial, entonación alegre y aireada, proyectando optimismo e innovación."
    }
  },
  {
    id: "preset-3",
    name: "Héctor (Profesor de Historia)",
    description: "Tono reflexivo y acogedor, excelente para audiolibros largos o documentales históricos.",
    createdAt: "2026-06-22T14:00:00Z",
    sampleAudioBase64: DUMMY_AUDIO_BASE64,
    sampleAudioMimeType: "audio/wav",
    isPreset: true,
    analysis: {
      pitch: "Medio-grave rítmico",
      speed: "Tranquila y deliberada",
      timbre: "Aterciopelado, con grano suave",
      genderAndTone: "Masculino mayor de edad, erudito",
      emotionalVibe: "Sereno, sabio e intelectual",
      accent: "Sudamericano con tonos suaves",
      customPromptInstruction: "Habla con una voz masculina mayor rítmica y tranquila de tono medio, respirando suavemente al final de las oraciones para proyectar sabiduría."
    }
  }
];
