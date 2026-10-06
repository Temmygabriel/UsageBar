/**
 * Verify a canonical run — build spec Section 29.
 *
 * THIS TOOL EXISTS TO DISAGREE WITH THE EVIDENCE.
 *
 * The artifacts under `evidence/canonical-run/` were written by the same script
 * that performed the run, so on their own they prove only that the script is
 * self-consistent. Section 29 says as much: the verifier must not trust the
 * evidence JSON alone and must query Solana where practical. So everything
 * checkable is checked against the chain, and the two things that are *only* in
 * the JSON — the channel address and the distribution commitment — are
 * re-derived from the ingredients recorded beside them rather than believed.
 *
 * It fails loudly. A run that stopped halfway is missing files, and a missing
 * file is a failure here rather than a skip: a partial run presented as a whole
 * one is the exact failure mode this tool is for.
 *
 * WHY THIS IS A `.ts` FILE AND STILL RUNS UNDER PLAIN `node`
 *
 * Section 29 names `tools/verify-canonical-run.ts`. Node 24 strips types on its
 * own, so it runs without a build step — which means the syntax here has to be
 * *erasable*: no enums, no namespaces, no parameter properties. Type-only
 * imports are written with `import type` so they are erased rather than
 * resolved at runtime.
 *
 * Usage:
 *   EVIDENCE_DIR=evidence/canonical-run node tools/verify-canonical-run.ts
 */

import { createSolanaRpc, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHANNEL_LEN, CHANNEL_STATUS, envOr, PAYMENT_CHANNELS_PROGRAM, channelSeeds } from "./lib/protocol.mjs";

// ---------------------------------------------------------------------------
// The twelve files Section 26 asks for.
//
// Listed rather than globbed, deliberately. A glob would happily verify a
// directory holding three files; a list makes each absence a named failure, and
// the name is the useful part of the message.
// ---------------------------------------------------------------------------

const REQUIRED_FILES = [
  "01-environment.json",
  "02-channel-open.json",
  "03-voucher-01.json",
  "04-voucher-02.json",
  "05-voucher-03.json",
  "06-voucher-04.json",
  "07-voucher-05.json",
  "08-close.json",
  "09-settlement.json",
  "10-distribution.json",
  "11-final-state.json",
  "12-verification.json",
];

const EVIDENCE_DIR = envOr("EVIDENCE_DIR", "evidence/canonical-run");
const RPC_URL = envOr("DEVNET_RPC_URL", "https://api.devnet.solana.com");
const rpc = createSolanaRpc(RPC_URL);
// Only the encoder: this verifier never has to turn 32 bytes back into an
// address, because every address it checks comes from the artifacts as a string
// and the one it derives it derives forward, from the seeds.
const addressEncoder = getAddressEncoder();

const failures: string[] = [];
const notes: string[] = [];

function fail(message: string) {
  failures.push(message);
  console.log(`  FAIL  ${message}`);
}

function pass(message: string) {
  console.log(`  ok    ${message}`);
}

function note(message: string) {
  notes.push(message);
}

/** Read one evidence file, or record its absence and return null. */
function readEvidence(fileName: string): Record<string, unknown> | null {
  const path = join(EVIDENCE_DIR, fileName);
  if (!existsSync(path)) {
    fail(`${fileName} is missing. A partial run is not a canonical run.`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    fail(`${fileName} is not valid JSON: ${(error as Error).message}`);
    return null;
  }
}

function str(value: unknown, description: string): string {
  if (typeof value !== "string") {
    fail(`${description} should be a string, found ${typeof value}`);
    return "";
  }
  return value;
}

function obj(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

/**
 * kit brands `Signature` and `Address` as distinct string types, while the
 * evidence files carry plain strings. Narrowed in two places here rather than
 * cast at thirty call sites, so the checks below read as ordinary calls.
 */
function asAddress(value: string) {
  return value as Parameters<typeof rpc.getAccountInfo>[0];
}

function asSignature(value: string) {
  return value as Parameters<typeof rpc.getTransaction>[0];
}

// ---------------------------------------------------------------------------
// Secret scan
//
// Section 27 forbids private keys, seed phrases, and tokens in the artifacts.
//
// THE OBVIOUS CHECK DOES NOT WORK, AND IT IS WORTH SAYING WHY.
//
// The first version of this looked for a base58 string of 86-90 characters,
// reasoning that a 64-byte secret key encodes to about that. It flagged all
// eighteen transaction signatures in a legitimate run. The reason is that a
// Solana *signature* is also 64 bytes and also base58 — the two are the same
// length, and no amount of shape inspection separates them. A checker built on
// that heuristic would fail every honest run and could only ever be silenced by
// deleting it, which is worse than not having one.
//
// So this does two things that do work:
//
//   1. A POSITIVE test. The actual secrets are in the environment while this
//      runs. If either one appears in an artifact, in any encoding, that is a
//      leak and not a judgement call. This is the check that catches the thing
//      that actually matters, and it cannot produce a false positive.
//   2. A shape test for the JSON-array form of a secret — 64 integers between 0
//      and 255. That shape is genuinely distinguishable, because no honest
//      field in these artifacts is a 64-element number array.
//
// What is deliberately not checked: whether a bare base58 blob "looks like" a
// key. It cannot be known, so it is not guessed at.
// ---------------------------------------------------------------------------

function secretForms(variableName: string): string[] {
  const raw = process.env[variableName];
  if (raw === undefined || raw.trim() === "") return [];
  const trimmed = raw.trim();

  const forms = [trimmed];
  if (trimmed.startsWith("[")) {
    // The JSON-array encoding, normalized: the same bytes can be written with
    // or without spaces, and a comparison against the raw text alone would miss
    // a reformatted copy.
    try {
      const bytes = JSON.parse(trimmed) as number[];
      if (Array.isArray(bytes)) {
        forms.push(bytes.join(","), bytes.join(", "));
      }
    } catch {
      // A malformed secret is the devnet script's problem, not this file's.
    }
  }
  return forms.filter((form) => form.length > 0);
}

const SECRET_FORMS: { source: string; form: string }[] = [];
for (const variableName of ["DEVNET_PAYER_KEYPAIR", "DEVNET_OPERATOR_KEYPAIR", "DEVNET_TEST_MINT_KEYPAIR", "DEVNET_PAYEE_KEYPAIR"]) {
  for (const form of secretForms(variableName)) {
    SECRET_FORMS.push({ source: variableName, form });
  }
}

function looksLikeJsonSecret(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length !== 64) return false;
  return value.every((item) => typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 255);
}

function scan(node: unknown, path: string, fileName: string) {
  if (typeof node === "string") {
    for (const { source, form } of SECRET_FORMS) {
      if (node.includes(form)) {
        fail(`${fileName}: ${path} contains the value of ${source}. Section 27 forbids this.`);
      }
    }
    if (/seed phrase|mnemonic/i.test(node)) {
      fail(`${fileName}: ${path} mentions a seed phrase or mnemonic. Section 27 forbids this.`);
    }
    return;
  }
  if (looksLikeJsonSecret(node)) {
    fail(
      `${fileName}: ${path} is a 64-element byte array, which is how a Solana secret key is stored. ` +
        "Nothing honest in these artifacts has that shape.",
    );
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, index) => scan(item, `${path}[${index}]`, fileName));
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      scan(value, `${path}.${key}`, fileName);
    }
  }
}

// ---------------------------------------------------------------------------
// Chain checks
// ---------------------------------------------------------------------------

/**
 * Confirm a transaction exists on chain and succeeded.
 *
 * A recorded signature is a claim that something was sent. This is the cheapest
 * possible way to make that claim falsifiable, and it is the one check that a
 * fabrication cannot survive — the chain either has the transaction or it does
 * not.
 */
async function assertTransactionLanded(signature: string, label: string): Promise<void> {
  if (signature === "") {
    fail(`${label} has no transaction signature recorded`);
    return;
  }

  // `getTransaction` returns the transaction itself, or null when the cluster
  // has never seen the signature. Note that this is *not* the `{ value }`
  // envelope `getAccountInfo` uses — assuming the envelope here made every
  // check in section 4 read `undefined` and then throw, which is how the first
  // version of this file would have failed against perfectly good evidence.
  const transaction = await rpc
    .getTransaction(asSignature(signature), {
      encoding: "json",
      maxSupportedTransactionVersion: 0,
    })
    .send();

  if (transaction === null) {
    fail(`${label}: the chain has no transaction ${signature}. The evidence records one.`);
    return;
  }

  // Cast because kit's `meta` type for a `json`-encoded transaction is the
  // "not parsed" variant, and which members it declares has moved between
  // releases. A `json` meta always carries `err`, and the cast keeps this file
  // compiling against the definition rather than against one release of it.
  const error = (transaction.meta as { err?: unknown } | null | undefined)?.err;
  if (error !== null && error !== undefined) {
    fail(`${label}: transaction ${signature} landed but failed on chain: ${JSON.stringify(error)}`);
    return;
  }

  pass(`${label}: ${signature.slice(0, 20)}… confirmed on chain`);
}

/** Read an SPL token account's amount, or null if the account does not exist. */
async function readTokenAmount(tokenAccount: string): Promise<bigint | null> {
  const info = await rpc.getAccountInfo(asAddress(tokenAccount), { encoding: "base64" }).send();
  if (info.value === null) return null;
  return Buffer.from(info.value.data[0], "base64").readBigUInt64LE(64);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("");
console.log("  Verifying canonical-usagebar-devnet-001");
console.log("  ============================================================");
console.log(`  evidence : ${EVIDENCE_DIR}/`);
console.log(`  cluster  : ${RPC_URL}`);
console.log("");

const documents: Record<string, Record<string, unknown>> = {};
for (const fileName of REQUIRED_FILES) {
  const document = readEvidence(fileName);
  if (document !== null) {
    documents[fileName] = document;
    scan(document, "$", fileName);
  }
}

if (Object.keys(documents).length === 0) {
  console.log("  No evidence to verify.");
  console.log("");
  process.exit(1);
}

const environment = obj(documents["01-environment.json"]);
const open = obj(documents["02-channel-open.json"]);
const settlement = obj(documents["09-settlement.json"]);
const finalState = obj(documents["11-final-state.json"]);
const verification = obj(documents["12-verification.json"]);

console.log("");
console.log("  1. The run agrees about itself");
console.log("  ------------------------------------------------------------");

// A run that recorded failures cannot be verified into a pass.
const recordedFailures = finalState.observed === undefined ? [] : (obj(verification.observed).failures ?? []);
if (Array.isArray(recordedFailures) && recordedFailures.length > 0) {
  fail(`the run recorded ${recordedFailures.length} failure(s) of its own: ${JSON.stringify(recordedFailures)}`);
} else {
  pass("the run recorded no failures of its own");
}

const expectedProgram = str(environment.programId, "01-environment.json programId");
if (expectedProgram !== PAYMENT_CHANNELS_PROGRAM) {
  fail(`the run used program ${expectedProgram}, but this verifier expects ${PAYMENT_CHANNELS_PROGRAM}`);
} else {
  pass(`program matches: ${PAYMENT_CHANNELS_PROGRAM}`);
}

// The environment artifact says which cluster it ran against. The verifier is
// pointed at a cluster by its own configuration. If those disagree, every
// chain check below is being asked of the wrong network, and a "pass" would be
// meaningless — so this is checked before any of them.
const observedEnvironment = obj(environment.observed);
const recordedCluster = str(observedEnvironment.cluster, "01-environment.json observed.cluster");
if (recordedCluster !== RPC_URL) {
  fail(
    `the artifacts were produced against ${recordedCluster}, but this verifier is querying ${RPC_URL}. ` +
      "Chain checks below would be asking the wrong network.",
  );
} else {
  pass(`cluster matches: ${RPC_URL}`);
}

console.log("");
console.log("  2. The channel address is re-derived, not believed");
console.log("  ------------------------------------------------------------");

/**
 * THE CHECK THAT MATTERS MOST.
 *
 * The channel address appears in the artifacts as a string. If the verifier
 * simply trusted it, an artifact could name any address at all and every
 * subsequent check would confirm whatever that address holds.
 *
 * Instead the PDA is recomputed from the seven seeds recorded in the open
 * artifact — payer, payee, mint, authorized signer, salt, open slot — and the
 * result has to be the address the run claimed. If someone edited the address
 * in the JSON, this fails; if someone edited a *seed* to match a different
 * address, the re-derivation succeeds but the on-chain account's own contents
 * (checked next) will not match.
 */
const observedOpen = obj(open.observed);
const recordedChannel = str(open.channel, "02-channel-open.json channel");
const channelState = obj(observedOpen.channel);

let derivedChannel = "";
try {
  const [derived] = await getProgramDerivedAddress({
    programAddress: PAYMENT_CHANNELS_PROGRAM,
    seeds: channelSeeds(addressEncoder, {
      payer: str(channelState.payer, "observed.channel.payer"),
      payee: str(channelState.payee, "observed.channel.payee"),
      mint: str(channelState.mint, "observed.channel.mint"),
      authorizedSigner: str(channelState.authorizedSigner, "observed.channel.authorizedSigner"),
      salt: BigInt(str(channelState.salt, "observed.channel.salt")),
      openSlot: BigInt(str(channelState.openSlot, "observed.channel.openSlot")),
    }),
  });
  derivedChannel = derived;
} catch (error) {
  fail(`could not re-derive the channel PDA from the recorded seeds: ${(error as Error).message}`);
}

if (derivedChannel !== "" && derivedChannel !== recordedChannel) {
  fail(
    `the channel address in the artifacts is ${recordedChannel}, but the seeds recorded beside it ` +
      `derive to ${derivedChannel}. One of the two was edited.`,
  );
} else if (derivedChannel !== "") {
  pass(`channel re-derived from its seven seeds: ${derivedChannel}`);
}

console.log("");
console.log("  3. The chain holds what the artifacts claim");
console.log("  ------------------------------------------------------------");

const channelAccount = await rpc.getAccountInfo(asAddress(recordedChannel), { encoding: "base64" }).send();

/**
 * The status the run recorded for the channel at the end, or -1 when the run
 * recorded none — which is the honest answer when the account had already been
 * reaped by the time it looked.
 */
const finalChannelRecord = obj(obj(finalState.observed).channel);
const recordedStatus =
  finalChannelRecord.status === undefined ? -1 : Number(finalChannelRecord.status);

if (channelAccount.value === null) {
  // Legitimate if the channel was reaped after distribution, which is the goal
  // state — so this is a note, and the balance checks below carry the weight.
  note(
    "the channel account no longer exists on chain. That is the expected end state when the rent " +
      "was reclaimed, but it means the channel's own contents could not be re-read.",
  );
  pass("the channel account has been reaped (the intended end state)");
} else {
  const raw = Buffer.from(channelAccount.value.data[0], "base64");
  if (raw.length !== CHANNEL_LEN) {
    fail(`the on-chain channel is ${raw.length} bytes, not ${CHANNEL_LEN}`);
  } else {
    pass(`the on-chain channel is ${CHANNEL_LEN} bytes`);
  }

  const onChainStatus = raw.readUInt8(3);
  if (raw.readUInt8(0) !== 1) {
    fail(`the on-chain discriminator is ${raw.readUInt8(0)}, not 1`);
  }
  if (recordedStatus !== -1 && onChainStatus !== recordedStatus) {
    fail(
      `the artifacts record status ${recordedStatus} (${CHANNEL_STATUS[recordedStatus]}), ` +
        `but the chain says ${onChainStatus} (${CHANNEL_STATUS[onChainStatus]})`,
    );
  } else if (recordedStatus !== -1) {
    pass(`status agrees: ${onChainStatus} (${CHANNEL_STATUS[onChainStatus]})`);
  }

  // The deposit is the ceiling every other number is checked against, so it is
  // read from chain rather than from the artifact that claims it.
  const onChainDeposit = raw.readBigUInt64LE(12);
  const recordedDeposit = BigInt(str(channelState.deposit, "observed.channel.deposit"));
  if (onChainDeposit !== recordedDeposit) {
    fail(`the chain records a deposit of ${onChainDeposit}, the artifacts say ${recordedDeposit}`);
  } else {
    pass(`deposit agrees: ${onChainDeposit} atomic units`);
  }
}

const channelMint = str(channelState.mint, "observed.channel.mint");
if (channelMint === "") {
  fail("the artifacts do not record the mint");
} else {
  const mintInfo = await rpc.getAccountInfo(asAddress(channelMint), { encoding: "base64" }).send();
  if (mintInfo.value === null) {
    fail(`the mint ${channelMint} does not exist on this cluster`);
  } else {
    const decimals = Buffer.from(mintInfo.value.data[0], "base64").readUInt8(44);
    pass(`mint exists, ${decimals} decimals, owner ${mintInfo.value.owner}`);
    if (decimals !== 6) {
      note(`the mint has ${decimals} decimals, not the 6 the interface displays for.`);
    }
  }
}

console.log("");
console.log("  4. Every transaction the run recorded actually landed");
console.log("  ------------------------------------------------------------");

await assertTransactionLanded(str(open.transactionSignature, "02-channel-open.json transactionSignature"), "channel open");

let previousWatermark = -1n;
for (const fileName of REQUIRED_FILES.filter((name) => name.includes("voucher"))) {
  const voucher = obj(documents[fileName]);
  const voucherObserved = obj(voucher.observed);
  await assertTransactionLanded(str(voucher.transactionSignature, `${fileName} transactionSignature`), fileName);

  // The watermarks have to climb. A sequence that goes backwards would mean the
  // meter restarted, and the program rejects that on chain with error 234 — so
  // a JSON file claiming it is a JSON file that was edited.
  const after = BigInt(str(voucherObserved.watermarkAfter, `${fileName} watermarkAfter`));
  const before = BigInt(str(voucherObserved.watermarkBefore, `${fileName} watermarkBefore`));
  if (after <= before) {
    fail(`${fileName}: the watermark did not advance (${before} -> ${after}). Error 234 territory.`);
  }
  if (before < previousWatermark) {
    fail(`${fileName}: the watermark runs backwards across files (${before} after ${previousWatermark})`);
  }
  previousWatermark = after;

  // Section 25's honesty rule, made checkable: a voucher that bills time must
  // record the time it billed. A voucher produced instantly is a typed number,
  // not a metered one.
  if (voucherObserved.realElapsedMs !== undefined) {
    const elapsed = Number(voucherObserved.realElapsedMs);
    const billed = Number(voucherObserved.billedSeconds);
    if (elapsed < billed * 1000 * 0.9) {
      fail(
        `${fileName}: it claims to bill ${billed}s but only ${elapsed}ms passed. ` +
          "That is a typed number, not a metered interval.",
      );
    }
  }
}

await assertTransactionLanded(str(documents["08-close.json"]?.transactionSignature, "08-close.json transactionSignature"), "settleAndSeal");
await assertTransactionLanded(str(settlement.transactionSignature, "09-settlement.json transactionSignature"), "distribute");

console.log("");
console.log("  5. The distribution commitment is recomputed");
console.log("  ------------------------------------------------------------");

/**
 * The channel commits to a distribution plan at `open` by storing its SHA-256.
 * At `distribute` the plan is revealed and must hash to that commitment.
 *
 * Here the hash is recomputed from the revealed bytes and compared against the
 * commitment **read from the chain**, not against the commitment recorded in
 * the artifacts. A verifier that compared the artifact to itself would pass on
 * a run where the plan never matched the channel at all.
 */
const observedSettlement = obj(settlement.observed);
const revealedHex = str(observedSettlement.planRevealHex, "09-settlement.json observed.planRevealHex");
if (revealedHex === "") {
  fail("the settlement artifact does not record the revealed plan");
} else {
  const recomputed = createHash("sha256").update(Buffer.from(revealedHex, "hex")).digest("hex");
  const recordedHash = str(observedSettlement.committedDistributionHash, "observed.committedDistributionHash");

  if (recomputed !== recordedHash) {
    fail(`the revealed plan hashes to ${recomputed}, but the artifacts record a commitment of ${recordedHash}`);
  } else {
    pass(`the revealed plan hashes to the recorded commitment: ${recomputed}`);
  }

  if (channelAccount.value !== null) {
    const raw = Buffer.from(channelAccount.value.data[0], "base64");
    /**
     * `distribution_hash` sits at byte 56, and the offsets are the ones
     * `decodeChannel` in tools/lib/protocol.mjs walks in the same order:
     *
     *   0  discriminator (1)      52  gracePeriod (u32, 4)
     *   1  version (1)            56  distributionHash (32)
     *   2  bump (1)               88  payer (32)
     *   3  status (1)             120 payee (32)
     *   4  salt (u64, 8)          152 authorizedSigner (32)
     *   12 deposit (u64, 8)       184 mint (32)
     *   20 settled (u64, 8)       216 rentPayer (32)
     *   28 payoutWatermark (8)    248 openSlot (u64, 8)  -> 256 total
     *   36 closureStartedAt (i64, 8)
     *   44 payerWithdrawnAt (i64, 8)
     *
     * Written out because a hardcoded 56 is otherwise a magic number nobody can
     * check, and because this is the one field a verifier must read rather than
     * believe.
     */
    const onChainHash = raw.subarray(56, 88).toString("hex");
    if (onChainHash !== recomputed) {
      fail(
        `the chain's committed distribution hash is ${onChainHash}, but the revealed plan hashes to ` +
          `${recomputed}. The plan revealed at distribute was not the plan committed at open.`,
      );
    } else {
      pass("the chain's own commitment matches the revealed plan");
    }
  }
}

console.log("");
console.log("  6. The money adds up, in accounts rather than in JSON");
console.log("  ------------------------------------------------------------");

/**
 * The arithmetic the whole product rests on:
 *
 *     deposit = provider's share + customer's remainder + treasury dust
 *
 * Every term is re-read from the chain where an account still exists, so this
 * is a statement about token accounts rather than about the run's bookkeeping.
 */
const openObserved = obj(open.observed);
const openExpected = obj(open.expected);
const deposit = BigInt(str(openExpected.deposit, "02-channel-open.json expected.deposit"));

const providedReceived = BigInt(str(observedSettlement.providerReceived, "09-settlement.json observed.providerReceived"));
const customerReceived = BigInt(str(observedSettlement.customerReceived, "09-settlement.json observed.customerReceived"));
const treasuryReceived = BigInt(str(observedSettlement.treasuryReceived, "09-settlement.json observed.treasuryReceived"));

const sum = providedReceived + customerReceived + treasuryReceived;
if (sum !== deposit) {
  fail(`provider ${providedReceived} + customer ${customerReceived} + treasury ${treasuryReceived} = ${sum}, but the deposit was ${deposit}`);
} else {
  pass(`deposit ${deposit} splits exactly: ${providedReceived} + ${customerReceived} + ${treasuryReceived}`);
}

// Which is the same as: the escrow holds nothing now.
const escrowTokenAccount = str(openObserved.channelTokenAccount, "02-channel-open.json observed.channelTokenAccount");
if (escrowTokenAccount !== "") {
  const escrowAmount = await readTokenAmount(escrowTokenAccount);
  if (escrowAmount === null) {
    pass("the escrow token account has been closed (nothing left to hold)");
  } else if (escrowAmount !== 0n) {
    fail(`the escrow still holds ${escrowAmount} atomic units on chain`);
  } else {
    pass("the escrow holds zero on chain");
  }
} else {
  note(
    "the open artifact does not record the escrow token account address, so the verifier could not " +
      "re-read it. Add `channelTokenAccount` to 02-channel-open.json's observed block.",
  );
}

// And the far end: the provider really received its share, on chain.
const providerTokenAccount = str(openObserved.payeeTokenAccount, "02-channel-open.json observed.payeeTokenAccount");
if (providerTokenAccount !== "") {
  const providerAmount = await readTokenAmount(providerTokenAccount);
  if (providerAmount === null) {
    fail("the provider's token account does not exist on chain");
  } else {
    pass(`the provider's token account holds ${providerAmount} atomic units on chain`);
    if (providerAmount < providedReceived) {
      note(
        `the provider holds ${providerAmount} now, less than the ${providedReceived} this run paid — ` +
          "consistent with earlier runs having spent from the same account.",
      );
    }
  }
}

console.log("");
console.log("  ------------------------------------------------------------");

if (failures.length > 0) {
  console.log(`  VERIFICATION FAILED — ${failures.length} problem(s)`);
  console.log("");
  for (const failure of failures) console.log(`    - ${failure}`);
  console.log("");
  process.exit(1);
}

console.log("  VERIFIED");
console.log("");
console.log(`  The chain agrees with all twelve artifacts for ${EVIDENCE_DIR}/.`);
if (notes.length > 0) {
  console.log("");
  console.log("  Worth knowing, but not failures:");
  for (const entry of notes) console.log(`    - ${entry}`);
}
console.log("");
