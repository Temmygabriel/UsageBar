import { afterEach, describe, expect, it } from "vitest";

import { resolveWalletProvider } from "../lib/wallet";

describe("Wallet Standard discovery", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  afterEach(() => {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", previousWindow);
    }
  });

  it("passes the registration API in app-ready so wallets loaded before the page can register", async () => {
    const fakeWindow = new EventTarget();
    const wallet = {
      name: "Solflare",
      chains: ["solana:devnet"],
      accounts: [],
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: async () => ({ accounts: [] }),
        },
        "solana:signAndSendTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signAndSendTransaction: async () => [{ signature: new Uint8Array(64) }],
        },
      },
    };

    // This represents a wallet extension that registered before the app loaded.
    // It waits for app-ready and expects the required API in event.detail.
    fakeWindow.addEventListener("wallet-standard:app-ready", (event) => {
      const api = (event as CustomEvent<{
        register: (...wallets: unknown[]) => unknown;
      }>).detail;
      if (api === undefined || typeof api.register !== "function") {
        throw new Error("wallet-standard:app-ready was missing its required API detail");
      }
      api.register(wallet);
    });

    // If the standard feature isn't discovered, this broken legacy façade would
    // be selected and reproduce the old "Expected String" fallback behavior.
    Object.assign(fakeWindow, {
      solflare: {
        connect: async () => ({ publicKey: { toString: () => "LegacyFacade" } }),
        request: async () => {
          throw new Error("Expected String");
        },
      },
    });

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });

    const provider = await resolveWalletProvider("solflare");
    expect(provider).toBe(wallet);
    expect((provider as { features?: Record<string, unknown> }).features)
      .toHaveProperty("solana:signAndSendTransaction");
  });
});
