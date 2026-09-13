const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64Url(bytes) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function fromBase64Url(value) {
  const padded = String(value).replaceAll("-", "+").replaceAll("_", "/")
    + "=".repeat((4 - (String(value).length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return base64Url(new Uint8Array(digest));
}

export async function sha256Hex(value) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(value))));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newOpaqueState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function importAesKey(encodedKey) {
  const raw = fromBase64Url(encodedKey);
  if (raw.byteLength !== 32) throw new Error("CALENDAR_TOKEN_ENCRYPTION_KEY must be a 32-byte base64url key");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptCalendarToken(value, encodedKey) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importAesKey(encodedKey), encoder.encode(JSON.stringify(value)));
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`;
}

export async function decryptCalendarToken(ciphertext, encodedKey) {
  const [version, ivValue, dataValue] = String(ciphertext || "").split(".");
  if (version !== "v1" || !ivValue || !dataValue) throw new Error("invalid calendar token ciphertext");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(ivValue) },
    await importAesKey(encodedKey),
    fromBase64Url(dataValue),
  );
  return JSON.parse(decoder.decode(decrypted));
}
