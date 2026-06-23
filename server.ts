import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Increase payload limit because of base64 audio
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Lazy init Gemini client
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("La variable GEMINI_API_KEY no está configurada. Por favor regístrala en la sección Settings > Secrets.");
    }
    geminiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return geminiClient;
}

// 1. API: Analyze Voice
app.post("/api/analyze-voice", async (req, res) => {
  try {
    const { audioBase64, mimeType } = req.body;
    if (!audioBase64) {
      return res.status(400).json({ error: "Falta el archivo de audio base64 de la muestra." });
    }

    const ai = getGeminiClient();
    
    // We send to gemini-2.5-flash for multimodal analysis
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            data: audioBase64,
            mimeType: mimeType || "audio/webm",
          }
        },
        "Analiza detalladamente esta muestra de voz grabada. Tu objetivo es catalogarla de manera precisa para un sistema de síntesis y clonación de voz. Identifica su tono general, velocidad de habla, timbre o resonancia acústica, vibra actitudinal, acento geográfico y genera una instrucción de voz completa y profesional en español. Devuelve estrictamente un objeto JSON con el esquema y propiedades exactas requeridas."
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pitch: {
              type: Type.STRING,
              description: "Tono general (por ejemplo: 'Grave', 'Medio', 'Grave profundo', 'Agudo')"
            },
            speed: {
              type: Type.STRING,
              description: "Velocidad de habla (por ejemplo: 'Moderada', 'Pausada', 'Rápida')"
            },
            timbre: {
              type: Type.STRING,
              description: "Características especiales del timbre (por ejemplo: 'Cálido', 'Metálico', 'Rasposo', 'Muy Resonante', 'Aterciopelado', 'Respirado')"
            },
            genderAndTone: {
              type: Type.STRING,
              description: "Género percibido, edad aproximada o tono actitudinal general (por ejemplo: 'Masculino maduro formal', 'Femenino joven alegre')"
            },
            emotionalVibe: {
              type: Type.STRING,
              description: "Estado de ánimo y ambiente acústico (por ejemplo: 'Empático y cercano', 'Elegante corporativo', 'Dinámico entusiasta', 'Calmado y reflexivo')"
            },
            accent: {
              type: Type.STRING,
              description: "Región, origen o acento vocal identificado (por ejemplo: 'Español de España', 'Latino neutro', 'Acento argentino cordobés', 'Mexicano norteño')"
            },
            customPromptInstruction: {
              type: Type.STRING,
              description: "Instrucciones de actuación súper específicas detalladas para que un modelo generativo de audio imite esta voz (por ejemplo: 'Habla con un tono masculino maduro, ritmo pausado con transiciones cálidas, imprime un acento de España neutro con articulación clara.')"
            }
          },
          required: ["pitch", "speed", "timbre", "genderAndTone", "emotionalVibe", "accent", "customPromptInstruction"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("No se obtuvo respuesta del análisis.");
    }

    const analysisData = JSON.parse(resultText.trim());
    res.json({ success: true, analysis: analysisData });
  } catch (error: any) {
    console.error("Error al analizar la voz:", error);
    res.status(500).json({ error: error?.message || "Error al procesar la muestra de audio" });
  }
});

// 2. API: Clone Voice TTS
app.post("/api/clone-voice-tts", async (req, res) => {
  try {
    const { text, audioBase64, mimeType, voiceProperties, additionalClips, emotion } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Falta el texto a sintetizar." });
    }
    if (!audioBase64) {
      return res.status(400).json({ error: "Falta la muestra de voz para clonación." });
    }

    const ai = getGeminiClient();

    const customPromptInstruction = voiceProperties?.customPromptInstruction || 
      "Imita con precisión extrema la voz, acento, timbre y velocidad de la muestra de audio proporcionada.";

    // Construct multi-sample content elements to feed into standard generateContent configuration
    const contents: any[] = [];

    // 1. Primary sample clip
    contents.push({
      inlineData: {
        data: audioBase64,
        mimeType: mimeType || "audio/webm",
      }
    });

    // 2. Auxiliary refined training clips for enhanced fidelity
    if (additionalClips && Array.isArray(additionalClips)) {
      for (const idx of Object.keys(additionalClips)) {
        const clip = additionalClips[parseInt(idx)];
        if (clip && clip.base64) {
          contents.push({
            inlineData: {
              data: clip.base64,
              mimeType: clip.mimeType || "audio/webm",
            }
          });
        }
      }
    }

    // Adapt vocal performance directive on top of target sentiment direction
    let emotionDirective = "";
    if (emotion && emotion !== "auto") {
      switch (emotion) {
        case "cheerful":
          emotionDirective = "Impregna un tono alegre, animado, entusiasta y lleno de energía positiva.";
          break;
        case "sad":
          emotionDirective = "Aplica una entonación nostálgica, pausada, reflexiva y de carácter melancólico profundo.";
          break;
        case "serious":
          emotionDirective = "Expresa con un tono corporativo, riguroso, sobrio y sumamente formal.";
          break;
        case "dramatic":
          emotionDirective = "Lee con dramatismo, misterio, fuerza escénica e intensidad teatral.";
          break;
        case "friendly":
          emotionDirective = "Enuncia de forma sumamente cálida, cercana, empática, tranquila y amigable.";
          break;
        default:
          emotionDirective = `Modula la voz con una emoción de estilo: ${emotion}.`;
      }
    } else {
      emotionDirective = "Analiza el contenido semántico del texto y elige la entonación, ritmo, respiración y modulación más natural acorde al significado contextural de manera completamente orgánica.";
    }

    // 3. System instruction text segment
    const instructionPrompt = `Actúa como la persona que grabó las muestras de audio provistas anteriormente. Has recibido ${contents.length} archivo(s) de muestra para aprender con máxima precisión su firma acústica, timbre, acentuación y modulaciones físicas.
    
    Lee el siguiente texto exactamente en español:
    
    Texto a leer: "${text}"
    
    Directivas obligatorias de síntesis natural:
    1. Firma de voz: Recrea fielmente el timbre, tono base, ritmo promedio de habla y acento dialectal de las muestras de origen. No alteres la identidad de la voz original.
    2. Modulación emocional y naturalidad: ${emotionDirective}
    3. Lee exclusivamente el texto redactado entre comillas.
    4. Está terminantemente prohibido incorporar comentarios sobre la síntesis, preámbulos explicativos, saludos de bienvenida o frases como "aquí tienes tu audio". Entra directo al primer sonido y termina justo al enunciar la última sílaba del texto.`;

    contents.push(instructionPrompt);

    // Query Gemini
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
      config: {
        responseModalities: ["AUDIO"],
      }
    });

    // Extract generated audio
    const candidates = response.candidates;
    const parts = candidates?.[0]?.content?.parts;
    let base64AudioOut = "";
    let mimeTypeOut = "audio/pcm;rate=24000";

    if (parts) {
      for (const part of parts) {
        if (part.inlineData?.data) {
          base64AudioOut = part.inlineData.data;
          if (part.inlineData.mimeType) {
            mimeTypeOut = part.inlineData.mimeType;
          }
          break;
        }
      }
    }

    if (!base64AudioOut) {
      throw new Error("La síntesis no devolvió un flujo de audio legible. Revisa que tu audio de origen no esté saturado o en silencio.");
    }

    res.json({
      success: true,
      audioBase64: base64AudioOut,
      mimeType: mimeTypeOut
    });
  } catch (error: any) {
    console.error("Error al generar TTS clonado:", error);
    res.status(500).json({ error: error?.message || "Error al realizar la síntesis neural de voz" });
  }
});

// Setup Vite or static serving
async function bootstrap() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

bootstrap();
