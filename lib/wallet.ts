/**
 * The wallet bridge.
 *
 * CLIENT ONLY. This module touches `window`, holds no secrets, and never sees a
 * private key: the customer's key stays inside their wallet extension and this
 * code only ever asks it to sign.
 *
 * WHY THERE ARE TWO SIGNING PATHS
 *
 * Solana wallets have been migrating from a legacy injected API to the Wallet
 * Standard. Phantom currently exposes both, and they accept different things:
 *
 *   Wallet Standard   `features["solana:signAndSendTransaction"]`, which takes
 *                     the whole serialized transaction as bytes and returns a
 *                     signature as bytes. This is the modern interface and the
 *                     one to prefer.
 *   Legacy            `request({ method: "signAndSendTransaction" })`, which
 *                     takes the base58-encoded MESSAGE and returns a base58
 *                     signature string.
 *
 * The two are not interchangeable, and which one is present depends on the
 * wallet and its version. Rather than pin the demo to one of them and discover
 * at judging time that the other is what a visitor has installed, both are
 * attempted in order.
 *
 * This is the one part of the system that CI cannot cover: it needs a real
 * browser with a real extension, and no amount of unit testing substitutes for
 * that. It is written defensively for exactly that reason — the failure mode of
 * a clever single path here is a demo that does not work in front of an
 * audience.
 */

import { base58Encode, base64ToBytes, messageFromWireTransaction } from "./base58";

/** The chain identifier Wallet Standard uses for Devnet. */
const DEVNET_CHAIN = "solana:devnet";

/** The shape this module needs from a wallet account, and nothing more. */
export interface WalletAccount {
  readonly address: string;
  /** The raw wallet account object, passed back to the wallet when signing. */
  readonly raw: unknown;
}

export interface ConnectedWallet {
  readonly address: string;
  readonly walletName: string;
  /** Opaque handle the wallet needs on later calls. Never inspected here. */
  readonly provider: WalletProvider;
}

/**
 * The parts of a wallet provider this module uses.
 *
 * Typed loosely on purpose. Wallets inject arbitrary extra surface, and a strict
 * type here would either be wrong or would force casts at every call site; the
 * features are checked for existence before use, which is the protection that
 * actually matters.
 */
export interface WalletProvider {
  readonly isPhantom?: boolean;
  readonly publicKey?: { toString(): string } | null;
  readonly features?: Record<string, unknown>;
  connect?(options?: unknown): Promise<{ publicKey?: { toString(): string } }>;
  disconnect?(): Promise<void>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeAllListeners?(event?: string): void;
  request?(args: { method: string; params?: unknown }): Promise<unknown>;
}

interface FeatureCall {
  (input: unknown): Promise<unknown>;
}

/** Find an injected wallet, preferring Phantom and falling back to any `window.solana`. */
export function detectProvider(): WalletProvider | null {
  if (typeof window === "undefined") return null;
  const anyWindow = window as unknown as {
    phantom?: { solana?: WalletProvider };
    solana?: WalletProvider;
  };
  return anyWindow.phantom?.solana ?? anyWindow.solana ?? null;
}

function featureOf(provider: WalletProvider, name: string): FeatureCall | null {
  const feature = provider.features?.[name];
  if (feature === null || feature === undefined) return null;
  // Wallet Standard features are objects carrying a `feature` marker and their
  // callable behaviour; some wallets expose the callable directly.
  const callable = feature as { feature?: FeatureCall } & Partial<FeatureCall>;
  if (typeof callable === "function") return callable as FeatureCall;
  if (typeof callable.feature === "function") return callable.feature;
  return null;
}

/**
 * Connect, and return the account to sign with.
 *
 * Prefers the Wallet Standard `standard:connect` feature, which returns wallet
 * accounts directly, and falls back to the legacy `connect()`, whose result
 * carries only a public key. Both are normalised to the same shape so callers
 * never branch on which wallet they are talking to.
 */
export async function connectWallet(provider: WalletProvider): Promise<ConnectedWallet> {
  const standardConnect = featureOf(provider, "standard:connect");

  if (standardConnect !== null) {
    const result = (await standardConnect({})) as {
      accounts?: readonly { address: string }[];
    };
    const account = result.accounts?.[0];
    if (account === undefined) {
      throw new Error(
        "The wallet connected but returned no accounts. If your wallet is locked, unlock it " +
          "and try again.",
      );
    }
    return {
      address: account.address,
      walletName: provider.isPhantom === true ? "Phantom" : "Wallet",
      provider,
    };
  }

  if (typeof provider.connect !== "function") {
    throw new Error(
      "This wallet does not expose a connection method this app recognises. Phantom is the " +
        "one this demo is tested against.",
    );
  }

  const result = await provider.connect();
  const publicKey = result?.publicKey ?? provider.publicKey ?? null;
  if (publicKey === null || publicKey === undefined) {
    throw new Error("The wallet returned no public key. Unlock it and try again.");
  }

  return {
    address: publicKey.toString(),
    walletName: provider.isPhantom === true ? "Phantom" : "Wallet",
    provider,
  };
}

/** Disconnect, if the wallet supports it. Failure here is not worth surfacing. */
export async function disconnectWallet(provider: WalletProvider): Promise<void> {
  try {
    await provider.disconnect?.();
  } catch {
    // A wallet that refuses to disconnect has still stopped being used by this
    // page; there is nothing useful to tell the user.
  }
}

/**
 * Ask the wallet to sign a transaction and send it, returning the signature.
 *
 * `transactionBase64` is the unsigned wire transaction the server built. The
 * wallet fills in the payer's signature; it never hands the key back.
 *
 * The two paths are tried in order, and the errors from both are reported
 * together if neither works — a message naming only the second failure would
 * hide the more informative one.
 */
export async function signAndSend(
  wallet: ConnectedWallet,
  transactionBase64: string,
): Promise<string> {
  const wire = base64ToBytes(transactionBase64);
  const provider = wallet.provider;
  const failures: string[] = [];

  // --- Path 1: Wallet Standard, whole transaction as bytes ------------------
  const standardSign = featureOf(provider, "solana:signAndSendTransaction");
  if (standardSign !== null) {
    try {
      const accounts = accountListOf(provider);
      const account =
        accounts.find((candidate) => candidate.address === wallet.address) ?? accounts[0];

      if (account !== undefined) {
        const output = (await standardSign({
          account: account.raw,
          chain: DEVNET_CHAIN,
          transaction: wire,
        })) as readonly { signature?: Uint8Array }[] | { signature?: Uint8Array };

        const first = Array.isArray(output) ? output[0] : output;
        const signature = first?.signature;
        if (signature instanceof Uint8Array) {
          return base58Encode(signature);
        }
        failures.push("the wallet standard path returned no signature");
      } else {
        failures.push("the wallet standard path found no account to sign with");
      }
    } catch (error) {
      failures.push(
        `the wallet standard path failed (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  } else {
    failures.push("this wallet does not offer solana:signAndSendTransaction");
  }

  // --- Path 2: legacy request, base58 message -------------------------------
  if (typeof provider.request === "function") {
    try {
      const message = messageFromWireTransaction(wire, 1);
      const response = (await provider.request({
        method: "signAndSendTransaction",
        params: { message: base58Encode(message) },
      })) as { signature?: string } | string;

      const signature = typeof response === "string" ? response : response?.signature;
      if (typeof signature === "string" && signature !== "") {
        return signature;
      }
      failures.push("the legacy path returned no signature");
    } catch (error) {
      failures.push(
        `the legacy path failed (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  } else {
    failures.push("this wallet does not offer request()");
  }

  throw new Error(
    `The wallet would not sign the transaction. ${failures.join("; ")}. ` +
      "Open the wallet, make sure it is unlocked and set to Devnet, and try again.",
  );
}

/**
 * The wallet's accounts, normalised.
 *
 * Wallet Standard wallets carry an `accounts` array; the legacy provider
 * carries a single `publicKey`. Both are reduced to the same shape so the
 * signing path does not care which it got.
 */
function accountListOf(provider: WalletProvider): readonly { address: string; raw: unknown }[] {
  const withAccounts = provider as unknown as { accounts?: readonly { address: string }[] };
  if (Array.isArray(withAccounts.accounts)) {
    return withAccounts.accounts.map((account) => ({ address: account.address, raw: account }));
  }
  if (provider.publicKey !== null && provider.publicKey !== undefined) {
    const address = provider.publicKey.toString();
    return [{ address, raw: { address } }];
  }
  return [];
}

/** Subscribe to the wallet's own account changes, so a switch is noticed. */
export function onWalletChange(
  provider: WalletProvider,
  handler: (address: string | null) => void,
): () => void {
  if (typeof provider.on !== "function") return () => {};

  const listener = (...args: unknown[]) => {
    const first = args[0] as { publicKey?: { toString(): string } | null } | undefined;
    const publicKey = first?.publicKey ?? provider.publicKey ?? null;
    handler(publicKey === null || publicKey === undefined ? null : publicKey.toString());
  };

  provider.on("accountChanged", listener);
  provider.on("disconnect", () => handler(null));

  return () => {
    provider.removeAllListeners?.("accountChanged");
    provider.removeAllListeners?.("disconnect");
  };
}
