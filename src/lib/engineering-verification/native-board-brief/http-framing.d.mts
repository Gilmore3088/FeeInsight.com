import type { Limits, WireObservation } from './transparent-hold.mjs';
export function createHttpFraming(input: {
  direction: 'request' | 'response'; limits: Limits; requestMethod(): string;
  onHeaders(metadata: { method: string; target: string } | { status: number }): void;
}): {
  feed(bytes: Buffer): void; eof(): boolean; readonly error: string | null;
  readonly complete: boolean; readonly headerRetained: number; observation(): WireObservation;
};
