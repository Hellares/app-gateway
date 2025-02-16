// src/common/guards/token-bucket.ts
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillRate: number,  // tokens por segundo
    private readonly windowSize: number   // duración en segundos
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async tryConsume(): Promise<{
    allowed: boolean;
    overagePercentage?: number;
    retryAfter?: number;
  }> {
    this.refill();

    if (this.tokens > 0) {
      this.tokens--;
      return { allowed: true };
    }

    // Calcular el porcentaje de exceso
    const overagePercentage = ((this.capacity - this.tokens) / this.capacity) * 100;
    
    // Calcular tiempo hasta próximo token
    const retryAfter = Math.ceil(1 / this.refillRate);

    return {
      allowed: false,
      overagePercentage,
      retryAfter
    };
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000; // convertir a segundos
    const tokensToAdd = Math.floor(timePassed * this.refillRate);

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  getTokens(): number {
    return this.tokens;
  }

  reset(): void {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }
}