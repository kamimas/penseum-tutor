/**
 * XaiLiveClient - WebSocket client for xAI Grok Realtime API
 *
 * Based on the OpenAI-compatible realtime protocol used by xAI.
 * Reference: https://docs.x.ai/docs/guides/voice/agent
 */

import { EventEmitter } from "eventemitter3";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface XaiLiveClientEvents {
  stateChange: (state: ConnectionState) => void;
  sessionCreated: (sessionId: string) => void;
  audio: (data: ArrayBuffer) => void;
  toolCall: (toolCalls: ToolCall[]) => void;
  responseCreated: (responseId: string) => void;
  responseDone: (responseId: string, status: "completed" | "cancelled" | "failed") => void;
  speechStarted: (itemId: string) => void;
  speechStopped: (itemId: string) => void;
  inputTranscription: (text: string) => void;
  outputTranscription: (text: string) => void;
  error: (error: Error) => void;
  log: (type: string, message: string) => void;
}

export interface XaiFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface XaiLiveClientConfig {
  apiKey: string;
  baseUrl?: string;
  voice?: "Ara" | "Rex" | "Sal" | "Eve" | "Leo";
  tools?: XaiFunctionTool[];
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

export class XaiLiveClient extends EventEmitter<XaiLiveClientEvents> {
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private apiKey: string;
  private baseUrl: string;
  private voice: "Ara" | "Rex" | "Sal" | "Eve" | "Leo";
  private tools?: XaiFunctionTool[];
  private systemInstruction?: string;
  private sessionId: string | null = null;

  // Track if we're currently receiving a response (for interruption)
  private responding = false;

  constructor(config: XaiLiveClientConfig) {
    super();
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "wss://api.x.ai/v1/realtime";
    this.voice = config.voice || "Ara";
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

  getSessionId(): string | null {
    return this.sessionId;
  }

  async connect(): Promise<boolean> {
    if (this.state === "connected" || this.state === "connecting") {
      this.log("client", "Already connected or connecting");
      return false;
    }

    this.setState("connecting");
    this.log("client", "Connecting...");

    try {
      // xAI uses OpenAI-compatible subprotocols for WebSocket auth
      const protocols = [
        "realtime",
        `openai-insecure-api-key.${this.apiKey}`,
        "openai-beta.realtime-v1",
      ];

      this.ws = new WebSocket(this.baseUrl, protocols);

      await new Promise<void>((resolve, reject) => {
        const onOpen = () => {
          this.ws?.removeEventListener("open", onOpen);
          this.ws?.removeEventListener("error", onError);
          resolve();
        };
        const onError = (event: Event) => {
          this.ws?.removeEventListener("open", onOpen);
          this.ws?.removeEventListener("error", onError);
          reject(new Error("WebSocket connection failed"));
        };

        this.ws!.addEventListener("open", onOpen);
        this.ws!.addEventListener("error", onError);
      });

      // Set up message handler
      this.ws.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (err) {
          this.emit("error", err instanceof Error ? err : new Error(String(err)));
        }
      });

      this.ws.addEventListener("close", (event) => {
        this.log("server", `Connection closed: ${event.code} ${event.reason}`);
        this.setState("disconnected");
        this.ws = null;
        this.sessionId = null;
      });

      this.ws.addEventListener("error", (event) => {
        this.log("server", "WebSocket error");
        this.emit("error", new Error("WebSocket error"));
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

  private handleMessage(message: Record<string, unknown>) {
    const type = message.type as string;

    switch (type) {
      case "conversation.created":
        // xAI sends this instead of session.created
        const convId = (message.conversation as { id: string })?.id;
        this.sessionId = convId;
        this.log("server", `Session created: ${convId}`);
        this.emit("sessionCreated", convId);

        // Send session.update to configure the session
        this.sendSessionUpdate();
        break;

      case "session.updated":
        this.log("server", "Session updated");
        break;

      case "input_audio_buffer.speech_started":
        const speechStartItemId = message.item_id as string;
        this.log("server", `Speech started: ${speechStartItemId}`);
        this.emit("speechStarted", speechStartItemId);

        // Trigger interruption if we're currently responding
        if (this.responding) {
          this.responding = false;
          // Note: xAI doesn't support response.cancel, so we just stop locally
        }
        break;

      case "input_audio_buffer.speech_stopped":
        const speechStopItemId = message.item_id as string;
        this.log("server", `Speech stopped: ${speechStopItemId}`);
        this.emit("speechStopped", speechStopItemId);
        break;

      case "conversation.item.input_audio_transcription.completed":
        const inputTranscript = message.transcript as string;
        this.log("server", `Input transcription: ${inputTranscript}`);
        this.emit("inputTranscription", inputTranscript);
        break;

      case "response.created":
        const responseId = (message.response as { id: string })?.id;
        this.responding = true;
        this.log("server", `Response created: ${responseId}`);
        this.emit("responseCreated", responseId);
        break;

      case "response.output_audio.delta":
        const audioData = message.delta as string;
        if (audioData) {
          const buffer = base64ToArrayBuffer(audioData);
          this.emit("audio", buffer);
        }
        break;

      case "response.output_audio_transcript.delta":
        const transcriptDelta = message.delta as string;
        if (transcriptDelta) {
          this.emit("outputTranscription", transcriptDelta);
        }
        break;

      case "response.function_call_arguments.done":
        const callId = message.call_id as string;
        const toolName = message.name as string;
        const argsStr = message.arguments as string;

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(argsStr);
        } catch {
          this.log("server", `Failed to parse tool args: ${argsStr}`);
        }

        this.log("server", `Tool call: ${toolName}(${callId})`);
        this.emit("toolCall", [{ id: callId, name: toolName, args }]);
        break;

      case "response.done":
        const doneResponse = message.response as { id: string; status: string };
        this.responding = false;
        this.log("server", `Response done: ${doneResponse?.id} (${doneResponse?.status})`);
        this.emit("responseDone", doneResponse?.id, doneResponse?.status as "completed" | "cancelled" | "failed");
        break;

      default:
        // Log unhandled message types for debugging
        this.log("server", `Unhandled: ${type}`);
    }
  }

  private sendSessionUpdate() {
    if (!this.ws || this.state !== "connected") return;

    const session: Record<string, unknown> = {
      voice: this.voice,
      turn_detection: { type: "server_vad" },
      audio: {
        input: { format: { type: "audio/pcm", rate: 24000 } },
        output: { format: { type: "audio/pcm", rate: 24000 } },
      },
    };

    if (this.systemInstruction) {
      session.instructions = this.systemInstruction;
    }

    if (this.tools && this.tools.length > 0) {
      session.tools = this.tools;
      this.log("client", `Tools configured: ${this.tools.map(t => t.name).join(", ")}`);
    }

    this.send({ type: "session.update", session });
    this.log("client", "Session update sent");
  }

  private send(message: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log("client", "Cannot send - not connected");
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Send audio data to xAI
   * @param base64Audio Base64-encoded PCM 24kHz mono audio
   */
  sendAudio(base64Audio: string) {
    if (!this.ws || this.state !== "connected") {
      return;
    }

    this.send({
      type: "input_audio_buffer.append",
      audio: base64Audio,
    });
  }

  /**
   * Send a text message to xAI
   * This creates a conversation item and triggers a response
   */
  sendText(text: string) {
    if (!this.ws || this.state !== "connected") {
      this.log("client", "Cannot send text - not connected");
      return;
    }

    this.log("client", `Sending text: ${text}`);

    // Create conversation item
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });

    // Trigger response
    this.send({ type: "response.create" });
  }

  /**
   * Send tool response back to xAI
   * @param callId The ID from the function call
   * @param result The result to send back (will be stringified if not a string)
   * @param silent If true, don't trigger a follow-up response (model won't speak)
   */
  sendToolResponse(callId: string, result: unknown, silent = false) {
    if (!this.ws || this.state !== "connected") {
      this.log("client", "Cannot send tool response - not connected");
      return;
    }

    const output = typeof result === "string" ? result : JSON.stringify(result);

    this.log("client", `Sending tool response for ${callId}${silent ? " (silent)" : ""}`);

    // Send tool result as function_call_output
    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output,
      },
    });

    // Trigger follow-up response (unless silent)
    if (!silent) {
      this.send({ type: "response.create" });
    }
  }

  /**
   * Commit the audio buffer (for manual turn detection)
   */
  commitAudio() {
    this.send({ type: "input_audio_buffer.commit" });
  }

  /**
   * Clear the audio buffer
   */
  clearAudio() {
    this.send({ type: "input_audio_buffer.clear" });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState("disconnected");
    this.sessionId = null;
    this.log("client", "Disconnected");
  }
}
