export interface SlidingWindowRateLimiterOptions {
  maxRequests: number;
  windowMs: number;
}

export class SlidingWindowRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly timestamps: number[] = [];

  constructor({ maxRequests, windowMs }: SlidingWindowRateLimiterOptions) {
    this.maxRequests = Math.max(1, Math.floor(maxRequests));
    this.windowMs = Math.max(1, Math.floor(windowMs));
  }

  allow(now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] <= cutoff) {
      this.timestamps.shift();
    }

    if (this.timestamps.length >= this.maxRequests) {
      return false;
    }

    this.timestamps.push(now);
    return true;
  }
}
