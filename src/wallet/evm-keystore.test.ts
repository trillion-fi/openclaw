import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createEvmKeystoreFile,
  decryptEvmKeystoreFile,
  readEvmKeystoreFile,
  saveEvmKeystoreFile,
} from "./evm-keystore.js";

describe("evm keystore", () => {
  it("encrypts + decrypts private key", () => {
    const keystore = createEvmKeystoreFile({
      address: "0x0000000000000000000000000000000000000000",
      privateKeyHex: `0x${"11".repeat(32)}`,
      password: "correct horse battery staple",
      nowMs: 1_700_000_000_000,
    });
    const decrypted = decryptEvmKeystoreFile({
      keystore,
      password: "correct horse battery staple",
    });
    expect(decrypted.privateKeyHex).toBe(`0x${"11".repeat(32)}`);
  });

  it("rejects wrong password", () => {
    const keystore = createEvmKeystoreFile({
      address: "0x0000000000000000000000000000000000000000",
      privateKeyHex: `0x${"22".repeat(32)}`,
      password: "pw-1",
      nowMs: 1_700_000_000_000,
    });
    expect(() =>
      decryptEvmKeystoreFile({
        keystore,
        password: "pw-2",
      }),
    ).toThrow(/invalid password|corrupted/i);
  });

  it("roundtrips via disk", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-evm-keystore-"));
    const filePath = path.join(dir, "keystore.json");
    const keystore = createEvmKeystoreFile({
      address: "0x0000000000000000000000000000000000000000",
      privateKeyHex: `0x${"33".repeat(32)}`,
      password: "pw",
      nowMs: 1_700_000_000_000,
    });
    saveEvmKeystoreFile(filePath, keystore);
    const loaded = readEvmKeystoreFile(filePath);
    expect(loaded).not.toBeNull();
    const decrypted = decryptEvmKeystoreFile({
      keystore: loaded!,
      password: "pw",
    });
    expect(decrypted.privateKeyHex).toBe(`0x${"33".repeat(32)}`);
  });
});
