/**
 * The Devnet chain adapter.
 *
 * Every function here is a thin, explicit wrapper around the same instructions
 * the already-proven tooling in `tools/` sends — the encoders are imported from
 * `tools/lib/protocol.mjs` rather than reimplemented, so the application and
 * the tooling cannot disagree about what a voucher is.
 *
 * NODE ONLY. This module reads private keys (through `lib/server/env.ts`) and
 * signs vouchers with them.
 *
 * CONFIRMATION IS POLLED, NOT SUBSCRIBED
 *
 * The obvious way to confirm a transaction with `@solana/kit` is
 * `sendAndConfirmTransactionFactory`, which needs an RPC *websocket*
 * subscription. That is the wrong choice here: the deployment target is a
 * serverless function, where a long-lived socket is an extra thing to fail, and
 * a dropped socket looks exactly like a slow transaction. `sendAndConfirm`
 * below sends and then polls `getSignatureStatuses` instead — one fewer moving
 * part, and it works in every Node runtime.
 */

import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairFromBytes,
  createSignerFromKeyPair,
  createSolanaRpc,
  createTransactionMessage,
  getAddressDecoder,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Base64EncodedWireTransaction,
  type Instruction,
  type InstructionWithSigners,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import {
  CHANNEL_STATUS,
  DISCRIMINATOR,
  ED25519_PRECOMPILE,
  INSTRUCTIONS_SYSVAR,
  PAYMENT_CHANNELS_PROGRAM,
  buildCreateAtaIdempotentInstruction,
  buildEd25519PrecompileData,
  buildSystemTransferInstruction,
  buildTokenTransferInstruction,
  buildVoucherPayload,
  channelSeeds,
  decodeChannel,
  encodeOpenArgs,
  encodeSettleAndSealData,
  encodeDistributeData,
  readTokenAccountAmount,
  signVoucher,
} from "../../tools/lib/protocol.mjs";

import type { ServerConfig } from "./env";
import { RequestError } from "./http";

const PROGRAM = address(PAYMENT_CHANNELS_PROGRAM);
const TOKEN_PROGRAM = TOKEN_PROGRAM_ADDRESS;
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const INSTRUCTIONS_SYSVAR_ADDRESS = address(INSTRUCTIONS_SYSVAR);

/**
 * The account metas of an instruction that carries a `signer`.
 *
 * `Instruction` alone types its accounts as `AccountMeta[]`, which has no
 * `signer` field — so a literal that supplies one is rejected as an excess
 * property. `InstructionWithSigners` is the kit's own counterpart type, and the
 * intersection of the two is the shape its documentation uses. It matters here
 * because the payee's signature on the cooperative close is collected from
 * exactly this field.
 */
type SignerAccounts = NonNullable<InstructionWithSigners["accounts"]>;

/**
 * Re-brand an instruction built by the JavaScript tooling.
 *
 * `tools/lib/protocol.mjs` is plain JavaScript shared with the devnet scripts,
 * so it cannot produce kit's `Address` — a *branded* string that only
 * `address()` mints — and its instruction objects arrive with a plain `string`
 * in `programAddress`. The values are correct; the brand is not there to be had.
 *
 * `address()` re-validates that the string really is a 32-byte base58 address
 * and then returns it unchanged, so this is free at runtime and turns an
 * unchecked string into a checked one.
 *
 * The `accounts` array is carried through **by reference on purpose**: the
 * tooling puts signer metas in it, and `signTransactionMessageWithSigners`
 * finds the signers by scanning those accounts at runtime. Copying the array
 * would still work; rebuilding it would not.
 */
function instructionFrom(built: {
  readonly programAddress: string;
  readonly accounts?: readonly unknown[];
  readonly data?: Uint8Array;
}): Instruction {
  return {
    programAddress: address(built.programAddress),
    accounts: built.accounts as Instruction["accounts"],
    data: built.data,
  };
}

/**
 * A decoded channel account, matching `decodeChannel` in `tools/lib/protocol.mjs`.
 *
 * Spelled out rather than written as `ReturnType<typeof decodeChannel>`. The
 * decoder is plain JavaScript, and TypeScript infers a JS function's return type
 * from the object literal it starts with — so the derived type would carry only
 * the four header bytes and silently lose every field assigned afterwards. That
 * is not a cosmetic loss: those are the fields the money arithmetic is made of.
 *
 * `distributionHash` is a hex string rather than bytes because that is what the
 * decoder produces; bigints stay bigints, and become strings only at the HTTP
 * boundary.
 */
export interface DecodedChannel {
  readonly discriminator: number;
  readonly version: number;
  readonly bump: number;
  readonly status: number;
  readonly salt: bigint;
  readonly deposit: bigint;
  readonly settled: bigint;
  readonly payoutWatermark: bigint;
  readonly closureStartedAt: bigint;
  readonly payerWithdrawnAt: bigint;
  readonly gracePeriod: number;
  readonly distributionHash: string;
  readonly payer: string;
  readonly payee: string;
  readonly authorizedSigner: string;
  readonly mint: string;
  readonly rentPayer: string;
  readonly openSlot: bigint;
  readonly bytesConsumed: number;
}

// ---------------------------------------------------------------------------
// RPC
// ---------------------------------------------------------------------------

/**
 * One RPC client per process, not per request. Creating a client is cheap but
 * not free, and a serverless instance handles many requests.
 */
let cachedRpc: Rpc<SolanaRpcApi> | null = null;
let cachedRpcUrl: string | null = null;

export function rpcFor(config: ServerConfig): Rpc<SolanaRpcApi> {
  if (cachedRpc === null || cachedRpcUrl !== config.rpcUrl) {
    cachedRpc = createSolanaRpc(config.rpcUrl);
    cachedRpcUrl = config.rpcUrl;
  }
  return cachedRpc;
}

async function signerFor(secretKey: Uint8Array) {
  return createSignerFromKeyPair(await createKeyPairFromBytes(secretKey));
}

/**
 * Send an already-signed, base64-encoded wire transaction and wait until the
 * cluster has confirmed it.
 *
 * The parameter is kit's branded `Base64EncodedWireTransaction` rather than a
 * plain string, which is why callers pass `getBase64EncodedWireTransaction(tx)`
 * instead of holding loose base64. The brand is doing real work: it is what
 * stops a transaction signature, a blockhash or an address from being handed to
 * `sendTransaction` by mistake.
 *
 * Polling rather than subscribing, for the reason in the file header. The
 * timeout is generous because Devnet is a shared, sometimes slow cluster, and
 * a premature "failed" would be worse than a slow "confirmed": the caller
 * cannot tell the difference between a dropped transaction and a slow one, and
 * a retry after a slow confirmation is a double spend of fees.
 */
async function sendAndConfirm(
  rpc: Rpc<SolanaRpcApi>,
  wireTransaction: Base64EncodedWireTransaction,
  { timeoutMs = 60_000, intervalMs = 1_000 } = {},
): Promise<string> {
  const signature = await rpc
    .sendTransaction(wireTransaction, { encoding: "base64", preflightCommitment: "confirmed" })
    .send();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];

    if (status !== null) {
      if (status.err !== null) {
        throw new Error(
          `The transaction ${signature} was confirmed but failed on chain: ` +
            `${JSON.stringify(status.err)}`,
        );
      }
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        return signature;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `The transaction ${signature} was submitted but had not confirmed after ${timeoutMs}ms. ` +
      "It may still land. Check the explorer before retrying, because resubmitting could " +
      "spend the same money twice.",
  );
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The raw account, or null when nothing lives at that address. */
async function fetchChannelAccount(config: ServerConfig, channelAddress: string) {
  const rpc = rpcFor(config);
  const info = await rpc.getAccountInfo(address(channelAddress), { encoding: "base64" }).send();
  if (info.value === null) return null;
  return {
    data: Buffer.from(info.value.data[0], "base64"),
    lamports: info.value.lamports,
    owner: info.value.owner,
  };
}

/**
 * Read and decode a channel.
 *
 * Returns null only when the account does not exist. A channel that exists but
 * does not decode is an error, not a null: those two cases mean very different
 * things, and collapsing them would let the interface show "not found" for a
 * channel it simply failed to understand.
 */
export async function readChannel(
  config: ServerConfig,
  channelAddress: string,
): Promise<{ channel: DecodedChannel; bytes: number } | null> {
  const account = await fetchChannelAccount(config, channelAddress);
  if (account === null) return null;

  // The assertion is required, not lazy: `decodeChannel` is JavaScript, so
  // TypeScript sees only the header literal it starts from. `DecodedChannel`
  // above is the full account and is the thing every caller is written against.
  //
  // A decode failure is a RequestError, not a 502: the caller asked about an
  // address that holds something, and the answer is that it is not a channel.
  // That is a definite answer to a reasonable question, so it should not be
  // reported as the server failing.
  try {
    const channel = decodeChannel(account.data, getAddressDecoder()) as DecodedChannel;
    return { channel, bytes: account.data.length };
  } catch (error) {
    throw new RequestError(
      `The account at ${channelAddress} is ${account.data.length} bytes and is not a payment ` +
        `channel, so it cannot be read as one. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Faucet
// ---------------------------------------------------------------------------

export interface FaucetResult {
  readonly solSignature: string;
  readonly tokenSignature: string;
  readonly solLamports: string;
  readonly tokenAmount: string;
}

/**
 * Stock a new wallet with Devnet SOL and TEST, and give it a token account.
 *
 * This exists so a judge does not have to find a faucet, wait for an airdrop,
 * create a token account, and acquire a custom mint by hand — four steps, any
 * of which can fail in front of an audience. One click instead.
 *
 * The SOL is a plain transfer from our funded Devnet payer rather than an
 * airdrop request: the public Devnet faucet is rate limited per IP, and a demo
 * where the second judge cannot get funds is a demo that does not work.
 *
 * The token account is created idempotently, so calling this twice is harmless
 * and a wallet that already has one is not an error.
 */
export async function fundWallet(
  config: ServerConfig,
  recipient: string,
): Promise<FaucetResult> {
  const rpc = rpcFor(config);
  const payer = await signerFor(config.payerSecretKey);
  const mint = address(config.mint);

  const [recipientTokenAccount] = await findAssociatedTokenPda({
    owner: address(recipient),
    tokenProgram: TOKEN_PROGRAM,
    mint,
  });
  const [payerTokenAccount] = await findAssociatedTokenPda({
    owner: payer.address,
    tokenProgram: TOKEN_PROGRAM,
    mint,
  });

  // Annotated rather than inferred: an empty array literal with no annotation is
  // `any[]` in the places TypeScript cannot narrow, which is every place it
  // matters here.
  const instructions: Instruction[] = [];

  // SOL first, in its own transaction: it is what pays for the token account's
  // rent, so it must land before anything that spends it.
  instructions.push(
    instructionFrom(
      buildSystemTransferInstruction({
        from: payer.address,
        fromSigner: payer,
        to: address(recipient),
        lamports: config.solPerWallet,
        AccountRole,
      }),
    ),
  );

  const { value: solBlockhash } = await rpc.getLatestBlockhash().send();
  const solMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(solBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const solSigned = await signTransactionMessageWithSigners(solMessage);
  const solSignature = getSignatureFromTransaction(solSigned);
  await sendAndConfirm(rpc, getBase64EncodedWireTransaction(solSigned));

  // Then the token account and the TEST, together.
  const tokenInstructions: Instruction[] = [
    instructionFrom(
      buildCreateAtaIdempotentInstruction({
        payer: payer.address,
        payerSigner: payer,
        ata: recipientTokenAccount,
        owner: address(recipient),
        mint,
        tokenProgram: TOKEN_PROGRAM,
        AccountRole,
      }),
    ),
    instructionFrom(
      buildTokenTransferInstruction({
        source: payerTokenAccount,
        destination: recipientTokenAccount,
        authority: payer.address,
        authoritySigner: payer,
        amount: config.tokensPerWallet,
        tokenProgram: TOKEN_PROGRAM,
        AccountRole,
      }),
    ),
  ];

  const { value: tokenBlockhash } = await rpc.getLatestBlockhash().send();
  const tokenMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(tokenBlockhash, m),
    (m) => appendTransactionMessageInstructions(tokenInstructions, m),
  );
  const tokenSigned = await signTransactionMessageWithSigners(tokenMessage);
  const tokenSignature = getSignatureFromTransaction(tokenSigned);
  await sendAndConfirm(rpc, getBase64EncodedWireTransaction(tokenSigned));

  return {
    solSignature,
    tokenSignature,
    solLamports: config.solPerWallet.toString(),
    tokenAmount: config.tokensPerWallet.toString(),
  };
}

/** The funder's TEST balance, so the interface can warn before the faucet runs dry. */
export async function faucetReserve(config: ServerConfig): Promise<bigint | null> {
  const rpc = rpcFor(config);
  const payer = await signerFor(config.payerSecretKey);
  const [payerTokenAccount] = await findAssociatedTokenPda({
    owner: payer.address,
    tokenProgram: TOKEN_PROGRAM,
    mint: address(config.mint),
  });
  const info = await rpc.getAccountInfo(payerTokenAccount, { encoding: "base64" }).send();
  if (info.value === null) return null;
  return readTokenAccountAmount(Buffer.from(info.value.data[0], "base64"));
}

export interface WalletBalances {
  readonly solLamports: string;
  /** Null when the wallet has no token account at all, which is not zero. */
  readonly tokens: string | null;
}

/**
 * What a wallet currently holds.
 *
 * This exists to prevent the single worst moment in a demo: a judge presses
 * "Open tab" on an empty wallet and the chain answers with
 * `custom program error: 0x1`, which says nothing useful to anyone. Knowing the
 * balance lets the interface offer the faucet as the next step instead.
 *
 * The token balance is null rather than zero when no token account exists.
 * Those are different facts — "has no TEST" and "has never held TEST" — and
 * only one of them is fixed by a transfer.
 */
export async function readWalletBalances(
  config: ServerConfig,
  owner: string,
): Promise<WalletBalances> {
  const rpc = rpcFor(config);
  const [tokenAccount] = await findAssociatedTokenPda({
    owner: address(owner),
    tokenProgram: TOKEN_PROGRAM,
    mint: address(config.mint),
  });

  const [accountInfo, tokenInfo] = await Promise.all([
    rpc.getAccountInfo(address(owner), { encoding: "base64" }).send(),
    rpc.getAccountInfo(tokenAccount, { encoding: "base64" }).send(),
  ]);

  return {
    solLamports: String(accountInfo.value?.lamports ?? 0n),
    tokens:
      tokenInfo.value === null
        ? null
        : readTokenAccountAmount(Buffer.from(tokenInfo.value.data[0], "base64")).toString(),
  };
}

// ---------------------------------------------------------------------------
// Open — built here, signed in the payer's wallet
// ---------------------------------------------------------------------------

export interface OpenTransaction {
  readonly channel: string;
  readonly openSlot: string;
  readonly salt: string;
  /** Base64 wire transaction, unsigned, with the payer's wallet as fee payer. */
  readonly transaction: string;
}

/**
 * Build the `open` transaction for a wallet to sign.
 *
 * The SERVICE builds it and the CUSTOMER signs it, which is the correct split:
 * the customer must approve the deposit with their own key, but there is no
 * reason to make every browser rebuild the channel's PDA derivation, the
 * recipient plan encoding and the token-account metas. Building it once, on the
 * server, means exactly one implementation of those rules exists, and it is the
 * one under test.
 *
 * The transaction is returned UNSIGNED. It carries the payer as fee payer and
 * as the holder of both required signatures, so the wallet sees precisely what
 * it is being asked to approve: a deposit of the ceiling into an escrow account
 * whose address is derived from the payer's own key.
 *
 * `salt` is the current time in milliseconds. Together with the open slot — the
 * other unique seed — it makes opening the same tab twice land on two distinct
 * channel accounts rather than colliding with the first.
 */
export async function buildOpenTransaction(
  config: ServerConfig,
  payerAddress: string,
  requestedCeiling: bigint = config.ceilingAtomic,
): Promise<OpenTransaction> {
  if (requestedCeiling <= 0n || requestedCeiling > config.ceilingAtomic) throw new Error(`The requested cap must be above zero and no greater than the service maximum of ${config.ceilingAtomic} atomic units.`);
  const rpc = rpcFor(config);
  const addressEncoder = getAddressEncoder();
  const payer = address(payerAddress);
  const mint = address(config.mint);
  const payee = address(config.payeeAddress);

  const currentSlot = await rpc.getSlot().send();
  const openSlot = BigInt(currentSlot);
  const salt = BigInt(Date.now());

  const [channel] = await getProgramDerivedAddress({
    programAddress: PROGRAM,
    seeds: channelSeeds(addressEncoder, {
      payer,
      payee,
      mint,
      authorizedSigner: payee,
      salt,
      openSlot,
    }),
  });

  const [payerTokenAccount] = await findAssociatedTokenPda({
    owner: payer,
    tokenProgram: TOKEN_PROGRAM,
    mint,
  });
  const [channelTokenAccount] = await findAssociatedTokenPda({
    owner: channel,
    tokenProgram: TOKEN_PROGRAM,
    mint,
  });
  const [eventAuthority] = await getProgramDerivedAddress({
    programAddress: PROGRAM,
    seeds: ["event_authority"],
  });

  const instruction = {
    programAddress: PROGRAM,
    accounts: [
      // Raw instruction accounts take plain addresses, never signer objects:
      // the message codec stringifies anything else, which is how an earlier
      // attempt produced the memorable "[object Object]" base58 error.
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: payer, role: AccountRole.WRITABLE_SIGNER }, // rentPayer, same key
      { address: payee, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: payee, role: AccountRole.READONLY }, // authorizedSigner
      { address: channel, role: AccountRole.WRITABLE },
      { address: payerTokenAccount, role: AccountRole.WRITABLE },
      { address: channelTokenAccount, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: address("SysvarRent111111111111111111111111111111111"), role: AccountRole.READONLY },
      { address: address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"), role: AccountRole.READONLY },
      { address: eventAuthority, role: AccountRole.READONLY },
      { address: PROGRAM, role: AccountRole.READONLY }, // selfProgram
    ],
    data: encodeOpenArgs({
      addressEncoder,
      salt,
      deposit: requestedCeiling,
      gracePeriod: config.gracePeriodSeconds,
      openSlot,
      recipients: [],
    }),
  };

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    // Use a legacy transaction for the browser-facing open flow. There are no
    // address lookup tables in this one-instruction transaction, and some
    // injected wallets' legacy request API only accepts legacy serialized
    // messages. In particular, handing a v0 message to that API can surface an
    // opaque "Expected String" error even though the wallet is connected.
    createTransactionMessage({ version: "legacy" }),
    // The Address form, not the Signer form: the whole point is that no signer
    // exists on this side of the request.
    (m) => setTransactionMessageFeePayer(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([instruction], m),
  );

  const compiled = compileTransaction(message);

  return {
    channel,
    openSlot: openSlot.toString(),
    salt: salt.toString(),
    transaction: Buffer.from(getTransactionEncoder().encode(compiled)).toString("base64"),
  };
}

// ---------------------------------------------------------------------------
// Usage — the meter
// ---------------------------------------------------------------------------

export interface UsageResult { readonly advanced:boolean; readonly cumulative:string; readonly voucherSignature:string|null; readonly reason:string|null; }

/** Issue a cumulative usage voucher off-chain. No Solana transaction is sent here. */
export async function commitUsage(config:ServerConfig,channelAddress:string,previousCumulative:string,previousVoucherSignature:string|null):Promise<UsageResult>{
 const current=await readChannel(config,channelAddress);if(current===null)throw new Error(`No channel at ${channelAddress}. It may already have been closed.`);
 const {channel}=current;if(channel.status!==0)return{advanced:false,cumulative:channel.settled.toString(),voucherSignature:null,reason:`The channel is ${CHANNEL_STATUS[channel.status]??"in an unknown state"}; usage can only be metered while it is Open.`};
 let previous:bigint;try{previous=BigInt(previousCumulative);}catch{throw new Error("The previous cumulative amount must be an integer atomic-unit value.");}
 if(previous<channel.settled||previous>channel.deposit)throw new Error("The previous usage amount is outside this channel's verified range.");
 const enc=getAddressEncoder(),id=address(channelAddress),seed=config.operatorSecretKey.subarray(0,32);
 if(previous>channel.settled){if(previousVoucherSignature===null||!/^[0-9a-f]{128}$/i.test(previousVoucherSignature))throw new Error("The previous off-chain voucher is missing or malformed.");const oldPayload=buildVoucherPayload(enc,id,previous,0n),oldSigned=await signVoucher(seed,oldPayload);if(getAddressDecoder().decode(oldSigned.publicKey)!==channel.authorizedSigner||Buffer.from(oldSigned.signature).toString("hex")!==previousVoucherSignature.toLowerCase())throw new Error("The previous voucher signature does not match its amount.");}
 const next=previous+config.rateAtomicPerRequest;if(next>channel.deposit)throw new Error("This request would exceed the authorized cap. Close and settle before running more requests.");
 const payload=buildVoucherPayload(enc,id,next,0n),signed=await signVoucher(seed,payload);if(getAddressDecoder().decode(signed.publicKey)!==channel.authorizedSigner)throw new Error("The configured provider key is not this channel's authorized signer.");
 return{advanced:true,cumulative:next.toString(),voucherSignature:Buffer.from(signed.signature).toString("hex"),reason:null};
}

// ---------------------------------------------------------------------------
// Close — seal, then pay out
// ---------------------------------------------------------------------------

export interface CloseResult {
  readonly sealSignature: string;
  readonly distributeSignature: string;
  readonly deposit: string;
  readonly settled: string;
  readonly returnedToPayer: string;
  readonly paidToProvider: string;
  readonly channelAccountClosed: boolean;
}

/**
 * Close the tab and pay everyone out.
 *
 * Two instructions, and they are separate for a reason:
 *
 *   1. `settleAndSeal` locks the watermark at whatever the meter last recorded.
 *      It requires the PAYEE's signature — this is a cooperative close, not a
 *      permissionless one — which is why the provider key lives on the server.
 *      The customer does not sign here, and does not need to: their protection
 *      is structural rather than a second signature. A voucher can never exceed
 *      the deposit (error 235), and everything unbilled returns to them
 *      automatically in step 2.
 *
 *   2. `distribute` moves the money and is permissionless. The provider is paid
 *      the metered amount, the customer is refunded the unused remainder, and
 *      rounding dust goes to the treasury.
 *
 * The customer is refunded to their own token account without any action on
 * their part, which is the property that makes a payment channel better than a
 * prepaid balance: closing late, or not at all, does not cost them the
 * remainder.
 */
export async function closeChannel(
  config: ServerConfig,
  channelAddress: string,
  requestedCumulative: string,
  requestedVoucherSignature: string | null,
): Promise<CloseResult> {
  const rpc = rpcFor(config);
  const addressEncoder = getAddressEncoder();
  const channelId = address(channelAddress);

  const current = await readChannel(config, channelAddress);
  if (current === null) {
    throw new Error(
      `No channel at ${channelAddress}. It has already been distributed and reaped.`,
    );
  }
  const { channel } = current;

  if (channel.status !== 0) {
    throw new Error(
      `This tab is already ${CHANNEL_STATUS[channel.status] ?? "in an unknown state"}. ` +
        "Only an Open channel can be closed from here.",
    );
  }

  const payee = await signerFor(config.operatorSecretKey);
  const payer = await signerFor(config.payerSecretKey);
  const mint = address(config.mint);

  let finalCumulative:bigint;try{finalCumulative=BigInt(requestedCumulative);}catch{throw new Error("The final cumulative amount must be an integer atomic-unit value.");}
  if(finalCumulative<channel.settled||finalCumulative>channel.deposit)throw new Error("The final voucher is outside the on-chain watermark and authorized cap.");
  const sealInstructions:(Instruction & InstructionWithSigners)[]=[];let hasVoucher=false;
  if(finalCumulative>channel.settled){if(requestedVoucherSignature===null||!/^[0-9a-f]{128}$/i.test(requestedVoucherSignature))throw new Error("The latest usage voucher is missing or malformed.");const payload=buildVoucherPayload(getAddressEncoder(),channelId,finalCumulative,0n);const sig=await signVoucher(config.operatorSecretKey.subarray(0,32),payload);if(getAddressDecoder().decode(sig.publicKey)!==channel.authorizedSigner||Buffer.from(sig.signature).toString("hex")!==requestedVoucherSignature.toLowerCase())throw new Error("The latest voucher signature does not match the final amount.");sealInstructions.push({programAddress:address(ED25519_PRECOMPILE),accounts:[],data:buildEd25519PrecompileData(sig.publicKey,sig.signature,payload)});hasVoucher=true;}

  // The accounts are built into a typed variable rather than written inline.
  // Writing them inline makes them a *fresh* object literal, and a fresh literal
  // supplying `signer` is rejected as an excess property against the account
  // meta's declared shape; assigning the same values to a typed variable first
  // is what expresses "this meta carries a signer" without a cast.
  const sealAccounts: SignerAccounts = [
    // The payee is the authority: this is the cooperative close. `signer` is
    // what lets the kit sign with it.
    { address: payee.address, role: AccountRole.READONLY_SIGNER, signer: payee },
    { address: channelId, role: AccountRole.WRITABLE },
    { address: INSTRUCTIONS_SYSVAR_ADDRESS, role: AccountRole.READONLY },
  ];

  sealInstructions.push({
    programAddress: PROGRAM,
    accounts: sealAccounts,
    // The voucher precompile immediately precedes this instruction when present.
    data: encodeSettleAndSealData(hasVoucher),
  });

  const { value: sealBlockhash } = await rpc.getLatestBlockhash().send();
  const sealMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(sealBlockhash, m),
    (m) => appendTransactionMessageInstructions(sealInstructions, m),
  );
  const sealSigned = await signTransactionMessageWithSigners(sealMessage);
  const sealSignature = getSignatureFromTransaction(sealSigned);
  await sendAndConfirm(rpc, getBase64EncodedWireTransaction(sealSigned));

  const sealed = await readChannel(config, channelAddress);
  if (sealed === null || sealed.channel.status !== 1) {
    throw new Error(
      "The seal transaction confirmed but the channel is not Sealed. Refusing to distribute " +
        "against a state we could not read back.",
    );
  }
  if (sealed.channel.settled !== finalCumulative) {
    throw new Error(
      `Expected the watermark to be ${finalCumulative}, chain says ${sealed.channel.settled}.`,
    );
  }

  // -------------------------------------------------------------------------
  // Distribute
  // -------------------------------------------------------------------------

  const [channelTokenAccount] = await findAssociatedTokenPda({
    owner: channelId,
    tokenProgram: TOKEN_PROGRAM,
    mint,
  });
  const [payerTokenAccount] = await findAssociatedTokenPda({
    owner: address(channel.payer),
    tokenProgram: TOKEN_PROGRAM,
    mint,
  });
  const [payeeTokenAccount] = await findAssociatedTokenPda({
    owner: address(channel.payee),
    tokenProgram: TOKEN_PROGRAM,
    mint,
  });
  const [treasuryTokenAccount] = await findAssociatedTokenPda({
    owner: address(config.treasuryOwner),
    tokenProgram: TOKEN_PROGRAM,
    mint,
  });
  const [eventAuthority] = await getProgramDerivedAddress({
    programAddress: PROGRAM,
    seeds: ["event_authority"],
  });

  // Read the starting balances, so the payout can be reported as what actually
  // moved rather than as what the arithmetic says should have.
  const balanceOf = async (account: Address): Promise<bigint> => {
    const info = await rpc.getAccountInfo(account, { encoding: "base64" }).send();
    if (info.value === null) return 0n;
    return readTokenAccountAmount(Buffer.from(info.value.data[0], "base64"));
  };
  const beforePayee = await balanceOf(payeeTokenAccount);
  const beforePayer = await balanceOf(payerTokenAccount);

  // This channel was opened with no recipients, so the plan reveal is the
  // 4-byte count prefix alone. Its SHA-256 is the commitment the channel has
  // carried since `open`; `distribute` verifies it, so a mismatch here would be
  // rejected on chain — cheaper to notice now.
  const distributeData = encodeDistributeData(addressEncoder, []);

  const distributeInstruction = {
    programAddress: PROGRAM,
    accounts: [
      { address: channelId, role: AccountRole.WRITABLE },
      { address: address(channel.payer), role: AccountRole.WRITABLE },
      { address: address(channel.rentPayer), role: AccountRole.WRITABLE },
      { address: channelTokenAccount, role: AccountRole.WRITABLE },
      { address: payerTokenAccount, role: AccountRole.WRITABLE },
      { address: payeeTokenAccount, role: AccountRole.WRITABLE },
      { address: treasuryTokenAccount, role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      { address: eventAuthority, role: AccountRole.READONLY },
      { address: PROGRAM, role: AccountRole.READONLY },
    ],
    data: distributeData,
  };

  /**
   * `distribute` validates the payee's and the treasury's token accounts before
   * it will move anything, and on a first run neither exists — a missing
   * treasury account is error 2402, which is exactly what an earlier attempt
   * hit. Anyone may create `ATA(owner, mint, tokenProgram)` and the account is
   * owned by that owner, so creating them gifts the provider and the treasury
   * somewhere to receive their tokens and costs only rent. Idempotent, so a
   * retry is harmless.
   */
  const createInstructions: Instruction[] = [];
  if (beforePayee === 0n) {
    const info = await rpc.getAccountInfo(payeeTokenAccount, { encoding: "base64" }).send();
    if (info.value === null) {
      createInstructions.push(
        instructionFrom(
          buildCreateAtaIdempotentInstruction({
            payer: payer.address,
            payerSigner: payer,
            ata: payeeTokenAccount,
            owner: address(channel.payee),
            mint,
            tokenProgram: TOKEN_PROGRAM,
            AccountRole,
          }),
        ),
      );
    }
  }
  const treasuryInfo = await rpc.getAccountInfo(treasuryTokenAccount, { encoding: "base64" }).send();
  if (treasuryInfo.value === null) {
    createInstructions.push(
      instructionFrom(
        buildCreateAtaIdempotentInstruction({
          payer: payer.address,
          payerSigner: payer,
          ata: treasuryTokenAccount,
          owner: address(config.treasuryOwner),
          mint,
          tokenProgram: TOKEN_PROGRAM,
          AccountRole,
        }),
      ),
    );
  }

  const { value: distributeBlockhash } = await rpc.getLatestBlockhash().send();
  const distributeMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(distributeBlockhash, m),
    (m) => appendTransactionMessageInstructions([...createInstructions, distributeInstruction], m),
  );
  const distributeSigned = await signTransactionMessageWithSigners(distributeMessage);
  const distributeSignature = getSignatureFromTransaction(distributeSigned);
  await sendAndConfirm(rpc, getBase64EncodedWireTransaction(distributeSigned));

  const afterPayee = await balanceOf(payeeTokenAccount);
  const afterPayer = await balanceOf(payerTokenAccount);
  const channelAfter = await fetchChannelAccount(config, channelAddress);

  return {
    sealSignature,
    distributeSignature,
    deposit: channel.deposit.toString(),
    settled: finalCumulative.toString(),
    // Read from the balances, not from the arithmetic: these are the numbers
    // the interface is allowed to show, and they are what actually moved.
    paidToProvider: (afterPayee - beforePayee).toString(),
    returnedToPayer: (afterPayer - beforePayer).toString(),
    channelAccountClosed: channelAfter === null,
  };
}
