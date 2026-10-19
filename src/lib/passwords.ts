import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Versioned fixed policy: reject encoded cost changes before admitting any KDF.
const SCRYPT_PREFIX = "$scrypt$v1$N=131072,r=8,p=1$";
const SCRYPT_OPTIONS = { N: 131_072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 } as const;
const MAX_ACTIVE_KDFS = 2;
const MAX_WAITING_KDFS = 8;
const KDF_WAIT_MS = 5_000;
let activeKdfs = 0;
const waitingKdfs: Array<{ admit: () => void; timer: ReturnType<typeof setTimeout> }> = [];

export class PasswordKdfUnavailableError extends Error {
  constructor() {
    super("Password verification is busy. Try again shortly.");
    this.name = "PasswordKdfUnavailableError";
  }
}

function acquireKdf(): Promise<void> {
  if (activeKdfs < MAX_ACTIVE_KDFS) {
    activeKdfs++;
    return Promise.resolve();
  }
  if (waitingKdfs.length >= MAX_WAITING_KDFS) return Promise.reject(new PasswordKdfUnavailableError());
  return new Promise<void>((resolve, reject) => {
    const entry = {
      admit: resolve,
      timer: setTimeout(() => {
        const index = waitingKdfs.indexOf(entry);
        if (index >= 0) waitingKdfs.splice(index, 1);
        reject(new PasswordKdfUnavailableError());
      }, KDF_WAIT_MS),
    };
    waitingKdfs.push(entry);
  });
}

async function withKdf<T>(operation: () => Promise<T>): Promise<T> {
  await acquireKdf();
  try {
    return await operation();
  } finally {
    const next = waitingKdfs.shift();
    if (next) {
      clearTimeout(next.timer);
      next.admit();
    } else activeKdfs--;
  }
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return withKdf(() => new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, key) => error ? reject(error) : resolve(key));
  }));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  try { return `${SCRYPT_PREFIX}${salt.toString("hex")}$${key.toString("hex")}`; }
  finally { key.fill(0); }
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<{ valid: boolean; needsRehash: boolean }> {
  // Preserve every previously valid nonempty legacy salt, including salts that
  // resemble a new format prefix. Validate the entire digest before comparison.
  const legacy = /^([^:]+):([a-fA-F0-9]{64})$/.exec(stored);
  if (legacy && legacy[0].length === stored.length) {
    const check = createHash("sha256").update(`${legacy[1]}:${password}`).digest();
    const valid = timingSafeEqual(check, Buffer.from(legacy[2], "hex"));
    return { valid, needsRehash: valid };
  }

  if (stored.startsWith("$scrypt$")) {
    if (!stored.startsWith(SCRYPT_PREFIX)) return { valid: false, needsRehash: false };
    const body = stored.slice(SCRYPT_PREFIX.length);
    if (body.length !== 161) return { valid: false, needsRehash: false };
    const encoded = /^([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(body);
    if (!encoded) return { valid: false, needsRehash: false };
    const key = await derive(password, Buffer.from(encoded[1], "hex"));
    try { return { valid: timingSafeEqual(key, Buffer.from(encoded[2], "hex")), needsRehash: false }; }
    finally { key.fill(0); }
  }

  if (stored.startsWith("$2")) {
    // Repository writers used cost 10. Preserve bcrypt's existing 72-byte semantics,
    // while refusing malformed or excessive encoded costs before expensive work.
    if (stored.length !== 60 || !/^\$2[ab]\$(0[4-9]|1[0-6])\$[./A-Za-z0-9]{53}$/.test(stored)) return { valid: false, needsRehash: false };
    const bcrypt = await import("bcryptjs");
    const valid = await withKdf(() => bcrypt.compare(password, stored));
    return { valid, needsRehash: false };
  }

  return { valid: false, needsRehash: false };
}

export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash };
}
