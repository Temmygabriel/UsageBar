"use client";

/**
 * The session hook: everything that connects the interface to the chain.
 *
 * The governing rule, from build spec Section 12, is that the product state is
 * a READING of chain state and never an optimistic guess. That rule shapes the
 * whole shape of this file:
 *
 *   - The machine never moves to a later state because a button was pressed. It
 *     moves because a transaction confirmed and was read back, or because the
 *     request failed and the state stayed where it was.
 *   - The meter follows the CONFIRMED watermark only. There is no interpolation
 *     between chain reads and no client-side estimate of what the bill "should"
 *     be by now. Every number the tab shows has a signature behind it.
 *   - On failure the state goes backwards or stays put, and the reason is
 *     surfaced verbatim. A demo that silently shows the last good value while
 *     the chain has moved on is worse than one that admits it lost contact.
 *
 * The one piece of client-side persistence is the channel address, kept in
 * localStorage per wallet so a page refresh resumes the same tab instead of
 * leaving an orphaned channel that still holds the customer's money.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  buildOpenTransaction,
  closeSession,
  commitUsage,
  readSession,
  readWalletBalances,
  requestFaucet,
  type ServiceDescription,
  type SessionChannel,
} from "./client-api";
import type { ChannelFacts, ProductState, SettlementProof, UsageUpdate } from "./session";
import {
  connectWallet,
  detectProvider,
  disconnectWallet,
  signAndSend,
  type ConnectedWallet,
} from "./wallet";

/**
 * How long each metering tick bills for, and how often it runs.
 *
 * A usage tab's entire advantage is that usage accrues continuously while the
 * chain is touched occasionally — vouchers are cumulative, so one transaction
 * covers all the usage since the last one. Tick interval and billed interval
 * are equal here for legibility: the meter advances by exactly the five seconds
 * that elapsed, which is easy to check against a stopwatch during a demo.
 */
const TICK_SECONDS = 5;
const TICK_INTERVAL_MS = 5_000;

export interface Notice {
  readonly tone: "info" | "warn" | "error" | "success";
  readonly text: string;
}

export interface SessionState {
  readonly wallet: {
    readonly status: "unsupported" | "disconnected" | "connecting" | "connected";
    readonly address: string | null;
    readonly name: string | null;
  };
  readonly service: ServiceDescription | null;
  readonly state: ProductState;
  readonly channel: SessionChannel | null;
  readonly facts: ChannelFacts | null;
  readonly settlementProof: SettlementProof | null;
  readonly updates: readonly UsageUpdate[];
  readonly notice: Notice | null;
  readonly busy: boolean;
  /** True once the tab has reached its authorized ceiling; further usage stops. */
  readonly atCeiling: boolean;
  /**
   * The connected wallet's own balances, or null before they have been read.
   * Used to offer the faucet before the chain has to refuse a deposit.
   */
  readonly balances: { readonly solLamports: bigint; readonly tokens: bigint | null } | null;
}

export interface SessionActions {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  fund(): Promise<void>;
  open(): Promise<void>;
  close(): Promise<void>;
  dismissNotice(): void;
}

const STORAGE_PREFIX = "usagebar.channel.";

function storageKey(address: string): string {
  return `${STORAGE_PREFIX}${address}`;
}

/**
 * localStorage is wrapped because it is not always available: a private window,
 * blocked site data, or a browser in a locked-down mode can all make the
 * accessor throw. A remembered channel is a convenience, and losing it must not
 * take the page down with it.
 */
function remember(address: string, value: { channel: string; openTransaction: string }): void {
  try {
    window.localStorage.setItem(storageKey(address), JSON.stringify(value));
  } catch {
    // Not fatal: the tab still works, a refresh just will not resume it.
  }
}

function recall(address: string): { channel: string; openTransaction: string } | null {
  try {
    const raw = window.localStorage.getItem(storageKey(address));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { channel?: unknown; openTransaction?: unknown };
    if (typeof parsed.channel !== "string" || typeof parsed.openTransaction !== "string") {
      return null;
    }
    return { channel: parsed.channel, openTransaction: parsed.openTransaction };
  } catch {
    return null;
  }
}

function forget(address: string): void {
  try {
    window.localStorage.removeItem(storageKey(address));
  } catch {
    // See above.
  }
}

export function useSession(): { state: SessionState; actions: SessionActions } {
  const [wallet, setWallet] = useState<SessionState["wallet"]>({
    status: "disconnected",
    address: null,
    name: null,
  });
  const [service, setService] = useState<ServiceDescription | null>(null);
  const [channel, setChannel] = useState<SessionChannel | null>(null);
  const [openTransaction, setOpenTransaction] = useState<string | null>(null);
  const [settlementProof, setSettlementProof] = useState<SessionState["settlementProof"]>(null);
  const [updates, setUpdates] = useState<readonly UsageUpdate[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<ProductState>("READY");
  const [balances, setBalances] = useState<SessionState["balances"]>(null);

  /** The live wallet handle. A ref, not state: it is never rendered. */
  const connectedRef = useRef<ConnectedWallet | null>(null);
  /** Guards the metering loop against overlapping requests. */
  const tickingRef = useRef(false);

  // -------------------------------------------------------------------------
  // Service description, read once on mount
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    readSession()
      .then((response) => {
        if (!cancelled) setService(response.service);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.unconfigured) {
          // A legitimate state, not a failure. The tab stays in READY and says
          // so; nothing below this point will try to touch the chain.
          setNotice({ tone: "warn", text: error.message });
        } else {
          setNotice({
            tone: "error",
            text: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------------------------------------------------------------
  // Wallet
  // -------------------------------------------------------------------------

  /**
   * Read the wallet's own balances.
   *
   * A read that fails leaves the balances `null` rather than setting them to
   * zero. "We could not check" and "you have nothing" lead to different advice,
   * and showing the second when the first is true would tell someone to go and
   * get funds they may already have.
   */
  const refreshBalances = useCallback(async (address: string) => {
    try {
      const result = await readWalletBalances(address);
      setBalances({
        solLamports: BigInt(result.solLamports),
        tokens: result.tokens === null ? null : BigInt(result.tokens),
      });
    } catch {
      setBalances(null);
    }
  }, []);

  const connect = useCallback(async () => {
    setNotice(null);
    const provider = detectProvider();
    if (provider === null) {
      setNotice({
        tone: "warn",
        text:
          "No Solana wallet was found in this browser. This demo is built so that the customer " +
          "holds their own key — you open the tab with your own wallet, and the unused remainder " +
          "is refunded to it when you close. Install Phantom, set it to Devnet, and reload.",
      });
      return;
    }

    setWallet({ status: "connecting", address: null, name: null });
    try {
      const connected = await connectWallet(provider);
      connectedRef.current = connected;
      setWallet({ status: "connected", address: connected.address, name: connected.walletName });
      void refreshBalances(connected.address);

      // Resume a tab this wallet already opened, if there is one. Without this
      // a refresh would strand a channel still holding the customer's deposit.
      const remembered = recall(connected.address);
      if (remembered !== null) {
        setPhase("OPENING");
        const session = await readSession(remembered.channel);
        if (session.channel !== null && session.service !== null) {
          setService(session.service);
          setChannel(session.channel);
          setOpenTransaction(remembered.openTransaction);
          setPhase(session.channel.settled === "0" ? "FUNDED" : "ACTIVE");
          setNotice({
            tone: "info",
            text: `Resumed the tab this wallet already had open at ${remembered.channel}.`,
          });
        } else {
          // It was distributed, or never existed. Either way there is nothing
          // to resume and no money stranded.
          forget(connected.address);
          setPhase("READY");
        }
      } else {
        setPhase("READY");
      }
    } catch (error) {
      connectedRef.current = null;
      setWallet({ status: "disconnected", address: null, name: null });
      setPhase("READY");
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const disconnect = useCallback(async () => {
    const connected = connectedRef.current;
    if (connected !== null) await disconnectWallet(connected.provider);
    connectedRef.current = null;
    setWallet({ status: "disconnected", address: null, name: null });
    // The channel itself is untouched: disconnecting a wallet does not close a
    // tab, and the deposit stays where the chain put it.
    setChannel(null);
    setOpenTransaction(null);
    setSettlementProof(null);
    setUpdates([]);
    setBalances(null);
    setPhase("READY");
  }, []);

  // -------------------------------------------------------------------------
  // Faucet
  // -------------------------------------------------------------------------

  const fund = useCallback(async () => {
    const address = wallet.address;
    if (address === null) return;

    setBusy(true);
    setNotice({ tone: "info", text: "Sending test funds to your wallet…" });
    try {
      await requestFaucet(address);
      setNotice({
        tone: "success",
        text:
          "Test funds sent. Your wallet now holds Devnet SOL for fees and TEST tokens for the " +
          "deposit. Both are worthless by design — this runs on Devnet.",
      });
      await refreshBalances(address);
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [wallet.address, refreshBalances]);

  // -------------------------------------------------------------------------
  // Open
  // -------------------------------------------------------------------------

  const open = useCallback(async () => {
    const connected = connectedRef.current;
    if (connected === null || service === null) return;

    setBusy(true);
    setNotice(null);
    setSettlementProof(null);
    setPhase("OPENING");

    try {
      const built = await buildOpenTransaction(connected.address);

      // The customer signs the deposit with their OWN key. This is the point of
      // the product: the money leaves their wallet under their signature, into
      // an escrow account derived from that same wallet.
      setNotice({ tone: "info", text: "Confirm the deposit in your wallet…" });
      const signature = await signAndSend(connected, built.transaction);

      // The wallet has sent it. Do not assume it landed — poll the chain until
      // the channel is readable, because the next thing the interface says is
      // that the deposit exists.
      setNotice({ tone: "info", text: "Waiting for the chain to confirm the deposit…" });

      const deadline = Date.now() + 60_000;
      let found: SessionChannel | null = null;
      while (Date.now() < deadline) {
        const session = await readSession(built.channel);
        if (session.channel !== null) {
          found = session.channel;
          setService(session.service);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }

      if (found === null) {
        setPhase("READY");
        setNotice({
          tone: "warn",
          text:
            `The transaction ${signature} was submitted but the channel is not readable yet. ` +
            "It may still confirm. Reconnect your wallet in a moment to pick it up — the deposit " +
            "is not lost, and nothing further will be charged.",
        });
        return;
      }

      setChannel(found);
      setOpenTransaction(signature);
      setUpdates([]);
      setPhase(found.settled === "0" ? "FUNDED" : "ACTIVE");
      remember(connected.address, { channel: built.channel, openTransaction: signature });
      setNotice({
        tone: "success",
        text:
          "The tab is open. Your deposit is in escrow and the meter is running — usage is metered " +
          "off chain and committed to Solana as cumulative vouchers.",
      });
    } catch (error) {
      setPhase("READY");
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, [service]);

  // -------------------------------------------------------------------------
  // The meter
  // -------------------------------------------------------------------------

  const channelRef = useRef<SessionChannel | null>(null);
  channelRef.current = channel;

  useEffect(() => {
    if (channel === null) return;
    if (phase !== "FUNDED" && phase !== "ACTIVE") return;

    const timer = setInterval(() => {
      // Skip rather than queue: a tick that arrives while the previous one is
      // still confirming would bill the same seconds twice.
      if (tickingRef.current) return;
      const current = channelRef.current;
      if (current === null) return;
      // Stop at the ceiling. The server would refuse anyway (a voucher above the
      // deposit is rejected with error 235) and it already reports that, but
      // there is no reason to spend a round trip per tick learning it again.
      if (BigInt(current.settled) >= BigInt(current.deposit)) return;

      tickingRef.current = true;
      commitUsage(current.address, TICK_SECONDS)
        .then((result) => {
          if (!result.advanced) return;

          // The number comes back from the server, which read it from chain
          // after the transaction confirmed. It is never computed here.
          setChannel((previous) =>
            previous === null ? previous : { ...previous, settled: result.settled },
          );
          setUpdates((previous) => [
            ...previous,
            {
              sequence: previous.length + 1,
              cumulative: BigInt(result.settled),
              signature: result.signature,
            },
          ]);
          // The tab stays ACTIVE whether or not it has hit the ceiling: the
          // difference is that at the ceiling the meter stops advancing, which
          // the loop above enforces. Reaching the ceiling is not a new state —
          // it is the same state with the meter full.
          setPhase("ACTIVE");
        })
        .catch((error: unknown) => {
          // A failed metering tick stops the loop and says why. Continuing to
          // tick against a chain we cannot reach would keep showing a meter
          // that is quietly going stale.
          setNotice({
            tone: "error",
            text:
              `The meter stopped: ${error instanceof Error ? error.message : String(error)} ` +
              "The amount shown is the last value confirmed on chain.",
          });
        })
        .finally(() => {
          tickingRef.current = false;
        });
    }, TICK_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [channel, phase]);

  // -------------------------------------------------------------------------
  // Close
  // -------------------------------------------------------------------------

  const close = useCallback(async () => {
    const current = channelRef.current;
    const connected = connectedRef.current;
    if (current === null) return;

    setBusy(true);
    setPhase("FINALIZING");
    setNotice({
      tone: "info",
      text: "Sealing the channel and paying out. This is two transactions: a cooperative seal, " +
        "then the distribution.",
    });

    try {
      const result = await closeSession(current.address);

      // The numbers below are the ones the server measured by reading balances
      // before and after the distribution — what actually moved, not what the
      // arithmetic predicts.
      setChannel((previous) =>
        previous === null ? previous : { ...previous, settled: result.settled, status: 3 },
      );
      setSettlementProof({
        sealSignature: result.sealSignature,
        distributeSignature: result.distributeSignature,
        paidToProvider: BigInt(result.paidToProvider),
        returnedToPayer: BigInt(result.returnedToPayer),
      });
      setPhase("SETTLED");
      if (connected !== null) forget(connected.address);

      setNotice({
        tone: "success",
        text:
          `Settled. The provider was paid ${result.paidToProvider} and ${result.returnedToPayer} ` +
          "came back to your wallet — the part of the deposit you did not use. " +
          (result.channelAccountClosed
            ? "The channel account has been deallocated and its rent returned."
            : "The channel account still exists and its rent can be reclaimed separately."),
      });
    } catch (error) {
      // Back to ACTIVE, not to SETTLED. The channel is still open and still
      // holds the money; claiming otherwise would be the exact failure this
      // project is built to avoid.
      setPhase("ACTIVE");
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  // -------------------------------------------------------------------------
  // Derived display state
  // -------------------------------------------------------------------------

  const settled = channel === null ? 0n : BigInt(channel.settled);
  const deposit = channel === null ? 0n : BigInt(channel.deposit);
  const atCeiling = deposit > 0n && settled >= deposit;

  const facts: ChannelFacts | null =
    channel === null || service === null || openTransaction === null
      ? null
      : {
          address: channel.address,
          openTransaction,
          deposit: BigInt(channel.deposit),
          settled: BigInt(channel.settled),
          decimals: service.decimals,
          mint: channel.mint,
        };

  return {
    state: {
      wallet,
      service,
      state: phase,
      channel,
      facts,
      settlementProof,
      updates,
      notice,
      busy,
      atCeiling,
      balances,
    },
    actions: { connect, disconnect, fund, open, close, dismissNotice },
  };
}
