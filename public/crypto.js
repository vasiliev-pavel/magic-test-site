// Шифрование тестов паролем: PBKDF2-SHA256 → AES-256-GCM.
// Работает и в браузере, и в Node (tools/encrypt.mjs).

const ITERATIONS = 300000;
const enc = new TextEncoder();

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encrypt(password, text) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  // btoa по частям — большие массивы не влезают в аргументы String.fromCharCode
  const bytes = new Uint8Array(data);
  let b64 = '';
  for (let i = 0; i < bytes.length; i += 0x8000) b64 += toB64(bytes.subarray(i, i + 0x8000));
  return { iterations: ITERATIONS, salt: toB64(salt), iv: toB64(iv), data: b64 };
}

// Неверный пароль → исключение (AES-GCM не сходится по тегу)
export async function decrypt(password, box) {
  const key = await deriveKey(password, fromB64(box.salt), box.iterations);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.data));
  return new TextDecoder().decode(data);
}
