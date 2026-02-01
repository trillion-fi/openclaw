import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createSolanaKeystoreFile,
  decryptSolanaKeystoreFile,
  readSolanaKeystoreFile,
  saveSolanaKeystoreFile,
} from "./solana-keystore.js";

describe("solana keystore", () => {
  it("encrypts + decrypts secret key", () => {
    const secretKeyBytes = new Uint8Array(Array.from({ length: 64 }, () => 0x11));
    const keystore = createSolanaKeystoreFile({
      address: "11111111111111111111111111111111",
      secretKeyBytes,
      password: "pw",
      nowMs: 1_700_000_000_000,
    });
    const decrypted = decryptSolanaKeystoreFile({
      keystore,
      password: "pw",
    });
    expect(Buffer.from(decrypted.secretKeyBytes).toString("hex")).toBe(
      Buffer.from(secretKeyBytes).toString("hex"),
    );
  });

  it("rejects wrong password", () => {
    const secretKeyBytes = new Uint8Array(Array.from({ length: 64 }, () => 0x22));
    const keystore = createSolanaKeystoreFile({
      address: "11111111111111111111111111111111",
      secretKeyBytes,
      password: "pw-1",
      nowMs: 1_700_000_000_000,
    });
    expect(() =>
      decryptSolanaKeystoreFile({
        keystore,
        password: "pw-2",
      }),
    ).toThrow(/invalid password|corrupted/i);
  });

  it("roundtrips via disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-solana-keystore-"));
    const filePath = path.join(dir, "keystore.json");
    const secretKeyBytes = new Uint8Array(Array.from({ length: 64 }, () => 0x33));
    const keystore = createSolanaKeystoreFile({
      address: "11111111111111111111111111111111",
      secretKeyBytes,
      password: "pw",
      nowMs: 1_700_000_000_000,
    });
    saveSolanaKeystoreFile(filePath, keystore);
    const loaded = readSolanaKeystoreFile(filePath);
    expect(loaded).not.toBeNull();
    const decrypted = decryptSolanaKeystoreFile({
      keystore: loaded!,
      password: "pw",
    });
    expect(Buffer.from(decrypted.secretKeyBytes).toString("hex")).toBe(
      Buffer.from(secretKeyBytes).toString("hex"),
    );
  });
});

