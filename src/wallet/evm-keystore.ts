import path from "node:path";

const KEYSTORE_FILENAME = "default.json";

import type { WalletKeystoreFile } from "./wallet-keystore.js";
import {
  createWalletKeystoreFile,
  decryptWalletKeystoreFile,
  readWalletKeystoreFile,
  saveWalletKeystoreFile,
} from "./wallet-keystore.js";

export type EvmKeystoreFile = WalletKeystoreFile;

export type EvmKeystoreSecret = {
  privateKeyHex: `0x${string}`;
};

export function resolveEvmKeystorePath(stateDir: string): string {
  return path.join(stateDir, "wallets", "evm", KEYSTORE_FILENAME);
}

export function readEvmKeystoreFile(filePath: string): EvmKeystoreFile | null {
  return readWalletKeystoreFile(filePath);
}

export function saveEvmKeystoreFile(filePath: string, keystore: EvmKeystoreFile): void {
  return saveWalletKeystoreFile(filePath, keystore);
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
  scrypt?: { N?: number; r?: number; p?: number };
}): EvmKeystoreFile {
  validatePrivateKeyHex(params.privateKeyHex);
  return createWalletKeystoreFile({
    address: params.address,
    payload: { privateKeyHex: params.privateKeyHex },
    password: params.password,
    aad: "openclaw:wallet:evm:1",
    nowMs: params.nowMs,
    scrypt: params.scrypt,
  });
}

export function decryptEvmKeystoreFile(params: {
  keystore: EvmKeystoreFile;
  password: string;
}): EvmKeystoreSecret {
  const parsed = decryptWalletKeystoreFile(params);
  const privateKeyHexRaw = parsed.privateKeyHex;
  if (typeof privateKeyHexRaw !== "string") {
    throw new Error("invalid keystore payload");
  }
  const privateKeyHex = privateKeyHexRaw.trim();
  validatePrivateKeyHex(privateKeyHex);
  return { privateKeyHex };
}
