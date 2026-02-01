import fs from "node:fs";

import { Wallet } from "ethers";

import type { EvmKeystoreFile } from "./evm-keystore.js";
import {
  createEvmKeystoreFile,
  decryptEvmKeystoreFile,
  readEvmKeystoreFile,
  resolveEvmKeystorePath,
  saveEvmKeystoreFile,
} from "./evm-keystore.js";

const DEFAULT_UNLOCK_TTL_MS = 10 * 60_000;

export type EvmWalletStatus = {
  exists: boolean;
  address: string | null;
  locked: boolean;
  unlockedUntilMs: number | null;
};

export class EvmWalletService {
  private keystorePath: string;
  private unlockedUntilMs: number | null = null;
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private signer: Wallet | null = null;
  private keystoreCache: EvmKeystoreFile | null = null;

  constructor(params: { stateDir: string }) {
    this.keystorePath = resolveEvmKeystorePath(params.stateDir);
  }

  getKeystorePath(): string {
    return this.keystorePath;
  }

  private loadKeystore(): EvmKeystoreFile | null {
    const loaded = readEvmKeystoreFile(this.keystorePath);
    this.keystoreCache = loaded;
    return loaded;
  }

  status(): EvmWalletStatus {
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
    const wallet = Wallet.createRandom();
    const keystore = createEvmKeystoreFile({
      address: wallet.address,
      privateKeyHex: wallet.privateKey,
      password: params.password,
    });
    saveEvmKeystoreFile(this.keystorePath, keystore);
    this.keystoreCache = keystore;
    return { address: wallet.address };
  }

  unlock(params: { password: string; ttlMs?: number }): {
    address: string;
    unlockedUntilMs: number;
  } {
    const keystore = this.keystoreCache ?? this.loadKeystore();
    if (!keystore) {
      throw new Error("wallet not initialized");
    }
    const secret = decryptEvmKeystoreFile({ keystore, password: params.password });
    const signer = new Wallet(secret.privateKeyHex);

    const ttlMs =
      typeof params.ttlMs === "number" && Number.isFinite(params.ttlMs)
        ? Math.max(1_000, Math.floor(params.ttlMs))
        : DEFAULT_UNLOCK_TTL_MS;

    this.signer = signer;
    this.unlockedUntilMs = Date.now() + ttlMs;
    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
    }
    this.lockTimer = setTimeout(() => this.lock(), ttlMs);

    return { address: signer.address, unlockedUntilMs: this.unlockedUntilMs };
  }

  lock(): void {
    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
      this.lockTimer = null;
    }
    this.signer = null;
    this.unlockedUntilMs = null;
  }

  requireUnlocked(): Wallet {
    const now = Date.now();
    if (!this.signer || !this.unlockedUntilMs || this.unlockedUntilMs <= now) {
      this.lock();
      throw new Error("wallet locked");
    }
    return this.signer;
  }

  signMessage(params: { message: string }): Promise<string> {
    const signer = this.requireUnlocked();
    return signer.signMessage(params.message);
  }
}
