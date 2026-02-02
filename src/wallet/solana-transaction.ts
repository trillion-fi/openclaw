export type SolanaTransactionVersion = "legacy" | "v0";

export type SolanaTransactionParsed = {
  signatureCount: number;
  signatures: Uint8Array[];
  messageBytes: Uint8Array;
  version: SolanaTransactionVersion;
  requiredSignatures: number;
  staticAccountKeys: Uint8Array[];
  recentBlockhash: Uint8Array;
  instructionCount: number;
};

function isU8(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xff;
}

export function readShortVec(bytes: Uint8Array, offset: number): { value: number; offset: number } {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  for (let i = 0; i < 10; i++) {
    const byte = bytes[cursor];
    if (byte === undefined) {
      throw new Error("invalid shortvec: unexpected eof");
    }
    cursor++;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value, offset: cursor };
    }
    shift += 7;
  }
  throw new Error("invalid shortvec: too long");
}

export function encodeShortVec(value: number): Uint8Array {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error("invalid shortvec value");
  }
  const out: number[] = [];
  let remaining = value;
  while (true) {
    const byte = remaining & 0x7f;
    remaining >>= 7;
    if (remaining === 0) {
      out.push(byte);
      break;
    }
    out.push(byte | 0x80);
  }
  return new Uint8Array(out);
}

function requireSlice(bytes: Uint8Array, offset: number, length: number, label: string): Uint8Array {
  const end = offset + length;
  if (offset < 0 || length < 0 || end > bytes.length) {
    throw new Error(`invalid ${label}: out of bounds`);
  }
  return bytes.slice(offset, end);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function parseMessage(bytes: Uint8Array): Omit<
  SolanaTransactionParsed,
  "signatureCount" | "signatures" | "messageBytes"
> {
  if (bytes.length < 4) {
    throw new Error("invalid solana message: too short");
  }

  let offset = 0;
  const first = bytes[0]!;
  let version: SolanaTransactionVersion = "legacy";
  if ((first & 0x80) !== 0) {
    const versionNum = first & 0x7f;
    if (versionNum !== 0) {
      throw new Error(`unsupported solana message version: ${versionNum}`);
    }
    version = "v0";
    offset += 1;
  }

  const requiredSignatures = bytes[offset];
  const readonlySigned = bytes[offset + 1];
  const readonlyUnsigned = bytes[offset + 2];
  if (!isU8(requiredSignatures ?? -1) || !isU8(readonlySigned ?? -1) || !isU8(readonlyUnsigned ?? -1)) {
    throw new Error("invalid solana message header");
  }
  offset += 3;

  const accountKeyLen = readShortVec(bytes, offset);
  offset = accountKeyLen.offset;
  const staticAccountKeys: Uint8Array[] = [];
  for (let i = 0; i < accountKeyLen.value; i++) {
    staticAccountKeys.push(requireSlice(bytes, offset, 32, "solana account key"));
    offset += 32;
  }

  const recentBlockhash = requireSlice(bytes, offset, 32, "solana recentBlockhash");
  offset += 32;

  const instructionCountRes = readShortVec(bytes, offset);
  offset = instructionCountRes.offset;
  for (let i = 0; i < instructionCountRes.value; i++) {
    // programIdIndex
    requireSlice(bytes, offset, 1, "solana instruction programIdIndex");
    offset += 1;

    const accountsLen = readShortVec(bytes, offset);
    offset = accountsLen.offset;
    requireSlice(bytes, offset, accountsLen.value, "solana instruction account indices");
    offset += accountsLen.value;

    const dataLen = readShortVec(bytes, offset);
    offset = dataLen.offset;
    requireSlice(bytes, offset, dataLen.value, "solana instruction data");
    offset += dataLen.value;
  }

  if (version === "v0") {
    const lookupCountRes = readShortVec(bytes, offset);
    offset = lookupCountRes.offset;
    for (let i = 0; i < lookupCountRes.value; i++) {
      requireSlice(bytes, offset, 32, "solana address table account");
      offset += 32;

      const writableLen = readShortVec(bytes, offset);
      offset = writableLen.offset;
      requireSlice(bytes, offset, writableLen.value, "solana address table writable indexes");
      offset += writableLen.value;

      const readonlyLen = readShortVec(bytes, offset);
      offset = readonlyLen.offset;
      requireSlice(bytes, offset, readonlyLen.value, "solana address table readonly indexes");
      offset += readonlyLen.value;
    }
  }

  if (offset !== bytes.length) {
    // Be strict; tx signing should not accept trailing junk.
    throw new Error("invalid solana message: trailing bytes");
  }

  return {
    version,
    requiredSignatures,
    staticAccountKeys,
    recentBlockhash,
    instructionCount: instructionCountRes.value,
  };
}

export function parseSolanaTransaction(bytes: Uint8Array): SolanaTransactionParsed {
  let offset = 0;
  const signatureCountRes = readShortVec(bytes, offset);
  offset = signatureCountRes.offset;
  const signatures: Uint8Array[] = [];
  for (let i = 0; i < signatureCountRes.value; i++) {
    signatures.push(requireSlice(bytes, offset, 64, "solana signature"));
    offset += 64;
  }
  const messageBytes = bytes.slice(offset);
  const message = parseMessage(messageBytes);
  if (signatureCountRes.value !== message.requiredSignatures) {
    throw new Error(
      `invalid solana transaction: signature count ${signatureCountRes.value} != required ${message.requiredSignatures}`,
    );
  }
  return {
    signatureCount: signatureCountRes.value,
    signatures,
    messageBytes,
    ...message,
  };
}

export function findSolanaSignerIndex(params: {
  tx: SolanaTransactionParsed;
  signerPublicKey: Uint8Array;
}): number {
  const required = params.tx.requiredSignatures;
  for (let i = 0; i < Math.min(required, params.tx.staticAccountKeys.length); i++) {
    if (bytesEqual(params.tx.staticAccountKeys[i]!, params.signerPublicKey)) {
      return i;
    }
  }
  return -1;
}

export function replaceSolanaSignature(params: {
  tx: SolanaTransactionParsed;
  signerIndex: number;
  signature: Uint8Array;
}): Uint8Array {
  if (params.signature.length !== 64) {
    throw new Error("invalid solana signature length");
  }
  if (params.signerIndex < 0 || params.signerIndex >= params.tx.signatureCount) {
    throw new Error("invalid solana signer index");
  }
  const prefix = encodeShortVec(params.tx.signatureCount);
  const out = new Uint8Array(prefix.length + params.tx.signatureCount * 64 + params.tx.messageBytes.length);
  out.set(prefix, 0);
  let offset = prefix.length;
  for (let i = 0; i < params.tx.signatureCount; i++) {
    const sig = i === params.signerIndex ? params.signature : params.tx.signatures[i]!;
    out.set(sig, offset);
    offset += 64;
  }
  out.set(params.tx.messageBytes, offset);
  return out;
}

