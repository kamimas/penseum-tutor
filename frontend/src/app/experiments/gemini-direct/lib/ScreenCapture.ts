/**
 * ScreenCapture - Captures screen frames as JPEG for Gemini
 */

export class ScreenCapture {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private intervalId: number | null = null;
  private onFrame: ((base64Jpeg: string) => void) | null = null;

  public capturing = false;

  async start(onFrame: (base64Jpeg: string) => void, fps = 1): Promise<void> {
    if (this.capturing) return;

    this.onFrame = onFrame;

    // Get screen share stream
    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: fps },
    });

    // Create hidden video element
    this.video = document.createElement("video");
    this.video.srcObject = this.stream;
    this.video.muted = true;
    await this.video.play();

    // Create canvas for frame capture
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");

    this.capturing = true;

    // Capture frames at specified FPS
    const intervalMs = 1000 / fps;
    this.intervalId = window.setInterval(() => {
      this.captureFrame();
    }, intervalMs);

    // Handle stream ending (user clicks "Stop sharing")
    this.stream.getVideoTracks()[0].onended = () => {
      this.stop();
    };
  }

  private captureFrame() {
    if (!this.video || !this.canvas || !this.ctx || !this.onFrame) return;

    // Resize to max 1024px (Gemini limit)
    const maxDim = 1024;
    let width = this.video.videoWidth;
    let height = this.video.videoHeight;

    if (width > maxDim || height > maxDim) {
      const scale = Math.min(maxDim / width, maxDim / height);
      width = Math.floor(width * scale);
      height = Math.floor(height * scale);
    }

    this.canvas.width = width;
    this.canvas.height = height;

    // Draw video frame to canvas
    this.ctx.drawImage(this.video, 0, 0, width, height);

    // Convert to JPEG base64
    const dataUrl = this.canvas.toDataURL("image/jpeg", 0.7);
    const base64 = dataUrl.split(",")[1];

    this.onFrame(base64);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.onFrame = null;
    this.capturing = false;
  }
}
