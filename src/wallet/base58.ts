const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP = new Map<string, number>(
  Array.from(BASE58_ALPHABET).map((char, index) => [char, index]),
);

export function encodeBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }

  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    zeros++;
  }

  const digits: number[] = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i] ?? 0;
    for (let j = 0; j < digits.length; j++) {
      const x = digits[j]! * 256 + carry;
      digits[j] = x % 58;
      carry = Math.floor(x / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let out = zeros > 0 ? "1".repeat(zeros) : "";
  for (let i = digits.length - 1; i >= 0; i--) {
    out += BASE58_ALPHABET[digits[i]!]!;
  }
  return out;
}

export function decodeBase58(value: string): Uint8Array {
  const normalized = value.trim();
  if (!normalized) {
    return new Uint8Array();
  }

  let zeros = 0;
  while (zeros < normalized.length && normalized[zeros] === "1") {
    zeros++;
  }

  const bytes: number[] = [0];
  for (let i = zeros; i < normalized.length; i++) {
    const char = normalized[i]!;
    const digit = BASE58_MAP.get(char);
    if (digit === undefined) {
      throw new Error(`invalid base58 character: ${char}`);
    }
    let carry = digit;
    for (let j = 0; j < bytes.length; j++) {
      const x = bytes[j]! * 58 + carry;
      bytes[j] = x & 0xff;
      carry = x >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  const out = new Uint8Array(zeros + bytes.length);
  out.fill(0, 0, zeros);
  for (let i = 0; i < bytes.length; i++) {
    out[out.length - 1 - i] = bytes[i]!;
  }
  return out;
}
