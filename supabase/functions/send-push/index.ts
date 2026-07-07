import { createClient } from "jsr:@supabase/supabase-js@2";
import { webcrypto } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Web Push protocol uses the aesgcm content-encoding. We implement the
// minimal RFC 8291 + RFC 8292 flow here without external dependencies.
//
// References:
// - https://datatracker.ietf.org/doc/html/rfc8291 (encryption)
// - https://datatracker.ietf.org/doc/html/rfc8292 (VAPID)

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@queueflow.app";

function base64urlDecode(input: string): Uint8Array {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importEcKey(der: Uint8Array, isPrivate: boolean): Promise<CryptoKey> {
  return await webcrypto.subtle.importKey(
    "pkcs8" as KeyFormat,
    der,
    { name: "ECDSA", namedCurve: "P-256" } as KeyAlgorithm,
    true,
    isPrivate ? ["sign"] : ["verify"],
  );
}

// We need the raw public key bytes (65 bytes, uncompressed) for VAPID JWT.
async function getRawPublicKey(): Promise<Uint8Array> {
  const der = base64urlDecode(VAPID_PUBLIC_KEY);
  const key = await webcrypto.subtle.importKey(
    "spki" as KeyFormat,
    der,
    { name: "ECDSA", namedCurve: "P-256" } as KeyAlgorithm,
    true,
    ["verify"],
  );
  const raw = await webcrypto.subtle.exportKey("raw", key);
  return new Uint8Array(raw);
}

async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const enc = new TextEncoder();
  const headerB64 = base64urlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const der = base64urlDecode(VAPID_PRIVATE_KEY);
  const key = await importEcKey(der, true);
  const signature = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc.encode(signingInput),
  );
  // Convert DER signature to raw r||s (64 bytes) for ES256 JWT.
  const derSig = new Uint8Array(signature);
  const rawSig = derToRaw(derSig);
  const sigB64 = base64urlEncode(rawSig);
  return `${signingInput}.${sigB64}`;
}

function derToRaw(der: Uint8Array): Uint8Array {
  // ECDSA DER: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
  let offset = 2;
  const rLen = der[offset];
  offset += 1;
  const r = der.slice(offset + 1, offset + 1 + rLen - 1);
  offset += rLen;
  offset += 1;
  const sLen = der[offset];
  offset += 1;
  const s = der.slice(offset + 1, offset + 1 + sLen - 1);
  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return raw;
}

// RFC 8291 encryption: ECDH + HKDF + AES-128-GCM
async function encryptPayload(
  payload: string,
  p256dhB64: string,
  authB64: string,
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  const p256dh = base64urlDecode(p256dhB64);
  const auth = base64urlDecode(authB64);

  // Import the subscriber's public key (raw uncompressed P-256, 65 bytes).
  const subscriberPubKey = await webcrypto.subtle.importKey(
    "raw" as KeyFormat,
    p256dh,
    { name: "ECDH", namedCurve: "P-256" } as KeyAlgorithm,
    false,
    [],
  );

  // Generate server ephemeral key pair.
  const serverKeyPair = await webcrypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const serverPublicKey = new Uint8Array(
    await webcrypto.subtle.exportKey("raw", serverKeyPair.publicKey),
  );
  const serverPrivateKey = await webcrypto.subtle.exportKey("pkcs8", serverKeyPair.privateKey);
  const serverPrivKey = await webcrypto.subtle.importKey(
    "pkcs8" as KeyFormat,
    serverPrivateKey,
    { name: "ECDH", namedCurve: "P-256" } as KeyAlgorithm,
    false,
    ["deriveBits"],
  );

  // Shared secret via ECDH.
  const sharedSecret = new Uint8Array(
    await webcrypto.subtle.deriveBits({ name: "ECDH", public: subscriberPubKey }, serverPrivKey, 256),
  );

  // HKDF: info = "WebPush: info\0" || serverPub || subscriberPub
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdfSha256(sharedSecret, auth, new Uint8Array(0), 32);
  const context = new TextEncoder().encode("WebPush: info\0");
  const info = new Uint8Array(context.length + serverPublicKey.length + p256dh.length);
  info.set(context, 0);
  info.set(serverPublicKey, context.length);
  info.set(p256dh, context.length + serverPublicKey.length);
  const contentEncryptionKey = await hkdfSha256(ikm, new Uint8Array(0), info, 16);

  // AES-128-GCM
  const nonce = webcrypto.getRandomValues(new Uint8Array(12));
  const padding = new Uint8Array(2);
  const plaintext = new TextEncoder().encode(payload);
  const record = new Uint8Array(padding.length + plaintext.length);
  record.set(padding, 0);
  record.set(plaintext, 2);

  const aesKey = await webcrypto.subtle.importKey(
    "raw" as KeyFormat,
    contentEncryptionKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const encrypted = new Uint8Array(
    await webcrypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      aesKey,
      record,
    ),
  );
  const ciphertext = new Uint8Array(nonce.length + encrypted.length);
  ciphertext.set(nonce, 0);
  ciphertext.set(encrypted, nonce.length);

  return { ciphertext, salt, serverPublicKey };
}

async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await webcrypto.subtle.importKey("raw" as KeyFormat, ikm, "HKDF", false, ["deriveBits"]);
  const derived = await webcrypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(derived);
}

async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
): Promise<{ ok: boolean; status: number; endpoint: string }> {
  const publicKeyRaw = await getRawPublicKey();
  const { ciphertext, salt, serverPublicKey } = await encryptPayload(
    payload,
    subscription.p256dh,
    subscription.auth,
  );

  const audience = new URL(subscription.endpoint).origin;
  const jwt = await signJwt({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: VAPID_SUBJECT,
  });

  const body = new Uint8Array(salt.length + serverPublicKey.length + ciphertext.length);
  body.set(salt, 0);
  body.set(serverPublicKey, salt.length);
  body.set(ciphertext, salt.length + serverPublicKey.length);

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aesgcm",
      "TTL": "2419200",
      "Authorization": `vapid t=${jwt},k=${base64urlEncode(publicKeyRaw)}`,
    },
    body,
  });

  return { ok: res.ok, status: res.status, endpoint: subscription.endpoint };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return new Response(
      JSON.stringify({ error: "VAPID keys not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY edge function secrets." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const { token_id, payload } = await req.json();
    if (!token_id || !payload) {
      return new Response(
        JSON.stringify({ error: "token_id and payload are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth")
      .eq("token_id", token_id);

    if (error) throw error;

    const results = [];
    for (const sub of subs ?? []) {
      const result = await sendWebPush(sub, JSON.stringify(payload));
      results.push(result);
      // If the endpoint is gone (410), clean up the subscription.
      if (result.status === 404 || result.status === 410) {
        await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      }
    }

    return new Response(
      JSON.stringify({ sent: results.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
