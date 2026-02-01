import path from "node:path";

import type { WalletKeystoreFile } from "./wallet-keystore.js";
import {
  createWalletKeystoreFile,
  decryptWalletKeystoreFile,
  readWalletKeystoreFile,
  saveWalletKeystoreFile,
} from "./wallet-keystore.js";

const KEYSTORE_FILENAME = "default.json";

export type SolanaKeystoreFile = WalletKeystoreFile;

export type SolanaKeystoreSecret = {
  secretKeyBytes: Uint8Array;
};

export function resolveSolanaKeystorePath(stateDir: string): string {
  return path.join(stateDir, "wallets", "solana", KEYSTORE_FILENAME);
}

function decodeSecretKeyBase64Url(value: string): Uint8Array {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("invalid keystore payload");
  }
  const buf = Buffer.from(trimmed, "base64url");
  if (buf.length !== 64) {
    throw new Error("invalid solana secret key");
  }
  return new Uint8Array(buf);
}

export function readSolanaKeystoreFile(filePath: string): SolanaKeystoreFile | null {
  return readWalletKeystoreFile(filePath);
}

export function saveSolanaKeystoreFile(filePath: string, keystore: SolanaKeystoreFile): void {
  return saveWalletKeystoreFile(filePath, keystore);
}

export function createSolanaKeystoreFile(params: {
  address: string;
  secretKeyBytes: Uint8Array;
  password: string;
  nowMs?: number;
  scrypt?: { N?: number; r?: number; p?: number };
}): SolanaKeystoreFile {
  if (params.secretKeyBytes.length !== 64) {
    throw new Error("invalid solana secret key");
  }
  const secretKeyBase64Url = Buffer.from(params.secretKeyBytes).toString("base64url");
  return createWalletKeystoreFile({
    address: params.address,
    payload: { secretKeyBase64Url },
    password: params.password,
    aad: "openclaw:wallet:solana:1",
    nowMs: params.nowMs,
    scrypt: params.scrypt,
  });
}

export function decryptSolanaKeystoreFile(params: {
  keystore: SolanaKeystoreFile;
  password: string;
}): SolanaKeystoreSecret {
  const parsed = decryptWalletKeystoreFile(params);
  const secretKeyBase64UrlRaw = parsed.secretKeyBase64Url;
  if (typeof secretKeyBase64UrlRaw !== "string") {
    throw new Error("invalid keystore payload");
  }
  const secretKeyBytes = decodeSecretKeyBase64Url(secretKeyBase64UrlRaw);
  return { secretKeyBytes };
}

