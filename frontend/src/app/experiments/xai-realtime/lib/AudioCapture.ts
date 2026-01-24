/**
 * AudioCapture - Captures microphone audio as PCM 24kHz for xAI
 *
 * xAI requires 24kHz sample rate (unlike Gemini's 16kHz)
 */

import { EventEmitter } from "eventemitter3";

// Inline worklet source - converts Float32 to Int16 PCM
const AudioRecordingWorklet = `
class AudioProcessingWorklet extends AudioWorkletProcessor {
  // Buffer size of 2400 at 24kHz = 100ms chunks (10 times per second)
  buffer = new Int16Array(2400);
  bufferWriteIndex = 0;

  constructor() {
    super();
  }

  process(inputs) {
    if (inputs[0].length) {
      const channel0 = inputs[0][0];
      this.processChunk(channel0);
    }
    return true;
  }

  sendAndClearBuffer() {
    this.port.postMessage({
      event: "chunk",
      data: {
        int16arrayBuffer: this.buffer.slice(0, this.bufferWriteIndex).buffer,
      },
    });
    this.bufferWriteIndex = 0;
  }

  processChunk(float32Array) {
    const l = float32Array.length;
    for (let i = 0; i < l; i++) {
      // Convert float32 (-1 to 1) to int16 (-32768 to 32767)
      const int16Value = float32Array[i] * 32768;
      this.buffer[this.bufferWriteIndex++] = int16Value;
      if (this.bufferWriteIndex >= this.buffer.length) {
        this.sendAndClearBuffer();
      }
    }
    if (this.bufferWriteIndex >= this.buffer.length) {
      this.sendAndClearBuffer();
    }
  }
}

registerProcessor("audio-recorder-worklet-24k", AudioProcessingWorklet);
`;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function createWorkletFromSrc(name: string, src: string): string {
  const blob = new Blob([src], { type: "application/javascript" });
  return URL.createObjectURL(blob);
}

export interface AudioCaptureEvents {
  data: (base64Audio: string) => void;
  volume: (level: number) => void;
}

export class AudioCapture extends EventEmitter<AudioCaptureEvents> {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private sampleRate = 24000; // xAI requires 24kHz
  public recording = false;

  async start(): Promise<void> {
    if (this.recording) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("getUserMedia not supported");
    }

    // Get microphone stream
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Create audio context at 24kHz (xAI's required sample rate)
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });

    // Create source from microphone
    this.source = this.audioContext.createMediaStreamSource(this.stream);

    // Load and connect the worklet
    const workletUrl = createWorkletFromSrc(
      "audio-recorder-worklet-24k",
      AudioRecordingWorklet
    );
    await this.audioContext.audioWorklet.addModule(workletUrl);

    this.worklet = new AudioWorkletNode(
      this.audioContext,
      "audio-recorder-worklet-24k"
    );

    // Handle audio data from worklet
    this.worklet.port.onmessage = (ev: MessageEvent) => {
      const arrayBuffer = ev.data.data?.int16arrayBuffer;
      if (arrayBuffer) {
        const base64 = arrayBufferToBase64(arrayBuffer);
        this.emit("data", base64);
      }
    };

    // Connect the audio graph
    this.source.connect(this.worklet);
    this.recording = true;
  }

  stop(): void {
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.worklet = null;
    this.recording = false;
  }
}
