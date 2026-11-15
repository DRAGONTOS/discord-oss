import { argon2idAsync } from "@noble/hashes/argon2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

interface Argon2Options {
    password: Uint8Array | string;
    salt: Uint8Array | string;
    parallelism: number;
    iterations: number;
    memorySize: number;
    hashLength: number;
    outputType?: "binary" | "hex";
}

// A loader can provide Argon2id natively: (passwordHex, saltHex, iterations, memoryKiB, parallelism, hashLength) -> hex or null.
// The backup's 64 MiB, three-pass setting takes 75 to 115 seconds in Hermes on iOS and well under a second natively.
type NativeArgon2id = (password: string, salt: string, iterations: number, memorySize: number, parallelism: number, hashLength: number) => unknown;

const nativeArgon2id = ({ password, salt, parallelism, iterations, memorySize, hashLength }: Argon2Options) => {
    const native = (globalThis as { __nativeArgon2id?: NativeArgon2id }).__nativeArgon2id;
    if (typeof native !== "function" || typeof password === "string" || typeof salt === "string") return null;
    try {
        const result = native(bytesToHex(password), bytesToHex(salt), iterations, memorySize, parallelism, hashLength);
        return typeof result === "string" && result.length === hashLength * 2 ? hexToBytes(result) : null;
    } catch {
        return null;
    }
};

export const argon2id = async (options: Argon2Options) =>
    nativeArgon2id(options) ??
    argon2idAsync(options.password, options.salt, { p: options.parallelism, t: options.iterations, m: options.memorySize, dkLen: options.hashLength, asyncTick: 25 });
