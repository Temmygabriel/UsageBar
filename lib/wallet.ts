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
 *                     takes a base58-encoded legacy MESSAGE and returns a
 *                     base58 signature string.
 *
 * The browser-facing open transaction is deliberately compiled as legacy (it
 * needs no address lookup tables), because this legacy request API cannot be
 * assumed to accept a versioned-message payload. The two interfaces are not
 * interchangeable, so both are attempted in order.
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

export type WalletId = "solflare" | "phantom" | "okx";

export interface WalletOption {
  readonly id: WalletId;
  readonly name: string;
  readonly installed: boolean;
}

export const SUPPORTED_WALLETS: readonly Omit<WalletOption, "installed">[] = [
  { id: "solflare", name: "Solflare" },
  { id: "phantom", name: "Phantom" },
  { id: "okx", name: "OKX Wallet" },
];

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
  readonly isSolflare?: boolean;
  readonly isOKXWallet?: boolean;
  readonly isOkxWallet?: boolean;
  readonly name?: string;
  readonly chains?: readonly string[];
  readonly accounts?: readonly { address: string }[];
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

type StandardWallet = WalletProvider & { readonly name: string };

type InjectedWindow = Window & {
  phantom?: { solana?: WalletProvider };
  solana?: WalletProvider;
  solflare?: WalletProvider | { solana?: WalletProvider };
  okxwallet?: { solana?: WalletProvider };
};

interface WalletStandardAppApi {
  register(...wallets: StandardWallet[]): () => void;
}

let standardRegistryInitialized = false;
const standardWallets: StandardWallet[] = [];
let standardAppApi: WalletStandardAppApi | null = null;

/**
 * Minimal Wallet Standard registration bridge. It follows the standard app-ready /
 * register-wallet event handshake without adding another client dependency.
 */
function getRegisteredStandardWallets(): readonly StandardWallet[] {
  if (typeof window === "undefined") return [];
  if (standardRegistryInitialized) return standardWallets;
  standardRegistryInitialized = true;

  const api: WalletStandardAppApi = Object.freeze({
    register: (...wallets: StandardWallet[]) => {
      const added = wallets.filter((wallet) => !standardWallets.includes(wallet));
      standardWallets.push(...added);
      // Match the Wallet Standard registry contract so providers may unregister
      // cleanly without affecting wallets registered by another extension.
      return () => {
        for (const wallet of added) {
          const index = standardWallets.indexOf(wallet);
          if (index >= 0) standardWallets.splice(index, 1);
        }
      };
    },
  });
  standardAppApi = api;

  window.addEventListener("wallet-standard:register-wallet", (event: Event) => {
    // Wallet Standard wallets dispatch this event with a registration callback
    // in detail. The application passes the registry API to that callback.
    const register = (event as CustomEvent<(app: WalletStandardAppApi) => void>).detail;
    if (typeof register === "function") register(api);
  });

  // The standard readiness signal is a plain Event. Wallets that registered
  // before the page loaded will dispatch their registration callback in
  // response, which the listener above hands our registry API.
  // The event detail is required by Wallet Standard. Wallets that loaded
  // before this page listen for app-ready and read detail.register; a plain
  // Event leaves detail undefined, so their signAndSendTransaction feature is
  // never registered and the app incorrectly falls back to a broken legacy API.
  window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));
  return standardWallets;
}

function matchesWalletName(name: string, id: WalletId): boolean {
  const lower = name.toLowerCase();
  if (id === "solflare") return lower.includes("solflare");
  if (id === "phantom") return lower.includes("phantom");
  return lower.includes("okx");
}

function providerLike(value: unknown): WalletProvider | null {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as WalletProvider;
  return typeof candidate.connect === "function" ||
    typeof candidate.request === "function" ||
    candidate.features !== undefined
    ? candidate
    : null;
}

/** Find a registered Wallet Standard wallet by the explicit picker choice. */
function findStandardWallet(id: WalletId): StandardWallet | undefined {
  // Do not filter by wallet.chains here. Some extensions report a chain list
  // that reflects their current adapter configuration rather than every chain
  // the installed wallet can sign. We still pass solana:devnet to the signing
  // feature, and the wallet must reject an unsupported chain itself.
  return standardWallets.find((wallet) => matchesWalletName(wallet.name, id));
}

/** Resolve an injected provider only after checking the registered Standard wallets. */
function getInjectedWalletProvider(id: WalletId): WalletProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as InjectedWindow;

  if (id === "phantom") {
    return providerLike(w.phantom?.solana) ??
      (w.solana?.isPhantom === true ? providerLike(w.solana) : null);
  }
  if (id === "solflare") {
    // Preserve the injected provider path that worked before the wallet chooser
    // was introduced. Solflare may expose both window.solana and window.solflare;
    // these are not guaranteed to be the same object or expose the same API.
    // When window.solana explicitly identifies as Solflare, prefer that provider
    // instead of sending a generic request() payload to another façade.
    if (w.solana?.isSolflare === true) {
      const brandedLegacyProvider = providerLike(w.solana);
      if (brandedLegacyProvider !== null) return brandedLegacyProvider;
    }

    const injected = w.solflare;
    const nested = providerLike((injected as { solana?: WalletProvider } | undefined)?.solana);
    const direct = providerLike(injected);
    return nested ?? direct;
  }
  return providerLike(w.okxwallet?.solana) ??
    ((w.solana?.isOKXWallet === true || w.solana?.isOkxWallet === true)
      ? providerLike(w.solana)
      : null);
}

/** Synchronous detection for the wallet picker; connection uses the async resolver below. */
export function getWalletProvider(id: WalletId): WalletProvider | null {
  if (typeof window === "undefined") return null;
  const standardWallet = getRegisteredStandardWallets().find(
    (wallet) => matchesWalletName(wallet.name, id),
  );
  return standardWallet ?? getInjectedWalletProvider(id);
}

/**
 * Resolve a wallet for an actual connection attempt.
 *
 * Browser extensions may register their Wallet Standard wallet asynchronously
 * after the app-ready event. A synchronous lookup immediately falls back to the
 * legacy injected provider, whose generic request() method is not a valid
 * substitute for Solflare's Wallet Standard signAndSendTransaction feature.
 * Re-announce app-ready and allow a short registration window before choosing
 * that legacy fallback.
 */
export async function resolveWalletProvider(id: WalletId): Promise<WalletProvider | null> {
  if (typeof window === "undefined") return null;

  getRegisteredStandardWallets();
  const alreadyRegistered = findStandardWallet(id);
  if (alreadyRegistered !== undefined) return alreadyRegistered;

  // Re-dispatch in case the first discovery occurred before the extension had
  // attached its registration listener. Duplicate registrations are deduped.
  if (standardAppApi !== null) {
    window.dispatchEvent(
      new CustomEvent("wallet-standard:app-ready", { detail: standardAppApi }),
    );
  }

  // Wait up to 600 ms for an extension to dispatch wallet-standard:register-wallet.
  // This is only on explicit connect, not normal page rendering or wallet-picker display.
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    const registered = findStandardWallet(id);
    if (registered !== undefined) return registered;
  }

  return getInjectedWalletProvider(id);
}

/** Options shown in the wallet picker; detect each brand independently. */
export function getWalletOptions(): WalletOption[] {
  return SUPPORTED_WALLETS.map((wallet) => ({
    ...wallet,
    installed: getWalletProvider(wallet.id) !== null,
  }));
}

/** Compatibility helper for older callers: resolve Phantom explicitly. */
export function detectProvider(): WalletProvider | null {
  return getWalletProvider("phantom");
}

/** Get a callable method from either a Wallet Standard feature object or a direct function. */
function featureMethod(
  provider: WalletProvider,
  featureName: string,
  methodName: string,
): FeatureCall | null {
  const feature = provider.features?.[featureName];
  if (feature === null || feature === undefined) return null;
  if (typeof feature === "function") return feature as FeatureCall;

  const value = feature as Record<string, unknown>;
  const method = value[methodName];
  if (typeof method === "function") {
    return (input: unknown) => (method as FeatureCall).call(feature, input);
  }
  // Support wrappers used by a few Wallet Standard bridge implementations.
  const wrapped = value.feature;
  if (wrapped !== null && typeof wrapped === "object") {
    const nestedMethod = (wrapped as Record<string, unknown>)[methodName];
    if (typeof nestedMethod === "function") {
      return (input: unknown) => (nestedMethod as FeatureCall).call(wrapped, input);
    }
  }
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
export async function connectWallet(
  provider: WalletProvider,
  walletName: string,
  options: { readonly silent?: boolean } = {},
): Promise<ConnectedWallet> {
  const standardConnect = featureMethod(provider, "standard:connect", "connect");

  if (standardConnect !== null) {
    const result = (await standardConnect(options.silent === true ? { silent: true } : {})) as {
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
      walletName,
      provider,
    };
  }

  if (typeof provider.connect !== "function") {
    throw new Error(
      "This wallet does not expose a connection method recognised by UsageBar. Update the extension or choose another supported wallet.",
    );
  }

  // Only attempt an automatic legacy reconnect for Phantom's trusted-site flow.
  // Never call an unknown legacy adapter's connect() on page load: it may open
  // a consent popup unexpectedly. Other legacy wallets remain manually connectable.
  if (options.silent === true && provider.isPhantom !== true) {
    throw new Error("This legacy wallet does not support a safe silent reconnect.");
  }
  const result = await provider.connect(
    options.silent === true ? { onlyIfTrusted: true } : undefined,
  );
  const publicKey = result?.publicKey ?? provider.publicKey ?? null;
  if (publicKey === null || publicKey === undefined) {
    throw new Error("The wallet returned no public key. Unlock it and try again.");
  }

  return {
    address: publicKey.toString(),
    walletName,
    provider,
  };
}

/** Disconnect, if the wallet supports it. Failure here is not worth surfacing. */
export async function disconnectWallet(provider: WalletProvider): Promise<void> {
  try {
    const standardDisconnect = featureMethod(provider, "standard:disconnect", "disconnect");
    if (standardDisconnect !== null) {
      await standardDisconnect({});
    } else {
      await provider.disconnect?.();
    }
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
  const standardSign = featureMethod(provider, "solana:signAndSendTransaction", "signAndSendTransaction");
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
