import { createHmac, randomBytes } from "node:crypto";

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function toBase32(buffer: Buffer) {
  let bits = "";
  let output = "";
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, "0");
    while (bits.length >= 5) {
      output += base32Alphabet[Number.parseInt(bits.slice(0, 5), 2)];
      bits = bits.slice(5);
    }
  }
  if (bits.length > 0) {
    output += base32Alphabet[Number.parseInt(bits.padEnd(5, "0"), 2)];
  }
  return output;
}

function fromBase32(secret: string) {
  const normalized = secret.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = "";
  const bytes: number[] = [];
  for (const char of normalized) {
    const value = base32Alphabet.indexOf(char);
    if (value < 0) {
      continue;
    }
    bits += value.toString(2).padStart(5, "0");
    while (bits.length >= 8) {
      bytes.push(Number.parseInt(bits.slice(0, 8), 2));
      bits = bits.slice(8);
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number) {
  const key = fromBase32(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export function createTotpSecret() {
  return toBase32(randomBytes(20));
}

export function createTotpUri(input: {
  issuer: string;
  accountName: string;
  secret: string;
}) {
  const label = encodeURIComponent(`${input.issuer}:${input.accountName}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function verifyTotpToken(secret: string | null | undefined, token: string | null | undefined) {
  if (!secret || !token) {
    return false;
  }
  const normalizedToken = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalizedToken)) {
    return false;
  }
  const currentCounter = Math.floor(Date.now() / 30_000);
  for (const offset of [-1, 0, 1]) {
    if (hotp(secret, currentCounter + offset) === normalizedToken) {
      return true;
    }
  }
  return false;
}
