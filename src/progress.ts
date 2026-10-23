const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const BAR_WIDTH = 12;

type StatusListener = (status: string) => void;
let activeListener: StatusListener | null = null;

/**
 * Emits a live status update to any active terminal progress indicator.
 */
export function emitAgentStatus(status: string): void {
  if (activeListener) {
    activeListener(status);
  }
}

/**
 * Terminal progress bar & spinner that displays real-time agent thinking,
 * specialist handoffs, and tool execution status.
 */
export class AgentProgressIndicator {
  private timer: NodeJS.Timeout | null = null;
  private frameIndex = 0;
  private barOffset = 0;
  private startTime = 0;
  private currentStatus = 'Thinking...';
  private lastLoggedStatus = '';
  private active = false;
  private readonly isTTY: boolean;

  constructor() {
    this.isTTY = Boolean(process.stdout.isTTY);
  }

  start(initialStatus = 'Triage Coordinator analyzing request...'): void {
    if (this.active) {
      this.update(initialStatus);
      return;
    }
    this.active = true;
    this.currentStatus = initialStatus;
    this.lastLoggedStatus = '';
    this.startTime = Date.now();
    this.frameIndex = 0;
    this.barOffset = 0;

    activeListener = (newStatus: string) => {
      this.update(newStatus);
    };

    if (this.isTTY) {
      this.renderTTY();
      this.timer = setInterval(() => {
        this.renderTTY();
      }, 90);
    } else {
      this.logNonTTY(initialStatus);
    }
  }

  update(status: string): void {
    this.currentStatus = status;
    if (!this.active) return;

    if (this.isTTY) {
      this.renderTTY();
    } else if (status !== this.lastLoggedStatus) {
      this.logNonTTY(status);
    }
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;

    if (activeListener) {
      activeListener = null;
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.isTTY) {
      // Clear the progress line cleanly
      process.stdout.write('\r\x1b[K');
    }
  }

  private renderTTY(): void {
    const spinner = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length];
    this.frameIndex++;

    // Build a smooth bouncing/pulsing progress bar
    const pulseWidth = 4;
    const cycle = (BAR_WIDTH - pulseWidth) * 2;
    const pos = this.barOffset % cycle;
    const start = pos <= BAR_WIDTH - pulseWidth ? pos : cycle - pos;
    this.barOffset++;

    let bar = '';
    for (let i = 0; i < BAR_WIDTH; i++) {
      bar += i >= start && i < start + pulseWidth ? '█' : '░';
    }

    const elapsedSec = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const line = `\r\x1b[K\x1b[36m${spinner} [${bar}] ${elapsedSec}s\x1b[0m │ \x1b[33m${this.currentStatus}\x1b[0m`;
    process.stdout.write(line);
  }

  private logNonTTY(status: string): void {
    this.lastLoggedStatus = status;
    const elapsedSec = ((Date.now() - this.startTime) / 1000).toFixed(1);
    console.log(`   ⏳ [${elapsedSec}s] ${status}`);
  }
}

/**
 * Helper to wrap an async operation with the live progress indicator.
 */
export async function withAgentProgress<T>(
  initialStatus: string,
  fn: (progress: AgentProgressIndicator) => Promise<T>
): Promise<T> {
  const progress = new AgentProgressIndicator();
  progress.start(initialStatus);
  try {
    return await fn(progress);
  } finally {
    progress.stop();
  }
}
