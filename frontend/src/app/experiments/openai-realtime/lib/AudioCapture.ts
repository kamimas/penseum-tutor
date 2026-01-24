/**
 * AudioCapture - Captures microphone audio at 24kHz for OpenAI Realtime API
 *
 * OpenAI Realtime API expects 24kHz PCM16 mono audio input.
 */

import { EventEmitter } from "eventemitter3";

export interface AudioCaptureEvents {
  data: (base64Audio: string) => void;
  error: (error: Error) => void;
}

export class AudioCapture extends EventEmitter<AudioCaptureEvents> {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sampleRate = 24000; // OpenAI requires 24kHz

  async start() {
    try {
      // Get microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Create audio context at 24kHz
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });

      // Create a source from the microphone
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Use ScriptProcessor for compatibility (AudioWorklet would be better for production)
      const bufferSize = 2400; // 100ms at 24kHz
      const scriptProcessor = this.audioContext.createScriptProcessor(
        bufferSize,
        1,
        1
      );

      // Buffer to accumulate samples
      let buffer = new Int16Array(bufferSize);
      let bufferIndex = 0;

      scriptProcessor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);

        // Convert float32 to int16 and accumulate
        for (let i = 0; i < inputData.length; i++) {
          // Clamp and convert to int16
          const sample = Math.max(-1, Math.min(1, inputData[i]));
          buffer[bufferIndex++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

          // When buffer is full, send it
          if (bufferIndex >= bufferSize) {
            // Convert to base64
            const bytes = new Uint8Array(buffer.buffer);
            const base64 = btoa(String.fromCharCode(...bytes));
            this.emit("data", base64);

            // Reset buffer
            buffer = new Int16Array(bufferSize);
            bufferIndex = 0;
          }
        }
      };

      source.connect(scriptProcessor);
      scriptProcessor.connect(this.audioContext.destination);

    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  stop() {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}
