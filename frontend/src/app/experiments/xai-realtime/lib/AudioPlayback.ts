/**
 * AudioPlayback - Plays PCM 24kHz audio from xAI
 *
 * xAI outputs 24kHz audio (same as input)
 */

export class AudioPlayback {
  private context: AudioContext;
  private gainNode: GainNode;
  private audioQueue: Float32Array[] = [];
  private isPlaying = false;
  private scheduledTime = 0;
  private checkInterval: number | null = null;
  private sampleRate = 24000; // xAI uses 24kHz
  private bufferSize = 7680; // ~320ms at 24kHz
  private initialBufferTime = 0.1;

  constructor() {
    this.context = new AudioContext({ sampleRate: this.sampleRate });
    this.gainNode = this.context.createGain();
    this.gainNode.connect(this.context.destination);
  }

  /**
   * Convert ArrayBuffer (PCM 16-bit) to Float32Array
   */
  private pcm16ToFloat32(buffer: ArrayBuffer): Float32Array {
    const int16Array = new Int16Array(buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768;
    }
    return float32Array;
  }

  /**
   * Add PCM audio data to the playback queue
   */
  addPCM16(buffer: ArrayBuffer) {
    let processingBuffer = this.pcm16ToFloat32(buffer);

    // Split into chunks
    while (processingBuffer.length >= this.bufferSize) {
      this.audioQueue.push(processingBuffer.slice(0, this.bufferSize));
      processingBuffer = processingBuffer.slice(this.bufferSize);
    }
    if (processingBuffer.length > 0) {
      this.audioQueue.push(processingBuffer);
    }

    // Start playing if not already
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.scheduledTime = this.context.currentTime + this.initialBufferTime;
      this.scheduleNextBuffer();
    }
  }

  private createAudioBuffer(audioData: Float32Array): AudioBuffer {
    const audioBuffer = this.context.createBuffer(
      1,
      audioData.length,
      this.sampleRate
    );
    audioBuffer.getChannelData(0).set(audioData);
    return audioBuffer;
  }

  private scheduleNextBuffer() {
    const SCHEDULE_AHEAD_TIME = 0.2;

    while (
      this.audioQueue.length > 0 &&
      this.scheduledTime < this.context.currentTime + SCHEDULE_AHEAD_TIME
    ) {
      const audioData = this.audioQueue.shift()!;
      const audioBuffer = this.createAudioBuffer(audioData);
      const source = this.context.createBufferSource();

      source.buffer = audioBuffer;
      source.connect(this.gainNode);

      const startTime = Math.max(this.scheduledTime, this.context.currentTime);
      source.start(startTime);
      this.scheduledTime = startTime + audioBuffer.duration;
    }

    if (this.audioQueue.length === 0) {
      if (!this.checkInterval) {
        this.checkInterval = window.setInterval(() => {
          if (this.audioQueue.length > 0) {
            this.scheduleNextBuffer();
          }
        }, 100);
      }
    } else {
      const nextCheckTime =
        (this.scheduledTime - this.context.currentTime) * 1000;
      setTimeout(
        () => this.scheduleNextBuffer(),
        Math.max(0, nextCheckTime - 50)
      );
    }
  }

  /**
   * Stop playback and clear queue
   */
  stop() {
    this.isPlaying = false;
    this.audioQueue = [];
    this.scheduledTime = this.context.currentTime;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Fade out
    this.gainNode.gain.linearRampToValueAtTime(
      0,
      this.context.currentTime + 0.1
    );

    setTimeout(() => {
      this.gainNode.disconnect();
      this.gainNode = this.context.createGain();
      this.gainNode.connect(this.context.destination);
    }, 200);
  }

  /**
   * Resume audio context (required after user interaction)
   */
  async resume() {
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
    this.gainNode.gain.setValueAtTime(1, this.context.currentTime);
  }
}
