import { describe, expect, it } from "vitest";

import { connectWallet, type WalletProvider } from "../lib/wallet";

describe("silent wallet reconnection", () => {
  it("asks Wallet Standard to reconnect silently after a prior authorization", async () => {
    let receivedOptions: unknown = null;
    const provider = {
      name: "Phantom",
      accounts: [{ address: "TrustedAddress" }],
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: async (options: unknown) => {
            receivedOptions = options;
            return { accounts: [{ address: "TrustedAddress" }] };
          },
        },
      },
    } as unknown as WalletProvider;

    const connected = await connectWallet(provider, "Phantom", { silent: true });

    expect(receivedOptions).toEqual({ silent: true });
    expect(connected.address).toBe("TrustedAddress");
  });

  it("uses onlyIfTrusted for silent legacy Phantom reconnection", async () => {
    let receivedOptions: unknown = null;
    const provider = {
      isPhantom: true,
      connect: async (options?: unknown) => {
        receivedOptions = options;
        return { publicKey: { toString: () => "TrustedLegacyAddress" } };
      },
    } as unknown as WalletProvider;

    const connected = await connectWallet(provider, "Phantom", { silent: true });

    expect(receivedOptions).toEqual({ onlyIfTrusted: true });
    expect(connected.address).toBe("TrustedLegacyAddress");
  });

  it("does not invoke an unknown legacy wallet during silent reconnection", async () => {
    let connectCalled = false;
    const provider = {
      isSolflare: true,
      connect: async () => {
        connectCalled = true;
        return { publicKey: { toString: () => "UnexpectedAddress" } };
      },
    } as unknown as WalletProvider;

    await expect(connectWallet(provider, "Solflare", { silent: true }))
      .rejects.toThrow("does not support a safe silent reconnect");
    expect(connectCalled).toBe(false);
  });
});
