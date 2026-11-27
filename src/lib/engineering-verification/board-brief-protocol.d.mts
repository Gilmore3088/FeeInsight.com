/** Input-only driver protocol; these declarations grant no observation authority. */
export const ADAPTER: 'hamilton.board-brief.v1';
export const MAX_BYTES: number;
export const fields: readonly string[];
export function record(value: unknown): value is Record<string, unknown>;
export function keys(value: unknown, names: readonly string[]): value is Record<string, unknown>;
export function text(value: unknown, maximum?: number): value is string;
export function boundedJson(value: unknown): void;
export function validOutcome(value: unknown): boolean;
export function validateStep(value: unknown): void;
export function validateSourceRequest(value: unknown): void;
export function readInput(): Promise<unknown>;
export function writeOutput(value: unknown): void;
