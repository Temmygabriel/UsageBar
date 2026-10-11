import { afterEach, describe, expect, it } from "vitest";

import { getWalletProvider } from "../lib/wallet";

describe("Solflare injected provider selection", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  afterEach(() => {
    if (previousWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", previousWindow);
    }
  });

  it("prefers the Solflare-branded window.solana provider over a separate window.solflare façade", () => {
    const brandedProvider = {
      isSolflare: true,
      connect: async () => ({ publicKey: { toString: () => "SolflareAddress" } }),
      request: async () => "legacy-signature",
    };
    const otherFacade = {
      connect: async () => ({ publicKey: { toString: () => "OtherAddress" } }),
      request: async () => {
        throw new Error("Expected String");
      },
    };

    const fakeWindow = Object.assign(new EventTarget(), {
      solana: brandedProvider,
      solflare: otherFacade,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });

    expect(getWalletProvider("solflare")).toBe(brandedProvider);
  });
});
