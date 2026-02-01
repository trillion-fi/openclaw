import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const KEYSTORE_VERSION = 1 as const;
const KEYSTORE_FILENAME = "default.json";

const DEFAULT_SCRYPT_PARAMS = {
  N: 1 << 15,
  r: 8,
  p: 1,
} as const;

type ScryptParams = {
  N: number;
  r: number;
  p: number;
};

type EvmKeystoreFileV1 = {
  version: typeof KEYSTORE_VERSION;
  address: string;
  createdAtMs: number;
  kdf: {
    name: "scrypt";
    params: ScryptParams;
    salt: string;
  };
  cipher: {
    name: "aes-256-gcm";
    iv: string;
    tag: string;
    ciphertext: string;
    aad: string;
  };
};

export type EvmKeystoreFile = EvmKeystoreFileV1;

export type EvmKeystoreSecret = {
  privateKeyHex: `0x${string}`;
};

export function resolveEvmKeystorePath(stateDir: string): string {
  return path.join(stateDir, "wallets", "evm", KEYSTORE_FILENAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toBase64Url(value: Buffer): string {
  return value.toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`invalid keystore: ${label} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`invalid keystore: ${label} is empty`);
  }
  return trimmed;
}

function readNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`invalid keystore: ${label} must be a number`);
  }
  return value;
}

export function readEvmKeystoreFile(filePath: string): EvmKeystoreFile | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("invalid keystore: not an object");
  }
  const version = readNumber(parsed.version, "version");
  if (version !== KEYSTORE_VERSION) {
    throw new Error(`unsupported keystore version: ${version}`);
  }
  const address = requireNonEmptyString(parsed.address, "address");
  const createdAtMs = readNumber(parsed.createdAtMs, "createdAtMs");
  const kdf = parsed.kdf;
  if (!isRecord(kdf)) {
    throw new Error("invalid keystore: kdf must be an object");
  }
  const kdfName = requireNonEmptyString(kdf.name, "kdf.name");
  if (kdfName !== "scrypt") {
    throw new Error(`unsupported keystore kdf: ${kdfName}`);
  }
  const kdfParamsRaw = kdf.params;
  if (!isRecord(kdfParamsRaw)) {
    throw new Error("invalid keystore: kdf.params must be an object");
  }
  const kdfParams: ScryptParams = {
    N: readNumber(kdfParamsRaw.N, "kdf.params.N"),
    r: readNumber(kdfParamsRaw.r, "kdf.params.r"),
    p: readNumber(kdfParamsRaw.p, "kdf.params.p"),
  };
  const salt = requireNonEmptyString(kdf.salt, "kdf.salt");
  const cipher = parsed.cipher;
  if (!isRecord(cipher)) {
    throw new Error("invalid keystore: cipher must be an object");
  }
  const cipherName = requireNonEmptyString(cipher.name, "cipher.name");
  if (cipherName !== "aes-256-gcm") {
    throw new Error(`unsupported keystore cipher: ${cipherName}`);
  }
  const iv = requireNonEmptyString(cipher.iv, "cipher.iv");
  const tag = requireNonEmptyString(cipher.tag, "cipher.tag");
  const ciphertext = requireNonEmptyString(cipher.ciphertext, "cipher.ciphertext");
  const aad = requireNonEmptyString(cipher.aad, "cipher.aad");
  return {
    version: KEYSTORE_VERSION,
    address,
    createdAtMs,
    kdf: { name: "scrypt", params: kdfParams, salt },
    cipher: { name: "aes-256-gcm", iv, tag, ciphertext, aad },
  };
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

export function saveEvmKeystoreFile(filePath: string, keystore: EvmKeystoreFile): void {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(keystore, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort on platforms without chmod
  }
}

function normalizePassword(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("password is required");
  }
  return trimmed;
}

function deriveKey(password: string, salt: Buffer, params: ScryptParams): Buffer {
  const N = Math.max(2, Math.floor(params.N));
  const r = Math.max(1, Math.floor(params.r));
  const p = Math.max(1, Math.floor(params.p));
  // scrypt memory cost is ~ 128 * r * N bytes.
  const maxmem = 256 * r * N;
  return crypto.scryptSync(password, salt, 32, { N, r, p, maxmem });
}

function validatePrivateKeyHex(value: string): asserts value is `0x${string}` {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error("invalid private key");
  }
}

export function createEvmKeystoreFile(params: {
  address: string;
  privateKeyHex: string;
  password: string;
  nowMs?: number;
  scrypt?: Partial<ScryptParams>;
}): EvmKeystoreFile {
  validatePrivateKeyHex(params.privateKeyHex);
  const password = normalizePassword(params.password);
  const nowMs = typeof params.nowMs === "number" ? params.nowMs : Date.now();
  const scryptParams: ScryptParams = {
    N: params.scrypt?.N ?? DEFAULT_SCRYPT_PARAMS.N,
    r: params.scrypt?.r ?? DEFAULT_SCRYPT_PARAMS.r,
    p: params.scrypt?.p ?? DEFAULT_SCRYPT_PARAMS.p,
  };
  const salt = crypto.randomBytes(16);
  const key = deriveKey(password, salt, scryptParams);
  const iv = crypto.randomBytes(12);
  const aad = Buffer.from(`openclaw:wallet:evm:${KEYSTORE_VERSION}`, "utf8");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const plaintext = Buffer.from(JSON.stringify({ privateKeyHex: params.privateKeyHex }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: KEYSTORE_VERSION,
    address: params.address,
    createdAtMs: nowMs,
    kdf: {
      name: "scrypt",
      params: scryptParams,
      salt: toBase64Url(salt),
    },
    cipher: {
      name: "aes-256-gcm",
      iv: toBase64Url(iv),
      tag: toBase64Url(tag),
      ciphertext: toBase64Url(ciphertext),
      aad: toBase64Url(aad),
    },
  };
}

export function decryptEvmKeystoreFile(params: {
  keystore: EvmKeystoreFile;
  password: string;
}): EvmKeystoreSecret {
  const password = normalizePassword(params.password);
  const salt = fromBase64Url(params.keystore.kdf.salt);
  const key = deriveKey(password, salt, params.keystore.kdf.params);
  const iv = fromBase64Url(params.keystore.cipher.iv);
  const tag = fromBase64Url(params.keystore.cipher.tag);
  const ciphertext = fromBase64Url(params.keystore.cipher.ciphertext);
  const aad = fromBase64Url(params.keystore.cipher.aad);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("invalid password or corrupted keystore");
  }
  const parsed = JSON.parse(plaintext.toString("utf8")) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("invalid keystore payload");
  }
  const privateKeyHex = requireNonEmptyString(parsed.privateKeyHex, "privateKeyHex");
  validatePrivateKeyHex(privateKeyHex);
  return { privateKeyHex };
}
