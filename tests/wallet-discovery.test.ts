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

  it("waits for Solflare to register asynchronously instead of selecting the broken legacy request path", async () => {
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

    fakeWindow.addEventListener("wallet-standard:app-ready", () => {
      // Real extensions may answer app-ready after the dispatching stack has
      // unwound. The resolver must not immediately choose window.solflare's
      // legacy provider while this registration is still pending.
      setTimeout(() => {
        fakeWindow.dispatchEvent(
          new CustomEvent("wallet-standard:register-wallet", {
            detail: (api: { register: (...wallets: unknown[]) => unknown }) => {
              api.register(wallet);
            },
          }),
        );
      }, 20);
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
