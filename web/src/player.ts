// Plays parts of one recording through the Web Audio API: the whole text, a sentence or a single word.
// Web Audio starts and stops at exact times, which an <audio> element cannot do for short word slices.

/** Plays any part of one decoded recording and reports the playing position. */
export class Player {
  private readonly context: AudioContext;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  /** Audio-clock time when the current part started, and where in the recording it started. */
  private startedAt = 0;
  private startOffset = 0;
  /** Where the current part ends; the audio clock can run a little past it. */
  private endOffset = 0;
  private frame = 0;

  /** Called on every animation frame while playing, with the position in seconds. */
  onTick: (position: number) => void = () => {};
  /** Called once when playback stops, by reaching the end of the part or by stop(). */
  onStop: (position: number) => void = () => {};

  /** Creates the player; nothing plays until play() is called from a tap or click. */
  constructor() {
    // Kokoro records at 24 kHz; decoding at the same rate halves memory compared with the usual 48 kHz.
    try {
      this.context = new AudioContext({ sampleRate: 24000 });
    } catch {
      this.context = new AudioContext();
    }
  }

  /**
   * Downloads and decodes the recording.
   * @param url Address of the mp3.
   */
  async load(url: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Audio download failed: HTTP ${response.status}`);
    this.buffer = await this.context.decodeAudioData(await response.arrayBuffer());
  }

  /** Length of the recording in seconds; 0 before load(). */
  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  /** Whether something is playing now. */
  get playing(): boolean {
    return this.source !== null;
  }

  /** Current position in the recording, in seconds. */
  get position(): number {
    if (!this.playing) return this.startOffset;
    return Math.min(this.endOffset, this.startOffset + this.context.currentTime - this.startedAt);
  }

  /**
   * Plays one part of the recording, stopping whatever was playing.
   * @param from Start in seconds.
   * @param to End in seconds; the end of the recording if left out.
   */
  play(from: number, to = this.duration): void {
    if (!this.buffer) return;
    this.stop();
    const start = Math.max(0, Math.min(from, this.duration));
    const length = Math.max(0, Math.min(to, this.duration) - start);
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.context.destination);
    // Browsers keep audio paused until a user gesture; play() is always called from one.
    void this.context.resume();
    source.start(0, start, length);
    this.source = source;
    this.startedAt = this.context.currentTime;
    this.startOffset = start;
    this.endOffset = start + length;
    source.onended = () => {
      if (this.source === source) this.finish();
    };
    const tick = () => {
      if (this.source !== source) return;
      this.onTick(this.position);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** Stops playback; onStop reports where it stopped. */
  stop(): void {
    if (!this.source) return;
    const source = this.source;
    source.onended = null;
    source.stop();
    this.finish();
  }

  /** Clears the playing state and reports the final position. */
  private finish(): void {
    const position = this.position;
    this.source = null;
    this.startOffset = position;
    cancelAnimationFrame(this.frame);
    this.onStop(position);
  }
}
