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
  runMeteredExtraction,
  readSession,
  readWalletBalances,
  requestFaucet,
  type ExtractionResult,
  type ServiceDescription,
  type SessionChannel,
} from "./client-api";
import type { ChannelFacts, ProductState, SettlementProof, UsageUpdate } from "./session";
import {
  connectWallet,
  getWalletProvider,
  SUPPORTED_WALLETS,
  disconnectWallet,
  signAndSend,
  type ConnectedWallet,
  type WalletId,
} from "./wallet";

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
  readonly usageAmount: bigint;
  readonly voucherSignature: string | null;
  readonly taskCount: number;
  readonly lastExtraction: ExtractionResult | null;
}

export interface SessionActions {
  connect(walletId: WalletId): Promise<void>;
  cancelConnect(): void;
  disconnect(): Promise<void>;
  fund(): Promise<void>;
  open(ceilingAtomic: string): Promise<void>;
  startService(): void;
  runUsage(documentText: string): Promise<void>;
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
interface RememberedChannel {
  readonly channel: string;
  readonly openTransaction: string;
  readonly usageAtomic?: string;
  readonly voucherSignature?: string | null;
  readonly updateCount?: number;
  readonly serviceStarted?: boolean;
}

function remember(address: string, value: RememberedChannel): void {
  try { window.localStorage.setItem(storageKey(address), JSON.stringify(value)); }
  catch { /* Resume persistence is best-effort; the channel remains on chain. */ }
}

function recall(address: string): RememberedChannel | null {
  try {
    const raw = window.localStorage.getItem(storageKey(address));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedChannel>;
    if (typeof parsed.channel !== "string" || typeof parsed.openTransaction !== "string") return null;
    return {
      channel: parsed.channel,
      openTransaction: parsed.openTransaction,
      usageAtomic: typeof parsed.usageAtomic === "string" && /^\\d+$/.test(parsed.usageAtomic) ? parsed.usageAtomic : "0",
      voucherSignature: typeof parsed.voucherSignature === "string" ? parsed.voucherSignature : null,
      updateCount: typeof parsed.updateCount === "number" && Number.isSafeInteger(parsed.updateCount) ? parsed.updateCount : 0,
      serviceStarted: parsed.serviceStarted === true,
    };
  } catch { return null; }
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
  const [usageAmount, setUsageAmount] = useState(0n);
  const [voucherSignature, setVoucherSignature] = useState<string | null>(null);
  const [taskCount, setTaskCount] = useState(0);
  const [lastExtraction, setLastExtraction] = useState<ExtractionResult | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<ProductState>("READY");
  const [balances, setBalances] = useState<SessionState["balances"]>(null);

  /** The live wallet handle. A ref, not state: it is never rendered. */
  const connectedRef = useRef<ConnectedWallet | null>(null);
  /** Invalidates a pending connection when the user cancels or changes wallets. */
  const connectAttemptRef = useRef(0);
  /** Guards the AI request so a double click cannot issue two usage vouchers. */
  const runningRef = useRef(false);
  const channelRef = useRef<SessionChannel | null>(null);
  channelRef.current = channel;
  const usageAmountRef = useRef(0n);
  usageAmountRef.current = usageAmount;
  const voucherSignatureRef = useRef<string | null>(null);
  voucherSignatureRef.current = voucherSignature;

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

  const connect = useCallback(async (walletId: WalletId) => {
    const attempt = ++connectAttemptRef.current;
    setNotice(null);

    const walletOption = SUPPORTED_WALLETS.find((option) => option.id === walletId);
    const walletName = walletOption?.name ?? walletId;
    const provider = getWalletProvider(walletId);
    if (provider === null) {
      setWallet({ status: "disconnected", address: null, name: null });
      setNotice({
        tone: "warn",
        text: `${walletName} was not detected in this browser. Install or enable its browser extension, then reload UsageBar.`,
      });
      return;
    }

    setWallet({ status: "connecting", address: null, name: walletName });
    try {
      const connected = await new Promise<ConnectedWallet>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          reject(
            new Error(
              `${walletName} did not respond within 60 seconds. UsageBar has reset the connection; dismiss the wallet prompt and try again.`,
            ),
          );
        }, 60_000);

        // Some extensions leave the request pending if their popup is simply
        // closed. The user can cancel immediately in UsageBar; this timeout is
        // the final recovery path if the provider never resolves or rejects.
        connectWallet(provider, walletName).then(
          (value) => {
            window.clearTimeout(timeout);
            resolve(value);
          },
          (error: unknown) => {
            window.clearTimeout(timeout);
            reject(error);
          },
        );
      });
      // The browser extension prompt cannot be dismissed by a page script.
      // If the user cancelled in UsageBar while it was open, ignore a late
      // success/rejection rather than resurrecting the connection state.
      if (connectAttemptRef.current !== attempt) return;

      connectedRef.current = connected;
      setWallet({ status: "connected", address: connected.address, name: connected.walletName });
      void refreshBalances(connected.address);

      // Resume a tab this wallet already opened, if there is one. Without this
      // a refresh would strand a channel still holding the customer's deposit.
      const remembered = recall(connected.address);
      if (remembered !== null) {
        setPhase("OPENING");
        const session = await readSession(remembered.channel);
        if (connectAttemptRef.current !== attempt) return;
        if (session.channel !== null && session.service !== null) {
          setService(session.service);
          setChannel(session.channel);
          setOpenTransaction(remembered.openTransaction);
          const onChainAmount = BigInt(session.channel.settled);
          const storedAmount = BigInt(session.offchainUsage?.cumulative ?? session.channel.settled);
          const amount = storedAmount > onChainAmount ? storedAmount : onChainAmount;
          const signature = session.offchainUsage?.voucherSignature ?? null;
          const count = session.offchainUsage?.count ?? 0;
          setUsageAmount(amount);
          setVoucherSignature(signature);
          setTaskCount(count);
          setLastExtraction(null);
          setUpdates(signature !== null && amount > BigInt(session.channel.settled)
            ? [{ sequence: Math.max(1, count), cumulative: amount, voucherSignature: signature }]
            : []);
          setPhase(remembered.serviceStarted || amount > 0n ? "ACTIVE" : "FUNDED");
          setNotice({ tone: "info", text: `Resumed the open Devnet tab at ${remembered.channel}; the latest voucher was restored from this browser.` });
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
      if (connectAttemptRef.current !== attempt) return;
      connectedRef.current = null;
      setWallet({ status: "disconnected", address: null, name: null });
      setPhase("READY");

      const detail = error instanceof Error ? error.message : String(error);
      const normalized = detail.toLowerCase();
      const userCancelled =
        (typeof error === "object" && error !== null && "code" in error &&
          (error as { code?: unknown }).code === 4001) ||
        normalized.includes("user rejected") ||
        normalized.includes("user denied") ||
        normalized.includes("rejected the request") ||
        normalized.includes("request cancelled") ||
        normalized.includes("request canceled");

      setNotice(
        userCancelled
          ? {
              tone: "warn",
              text: `${walletName} connection was cancelled. No wallet was connected. You can choose a wallet and try again.`,
            }
          : {
              tone: "error",
              text: `${walletName} could not connect: ${detail}`,
            },
      );
    }
  }, [refreshBalances]);

  const cancelConnect = useCallback(() => {
    if (wallet.status !== "connecting") return;
    // Invalidates the unresolved provider promise. This resets our UI even
    // though browser security means we cannot close the extension popup itself.
    connectAttemptRef.current += 1;
    connectedRef.current = null;
    setWallet({ status: "disconnected", address: null, name: null });
    setPhase("READY");
    setNotice({
      tone: "warn",
      text: "Connection cancelled in UsageBar. If the wallet popup is still open, you can dismiss it there too.",
    });
  }, [wallet.status]);

  const disconnect = useCallback(async () => {
    connectAttemptRef.current += 1;
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
    setUsageAmount(0n);
    setVoucherSignature(null);
    setTaskCount(0);
    setLastExtraction(null);
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

  const open = useCallback(async (ceilingAtomic: string) => {
    const connected = connectedRef.current;
    if (connected === null || service === null || !service.groqConfigured) return;

    setBusy(true);
    setNotice(null);
    setSettlementProof(null);
    setPhase("OPENING");

    try {
      const built = await buildOpenTransaction(connected.address, ceilingAtomic);

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

      const initialAmount = BigInt(found.settled);
      setChannel(found);
      setOpenTransaction(signature);
      setUpdates([]);
      setUsageAmount(initialAmount);
      setVoucherSignature(null);
      setTaskCount(0);
      setLastExtraction(null);
      setPhase(initialAmount > 0n ? "ACTIVE" : "FUNDED");
      remember(connected.address, { channel: built.channel, openTransaction: signature, usageAtomic: initialAmount.toString(), voucherSignature: null, updateCount: 0, serviceStarted: false });
      setNotice({ tone: "success", text: `Your ${(BigInt(found.deposit) / (10n ** BigInt(service.decimals))).toString()} TEST cap is escrowed. It is the maximum, not the final charge. Start the AI review service when ready.` });
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
  // Start service and meter successful AI requests off-chain
  // -------------------------------------------------------------------------

  const startService = useCallback(() => {
    const current = channelRef.current;
    const connected = connectedRef.current;
    if (current === null || phase !== "FUNDED") return;
    setPhase("ACTIVE");
    setNotice({ tone: "info", text: "AI contract review is ready. Each successful Groq review costs 1.00 TEST. Usage vouchers stay off-chain until you close the tab." });
    if (connected !== null && openTransaction !== null) {
      remember(connected.address, { channel: current.address, openTransaction, usageAtomic: usageAmountRef.current.toString(), voucherSignature: voucherSignatureRef.current, updateCount: taskCount, serviceStarted: true });
    }
  }, [phase, openTransaction, taskCount]);

  const runUsage = useCallback(async (documentText: string) => {
    const current = channelRef.current;
    const connected = connectedRef.current;
    const currentService = service;
    if (current === null || connected === null || phase !== "ACTIVE" || currentService === null || runningRef.current) return;
    if (!currentService.groqConfigured) {
      setNotice({ tone: "error", text: "Groq is not configured on this deployment. No usage was billed." });
      return;
    }
    const previous = usageAmountRef.current;
    const rate = BigInt(currentService.rateAtomicPerRequest);
    if (previous + rate > BigInt(current.deposit)) {
      setNotice({ tone: "warn", text: "This review would exceed your spending cap. Close and settle the tab to return the unused balance." });
      return;
    }
    runningRef.current = true;
    setBusy(true);
    setNotice({ tone: "info", text: "Groq is reviewing the contract. No usage voucher is issued unless the AI returns a valid review." });
    try {
      const result = await runMeteredExtraction(current.address, previous.toString(), voucherSignatureRef.current, documentText);
      if (!result.advanced || result.voucherSignature === null || result.extraction === null) throw new Error(result.reason ?? "The service did not issue a signed usage voucher.");
      const next = BigInt(result.cumulative);
      const count = taskCount + 1;
      usageAmountRef.current = next;
      voucherSignatureRef.current = result.voucherSignature;
      setUsageAmount(next);
      setVoucherSignature(result.voucherSignature);
      setTaskCount(count);
      setLastExtraction(result.extraction);
      setUpdates((items) => [...items, { sequence: count, cumulative: next, voucherSignature: result.voucherSignature! }]);
      if (openTransaction !== null) remember(connected.address, { channel: current.address, openTransaction, usageAtomic: next.toString(), voucherSignature: result.voucherSignature, updateCount: count, serviceStarted: true });
      setNotice({ tone: "success", text: `Review ${count} completed. Groq returned a result and the provider signed a cumulative voucher for ${next.toString()} atomic units. No Solana transaction was sent for this request.` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  }, [service, phase, taskCount, openTransaction]);

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
      text: "Submitting the latest cumulative voucher with one cooperative seal, then distributing the used amount and refunding the rest.",
    });

    try {
      const onChainAmount = BigInt(current.settled);
      const clientAmount = usageAmountRef.current;
      const used = clientAmount > onChainAmount ? clientAmount : onChainAmount;
      const signature = used > onChainAmount ? voucherSignatureRef.current : null;
      const result = await closeSession(current.address, used.toString(), signature);

      // The numbers below are the ones the server measured by reading balances
      // before and after the distribution — what actually moved, not what the
      // arithmetic predicts.
      setChannel((previous) =>
        previous === null ? previous : { ...previous, settled: result.settled, status: 3 },
      );
      usageAmountRef.current = BigInt(result.settled);
      setUsageAmount(BigInt(result.settled));
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
      setPhase(phase);
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }, [phase]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  // -------------------------------------------------------------------------
  // Derived display state
  // -------------------------------------------------------------------------

  const settled = usageAmount;
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
      usageAmount,
      voucherSignature,
      taskCount,
      lastExtraction,
    },
    actions: { connect, cancelConnect, disconnect, fund, open, startService, runUsage, close, dismissNotice },
  };
}
