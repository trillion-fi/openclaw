import crypto from "node:crypto";
import fs from "node:fs";

import type { SolanaKeystoreFile } from "./solana-keystore.js";
import {
  createSolanaKeystoreFile,
  decryptSolanaKeystoreFile,
  readSolanaKeystoreFile,
  resolveSolanaKeystorePath,
  saveSolanaKeystoreFile,
} from "./solana-keystore.js";
import { encodeBase58 } from "./base58.js";

const DEFAULT_UNLOCK_TTL_MS = 10 * 60_000;

export type SolanaWalletStatus = {
  exists: boolean;
  address: string | null;
  locked: boolean;
  unlockedUntilMs: number | null;
};

type SolanaSigner = {
  privateKey: crypto.KeyObject;
  address: string;
};

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`invalid ${label}`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`invalid ${label}`);
  }
  return trimmed;
}

function readEd25519Jwk(privateKey: crypto.KeyObject): { d: Buffer; x: Buffer } {
  const exported = privateKey.export({ format: "jwk" }) as unknown;
  if (!exported || typeof exported !== "object") {
    throw new Error("failed to export ed25519 key");
  }
  const jwk = exported as Record<string, unknown>;
  const kty = requireString(jwk.kty, "jwk.kty");
  const crv = requireString(jwk.crv, "jwk.crv");
  if (kty !== "OKP" || crv !== "Ed25519") {
    throw new Error(`unsupported key type: ${kty}/${crv}`);
  }
  const d = Buffer.from(requireString(jwk.d, "jwk.d"), "base64url");
  const x = Buffer.from(requireString(jwk.x, "jwk.x"), "base64url");
  if (d.length !== 32 || x.length !== 32) {
    throw new Error("invalid ed25519 key material");
  }
  return { d, x };
}

function createEd25519PrivateKey(params: { d: Buffer; x: Buffer }): crypto.KeyObject {
  const jwk = {
    kty: "OKP",
    crv: "Ed25519",
    x: params.x.toString("base64url"),
    d: params.d.toString("base64url"),
  };
  return crypto.createPrivateKey({ key: jwk, format: "jwk" });
}

export class SolanaWalletService {
  private keystorePath: string;
  private unlockedUntilMs: number | null = null;
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private signer: SolanaSigner | null = null;
  private keystoreCache: SolanaKeystoreFile | null = null;

  constructor(params: { stateDir: string }) {
    this.keystorePath = resolveSolanaKeystorePath(params.stateDir);
  }

  getKeystorePath(): string {
    return this.keystorePath;
  }

  private loadKeystore(): SolanaKeystoreFile | null {
    const loaded = readSolanaKeystoreFile(this.keystorePath);
    this.keystoreCache = loaded;
    return loaded;
  }

  status(): SolanaWalletStatus {
    const keystore = this.loadKeystore();
    const now = Date.now();
    const unlocked =
      this.signer != null && this.unlockedUntilMs != null && this.unlockedUntilMs > now;
    return {
      exists: Boolean(keystore),
      address: keystore?.address ?? null,
      locked: !unlocked,
      unlockedUntilMs: unlocked ? this.unlockedUntilMs : null,
    };
  }

  init(params: { password: string }): { address: string } {
    if (fs.existsSync(this.keystorePath)) {
      throw new Error("wallet already initialized");
    }
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    const { d, x } = readEd25519Jwk(privateKey);
    const secretKeyBytes = new Uint8Array(Buffer.concat([d, x]));
    const address = encodeBase58(x);

    const keystore = createSolanaKeystoreFile({
      address,
      secretKeyBytes,
      password: params.password,
    });
    saveSolanaKeystoreFile(this.keystorePath, keystore);
    this.keystoreCache = keystore;
    return { address };
  }

  unlock(params: { password: string; ttlMs?: number }): {
    address: string;
    unlockedUntilMs: number;
  } {
    const keystore = this.keystoreCache ?? this.loadKeystore();
    if (!keystore) {
      throw new Error("wallet not initialized");
    }
    const secret = decryptSolanaKeystoreFile({ keystore, password: params.password });
    const d = Buffer.from(secret.secretKeyBytes.slice(0, 32));
    const x = Buffer.from(secret.secretKeyBytes.slice(32, 64));
    const derivedAddress = encodeBase58(x);
    if (derivedAddress !== keystore.address) {
      throw new Error("invalid keystore payload");
    }
    const privateKey = createEd25519PrivateKey({ d, x });

    const ttlMs =
      typeof params.ttlMs === "number" && Number.isFinite(params.ttlMs)
        ? Math.max(1_000, Math.floor(params.ttlMs))
        : DEFAULT_UNLOCK_TTL_MS;

    this.signer = { privateKey, address: keystore.address };
    this.unlockedUntilMs = Date.now() + ttlMs;
    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
    }
    this.lockTimer = setTimeout(() => this.lock(), ttlMs);

    return { address: keystore.address, unlockedUntilMs: this.unlockedUntilMs };
  }

  lock(): void {
    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
      this.lockTimer = null;
    }
    this.signer = null;
    this.unlockedUntilMs = null;
  }

  requireUnlocked(): SolanaSigner {
    const now = Date.now();
    if (!this.signer || !this.unlockedUntilMs || this.unlockedUntilMs <= now) {
      this.lock();
      throw new Error("wallet locked");
    }
    return this.signer;
  }

  signMessage(params: { message: string }): string {
    const signer = this.requireUnlocked();
    const signature = crypto.sign(null, Buffer.from(params.message, "utf8"), signer.privateKey);
    return encodeBase58(signature);
  }
}

