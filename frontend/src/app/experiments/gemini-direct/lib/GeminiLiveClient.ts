/**
 * GeminiLiveClient - WebSocket client for Gemini Live API
 * Uses the official @google/genai SDK
 */

import {
  GoogleGenAI,
  LiveConnectConfig,
  LiveServerMessage,
  Session,
  Part,
  FunctionDeclaration,
  Tool,
} from "@google/genai";
import { EventEmitter } from "eventemitter3";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiLiveClientEvents {
  stateChange: (state: ConnectionState) => void;
  setupComplete: () => void;
  audio: (data: ArrayBuffer) => void;
  content: (parts: Part[]) => void;
  toolCall: (toolCalls: ToolCall[]) => void;
  turnComplete: () => void;
  interrupted: () => void;
  error: (error: Error) => void;
  log: (type: string, message: string) => void;
}

export interface GeminiLiveClientConfig {
  apiKey: string;
  model?: string;
  voiceName?: string;
  tools?: FunctionDeclaration[];
  systemInstruction?: string;
}

// Helper to convert base64 to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export class GeminiLiveClient extends EventEmitter<GeminiLiveClientEvents> {
  private client: GoogleGenAI;
  private session: Session | null = null;
  private state: ConnectionState = "disconnected";
  private model: string;
  private voiceName: string;
  private tools?: FunctionDeclaration[];
  private systemInstruction?: string;

  constructor(config: GeminiLiveClientConfig) {
    super();
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.model = config.model || "models/gemini-2.5-flash-native-audio-preview-09-2025";
    this.voiceName = config.voiceName || "Charon";
    this.tools = config.tools;
    this.systemInstruction = config.systemInstruction;
  }

  private setState(state: ConnectionState) {
    this.state = state;
    this.emit("stateChange", state);
  }

  private log(type: string, message: string) {
    this.emit("log", type, message);
  }

  getState(): ConnectionState {
    return this.state;
  }

  async connect(): Promise<boolean> {
    if (this.state === "connected" || this.state === "connecting") {
      this.log("client", "Already connected or connecting");
      return false;
    }

    this.setState("connecting");
    this.log("client", "Connecting...");

    const config: LiveConnectConfig = {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: this.voiceName,
          },
        },
      },
    };

    // Add tools if provided
    if (this.tools && this.tools.length > 0) {
      config.tools = [{ functionDeclarations: this.tools }];
      this.log("client", `Tools configured: ${this.tools.map(t => t.name).join(", ")}`);
    }

    // Add system instruction if provided
    if (this.systemInstruction) {
      config.systemInstruction = this.systemInstruction;
    }

    try {
      this.session = await this.client.live.connect({
        model: this.model,
        config,
        callbacks: {
          onopen: () => {
            this.log("server", "Connection opened");
          },
          onmessage: (message: LiveServerMessage) => {
            this.handleMessage(message);
          },
          onerror: (error: ErrorEvent) => {
            this.log("server", `Error: ${error.message}`);
            this.emit("error", new Error(error.message));
          },
          onclose: (event: CloseEvent) => {
            this.log("server", `Connection closed: ${event.code} ${event.reason}`);
            this.setState("disconnected");
            this.session = null;
          },
        },
      });

      this.setState("connected");
      this.log("client", "Connected successfully");
      return true;
    } catch (err) {
      this.log("client", `Connection failed: ${err}`);
      this.setState("error");
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      return false;
    }
  }

  private handleMessage(message: LiveServerMessage) {
    // Setup complete
    if (message.setupComplete) {
      this.log("server", "Setup complete");
      this.emit("setupComplete");
      return;
    }

    // Server content (audio, transcriptions, turn complete)
    if (message.serverContent) {
      const content = message.serverContent;

      // Handle interruption
      if ("interrupted" in content && content.interrupted) {
        this.log("server", "Interrupted");
        this.emit("interrupted");
        return;
      }

      // Handle turn complete
      if ("turnComplete" in content && content.turnComplete) {
        this.log("server", "Turn complete");
        this.emit("turnComplete");
      }

      // Handle model turn (audio and other content)
      if ("modelTurn" in content && content.modelTurn?.parts) {
        const parts = content.modelTurn.parts;
        const audioParts: Part[] = [];
        const otherParts: Part[] = [];

        for (const part of parts) {
          if (part.inlineData?.mimeType?.startsWith("audio/pcm")) {
            audioParts.push(part);
          } else {
            otherParts.push(part);
          }
        }

        // Emit audio data
        for (const part of audioParts) {
          if (part.inlineData?.data) {
            const buffer = base64ToArrayBuffer(part.inlineData.data);
            this.emit("audio", buffer);
            this.log("server", `Audio chunk: ${buffer.byteLength} bytes`);
          }
        }

        // Emit other content
        if (otherParts.length > 0) {
          this.emit("content", otherParts);
          this.log("server", `Content: ${JSON.stringify(otherParts)}`);
        }
      }
    }

    // Tool calls
    if (message.toolCall) {
      const functionCalls = message.toolCall.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        const toolCalls: ToolCall[] = functionCalls.map((fc) => ({
          id: fc.id || "",
          name: fc.name || "",
          args: (fc.args as Record<string, unknown>) || {},
        }));
        this.log("server", `Tool calls: ${toolCalls.map(t => t.name).join(", ")}`);
        this.emit("toolCall", toolCalls);
      }
    }
  }

  /**
   * Send audio data to Gemini
   * @param base64Audio Base64-encoded PCM 16kHz mono audio
   */
  sendAudio(base64Audio: string) {
    if (!this.session || this.state !== "connected") {
      this.log("client", "Cannot send audio - not connected");
      return;
    }

    this.session.sendRealtimeInput({
      media: {
        mimeType: "audio/pcm;rate=16000",
        data: base64Audio,
      },
    });
  }

  /**
   * Send a text message to Gemini
   */
  sendText(text: string) {
    if (!this.session || this.state !== "connected") {
      this.log("client", "Cannot send text - not connected");
      return;
    }

    this.log("client", `Sending text: ${text}`);
    this.session.sendClientContent({
      turns: [{ text }],
      turnComplete: true,
    });
  }

  /**
   * Send an image to Gemini (for screen share / video)
   * @param base64Jpeg Base64-encoded JPEG image
   */
  sendImage(base64Jpeg: string) {
    if (!this.session || this.state !== "connected") {
      return;
    }

    this.session.sendRealtimeInput({
      media: {
        mimeType: "image/jpeg",
        data: base64Jpeg,
      },
    });
  }

  /**
   * Send tool response back to Gemini
   * @param toolCallId The ID from the function call
   * @param toolName The name of the function that was called
   * @param result The result to send back (will be wrapped in {output: result})
   */
  sendToolResponse(toolCallId: string, toolName: string, result: unknown) {
    if (!this.session || this.state !== "connected") {
      this.log("client", "Cannot send tool response - not connected");
      return;
    }

    this.log("client", `Sending tool response for ${toolName} (${toolCallId})`);
    this.session.sendToolResponse({
      functionResponses: [
        {
          id: toolCallId,
          name: toolName,
          response: { output: result },
        },
      ],
    });
  }

  disconnect() {
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    this.setState("disconnected");
    this.log("client", "Disconnected");
  }
}
