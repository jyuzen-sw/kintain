const PASSWORD_SCHEME = "pbkdf2-sha256";
export const PASSWORD_HASH_ITERATIONS = 600_000;
const PASSWORD_KEY_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;

const textEncoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function derivePasswordKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new Uint8Array(salt).buffer,
      iterations,
    },
    keyMaterial,
    PASSWORD_KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const derived = await derivePasswordKey(password, salt, PASSWORD_HASH_ITERATIONS);
  return [
    PASSWORD_SCHEME,
    PASSWORD_HASH_ITERATIONS.toString(),
    bytesToBase64Url(salt),
    bytesToBase64Url(derived),
  ].join("$");
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [scheme, iterationsText, saltText, expectedText, ...extra] = encodedHash.split("$");
  const iterations = Number(iterationsText);
  if (
    scheme !== PASSWORD_SCHEME ||
    !Number.isSafeInteger(iterations) ||
    iterations < 100_000 ||
    !saltText ||
    !expectedText ||
    extra.length > 0
  ) {
    return false;
  }

  try {
    const salt = base64UrlToBytes(saltText);
    const expected = base64UrlToBytes(expectedText);
    const actual = await derivePasswordKey(password, salt, iterations);
    return equalBytes(actual, expected);
  } catch {
    return false;
  }
}

export function createOpaqueToken(byteLength = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function fingerprintIdentifier(value: string): Promise<string> {
  return sha256Base64Url(value.trim().toLowerCase());
}
