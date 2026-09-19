# PRD — ZEEP: Private Payment Rail on Midnight

**Status:** Draft v1 · **Date:** 2026-09-16 · **Owner:** nblpratama2203
**Program:** New Moon to Full — Monthly Moonshots on Midnight
**Category (Idea Submission):** Payments
**Target this month:** Level 4 (Waxing Gibbous — MVP live on Preprod), with Level 1–3 artifacts satisfied in the same period (sequential-progression rule).

---

## 0. TL;DR

ZEEP lets you get paid by **username** instead of by wallet address. A public registry maps `username -> receiver key`. When someone pays a username, the contract writes only a **note commitment** to the ledger; **amount and sender stay private circuit witnesses**. The receiver proves in-circuit that a note is theirs and claims it by publishing a **nullifier** (prevents double-claim), revealing neither which note, how much, nor from whom. Observers see only that *some* payment occurred. Optional **selective disclosure**: a receiver can prove an aggregate (e.g. total received in a period) without exposing individual payments.

Core mechanic ported from stealth-address payment rails, but rebuilt with Midnight zero-knowledge instead of address-derivation obfuscation.

---

## 1. Problem & Goals

### 1.1 Problem
Sharing a crypto address doxxes your full financial history: balances, counterparties, patterns, permanently. That kills crypto for salaries, invoices, donations, and everyday payments.

### 1.2 Goals (this project)
- G1 — Pay a human-readable username, never expose the receiver's spending history.
- G2 — Sender identity and amount unlinkable to any on-chain observer.
- G3 — Prevent double-claim of a note without a global public balance table.
- G4 — Give the receiver *opt-in* provability (audit / proof-of-income) without breaking default privacy.
- G5 — Ship an MVP on Preprod with a real frontend and Lace wallet connect.

### 1.3 Non-Goals (MVP)
- Multi-token / cross-asset swaps (Level 5+).
- Fiat on/off-ramp.
- Mobile native app (web responsive only).
- Encrypted off-chain messaging/memos beyond a minimal note payload.
- Full stealth-address ECDH scheme (replaced by Midnight-native commitments; see §3.4).

### 1.4 Success Metrics
| Level | Metric |
|---|---|
| L4 | MVP flows (register / pay / scan / claim) working on Preprod; demo video; docs; CI green; public X profile |
| L5 | 50 Preprod users complete at least one pay-or-claim; living feedback loop |
| L6 | Mainnet deploy; 20 real onboarded users; brand assets |

---

## 2. Personas & User Stories

- **Receiver (Riri, freelancer):** "I share `@riri` on my invoice. Clients pay it. Nobody sees my balance or my other clients."
- **Payer (Bima, client):** "I pay `@riri` from my Lace wallet. I don't want the whole chain to log that Bima paid Riri 500."
- **Auditor (opt-in):** "Riri chooses to prove she received at least X this quarter for a loan, without revealing each payment."

Stories:
1. As a receiver I register a username bound to my key so people can pay me.
2. As a payer I pay a username with an amount that stays private.
3. As a receiver I scan the ledger and detect notes addressed to me.
4. As a receiver I claim a note; the chain rejects any second claim of the same note.
5. As a receiver I generate a disclosure proof of an aggregate on demand.

---

## 3. Architecture

### 3.1 High-level

```
+-------------------+        +----------------------+        +---------------------+
|   Web Frontend    |        |  Midnight.js / DApp  |        |  Midnight Preprod   |
|  (React + Vite)   |<------>|  connector + proof   |<------>|  - ZEEP contract    |
|  Lace connector   |        |  provider + indexer  |        |  - ledger state     |
+-------------------+        +----------------------+        +---------------------+
        |                              |                                |
        | local private state         | proof server (ZK)              | indexer (scan)
        v                              v                                v
  browser storage              circuit witnesses                 commitments + nullifiers
```

### 3.2 Components
- **Compact contract (`zeep.compact`)** — registry + payment notes + claim/nullifier + optional disclosure circuit.
- **Contract SDK layer (`zeep-api`)** — TypeScript wrappers around the compiled circuits (from `managed/`), witness providers, private-state management.
- **Indexer/scan client** — pulls commitments from the indexer, runs local trial-decryption/ownership check to find the receiver's notes.
- **Frontend (`zeep-web`)** — the four flows + states, Lace connect via DApp connector.
- **Proof server** — local/hosted Midnight proof server generating ZK proofs for circuit calls.

> Repo already contains `frontend/` and `services/` directories; map `zeep-web` -> existing `frontend/`, contract + SDK under `services/` (or a new `contract/`) at build time. Reconcile before L1.

### 3.3 Data Model (ledger — PUBLIC)
Only these live on-chain. Nothing here links sender-receiver-amount.

| Structure | Type (illustrative) | Public meaning |
|---|---|---|
| `usernames` | `Map<Bytes<32>, ReceiverKey>` | hash(username) -> receiver public key. Directory. Intentionally public. |
| `note_commitments` | `MerkleTree<Field>` or `Set<Field>` | set/tree of note commitments. Opaque. |
| `nullifiers` | `Set<Field>` | spent-note markers. Prevents double-claim. Opaque. |
| `note_count` | `Counter` | number of notes created. Reveals volume only, not links. |

> Design note (R-31): username registry is public *by design* because discoverability is the product ("share your handle"). Privacy lives entirely in the note/commitment/nullifier layer, not the directory.

### 3.4 Why not literal stealth addresses
On a transparent chain, stealth addresses (ephemeral key + ECDH shared secret + one-time address + announcement scan) are a *workaround* to fake privacy. Midnight is private by default (circuit inputs are witnesses; `disclose()` is opt-in). So ZEEP achieves the same UX (pay a handle, stay unlinkable) using the note-commitment + nullifier model that Midnight/Zswap already use natively. Stronger guarantee, simpler mental model, honest use of the platform's privacy primitives.

### 3.5 Cryptographic flow (conceptual)

**Register**
```
receiver_secret            (witness, private)
receiver_key = derive(receiver_secret)      // public-ish key stored in registry
usernames[hash(username)] = receiver_key
```

**Pay `@user` with `amount`**
```
amount                     (witness, private)
sender_secret              (witness, private)   // never written
salt = random()            (witness, private)
receiver_key = usernames[hash(username)]        // read public directory
commitment = hash(receiver_key, amount, salt)   // only this hits the ledger
insert commitment into note_commitments
// funds moved via Midnight's shielded token mechanism (Zswap), amount not disclosed
```

**Scan (client-side, off-chain compute)**
```
for each commitment C in ledger:
    reconstruct with my receiver_secret + known (amount, salt) -> match => mine
// MVP: payer hands receiver the (amount, salt) as a claim code out-of-band,
// OR encodes an encrypted payload the receiver trial-decrypts with receiver_secret
```

**Claim**
```
receiver_secret, amount, salt   (witnesses, private)
prove: commitment = hash(receiver_key(receiver_secret), amount, salt)
prove: commitment is a member of note_commitments   // Merkle/set membership
nullifier = hash(receiver_secret, commitment)
require nullifier not in nullifiers                  // no double-claim
insert nullifier into nullifiers
// receiver receives amount into their shielded balance
```

**Disclose (opt-in, selective disclosure)**
```
prove: sum(amount_i for claimed notes in [t0,t1]) >= threshold
disclose(threshold_result)   // only the boolean/aggregate leaves the circuit
```

> The exact witness plumbing and the encrypted-payload-vs-out-of-band scan decision are the two open technical risks (see §9). MVP may start with out-of-band (payer shares a claim code) and upgrade to on-chain encrypted payload.

---

## 4. Contract Design (Compact)

File: `contract/src/zeep.compact`. Snippets are **illustrative** (align to installed `compact` compiler version at build time).

```compact
pragma language_version >= 0.14;
import CompactStandardLibrary;

// ---------- Ledger (public state) ----------
export ledger usernames: Map<Bytes<32>, Bytes<32>>;       // hash(name) -> receiver_key
export ledger commitments: Set<Field>;                    // note commitments
export ledger nullifiers: Set<Field>;                     // spent notes
export ledger noteCount: Counter;

// ---------- Witnesses (private inputs) ----------
witness receiverSecret(): Bytes<32>;
witness paymentSalt(): Bytes<32>;
witness paymentAmount(): Uint<64>;

// ---------- Circuits ----------
export circuit register(nameHash: Bytes<32>): [] {
    const key = publicKey(receiverSecret());
    usernames.insert(disclose(nameHash), disclose(key));
}

export circuit pay(nameHash: Bytes<32>): [] {
    const key = usernames.lookup(disclose(nameHash));
    const amount = paymentAmount();
    const salt = paymentSalt();
    const commitment = commit(key, amount, salt);   // hash, amount stays private
    commitments.insert(disclose(commitment));
    noteCount.increment(1);
    // token transfer via shielded mechanism omitted here (see zswap integration)
}

export circuit claim(commitment: Field): [] {
    const secret = receiverSecret();
    const amount = paymentAmount();
    const salt = paymentSalt();
    const key = publicKey(secret);
    assert commit(key, amount, salt) == commitment;
    assert commitments.member(disclose(commitment));
    const nf = nullifier(secret, commitment);
    assert !nullifiers.member(disclose(nf));
    nullifiers.insert(disclose(nf));
}
```

Helpers (pseudo): `publicKey`, `commit`, `nullifier` implemented via standard-library hashing (`persistentHash` / `transientHash` families).

### 4.1 Tests (Level 3 needs at least 3 passing)
- T1 `register` then `usernames` lookup returns the key.
- T2 `pay` inserts exactly one commitment and increments `noteCount`.
- T3 `claim` succeeds once; second `claim` of same commitment **fails** on nullifier check.
- T4 (bonus) `pay` does not write amount to any public ledger field (privacy assertion).
- T5 (bonus) disclosure circuit returns aggregate without exposing components.

---

## 5. Frontend Spec

### 5.1 Design Read (antislop R-37 / Part 3)
> Reading this as: a **privacy fintech utility app** for crypto-literate freelancers and their clients, in a **restrained, trustworthy, slightly nocturnal** visual language. **Dial: ENERGY 2 / RHYTHM 2 / MOTION 1.**

**Direction status: PROPOSED, needs owner sign-off (R-37).** No `DESIGN.md` exists yet. The palette/type below is a proposed direction, not a silent default. Confirm or replace before build; otherwise it ships labeled "draft without direction".

**Proposed identity (confirm):**
- **Palette:** 2 core + 1 accent + neutrals (R-29).
  - Core ink: deep slate `#141821` (near-black, not pure black).
  - Core surface: warm off-white `#F5F3EE` (light) / slate `#191D27` (dark).
  - Accent: a single "moonlight" desaturated gold `#C7A45A`, used only on the primary action and the "claimed" success state. Reason (R-01): ties to the program's moon-phase narrative; one accent, one job.
- **Type (R-06):** a humanist sans for body (readability for numbers/addresses), a slightly higher-contrast display face for section headers. Reason: financial data must read cleanly; avoids the monospace-as-aesthetic tell. Mono used ONLY for actual technical strings (addresses, tx hashes, commitments) where character disambiguation is functional.
- **Identity motif (Part 3):** a thin waxing-crescent-to-full arc used once as a progress indicator on the claim flow (payment "in shadow" -> "claimed in light"). Single repeated gesture, not decoration everywhere.
- **Theme (R-21/R-34):** light default, working dark toggle (crypto users skew dark). Both modes verified.
- **Motion (R-19, MOTION 1):** hover/focus transitions + one purposeful reveal when a scanned note is found. No endless pulses, no floating, no stacked template animations.

### 5.2 Information Architecture / Pages

| Route | Page | Purpose | Auth |
|---|---|---|---|
| `/` | Landing | Explain ZEEP, one primary CTA, real "how it works" (as many steps as real, not forced 3). | public |
| `/app` | Dashboard | Connect Lace; shows your handle, claimable notes, claimed history. | wallet |
| `/pay/:username` | Pay | Payer enters amount, confirms, submits `pay`. | wallet |
| `/claim` | Claim / Inbox | Scan results, per-note claim with state machine. | wallet |
| `/settings` | Settings | Register/change username, key-material warnings, disclosure generator. | wallet |
| `/disclose` | Selective Disclosure | Build an aggregate proof, produce a shareable verification blob. | wallet |

Nav contains ONLY these real destinations (R-24). No ghost links.

### 5.3 Key Components
- `WalletConnect` — Lace connect/disconnect via DApp connector; shows connection + network (Preprod) state.
- `HandleCard` — the receiver's `@username` + copy-to-share; empty state if not registered.
- `PayForm` — amount input (validation, min/max), handle resolve (shows "not found" state), submit + proof-generation progress.
- `NoteInbox` — list of scanned notes; each row: amount (only if known locally), status, Claim action.
- `ClaimStateMachine` — `idle -> proving -> submitting -> claimed | error`, mapped to the crescent-to-full motif.
- `DisclosureBuilder` — pick range + threshold, generate proof, output verifiable blob.
- `StatusBanner` — network mismatch / proof-server-down / indexer-lag warnings.

### 5.4 Required UI States (antislop R-27 — every data view)
For `NoteInbox`, `PayForm resolve`, `Dashboard`, `Disclosure`:
- **Empty:** "No notes yet. Share your @handle to receive your first private payment." + copy button (names the next action, not "No data").
- **Loading:** proof generation can be slow. Show honest "Generating zero-knowledge proof, this can take a moment" with a determinate-ish indicator, not a bare spinner.
- **Error:** name cause + action ("Proof server unreachable. Check it is running on :6300 and retry.").
- **Not-connected:** distinct from empty; prompts wallet connect.

### 5.5 Copy rules (antislop R-02/R-15/R-16)
- No em dashes in UI copy. No buzzwords ("seamless", "next-gen", "AI-powered").
- CTAs specific: "Pay @riri", "Claim this payment", "Register my handle". Never "Get Started" / "Learn More".
- No fabricated stats/testimonials/trust badges (R-17/R-18/R-36). If no real users yet, no "Trusted by" bar.

### 5.6 Accessibility (R-25/R-32/R-03)
- WCAG AA contrast on gold accent verified against both themes.
- Full keyboard path: Tab order, Enter/Space activate, Escape closes modals; visible focus ring.
- Mobile: no horizontal overflow; long strings (addresses, commitments) truncate with copy, never overflow; 44px tap targets.

---

## 6. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Contract language | **Compact** | required by program |
| Compiler/toolchain | `compact` compiler, proof server, Node 22, Docker | Midnight L1 requirement |
| Contract tests | Midnight test runner / vitest over `zeep-api` | at least 3 tests for L3 |
| SDK | **Midnight.js**, DApp connector API | wallet + circuit calls |
| Wallet | **Lace** (Preprod) | required |
| Frontend | **React 18 + Vite + TypeScript** | fast, standard, good DX; matches existing `frontend/` |
| Styling | Tailwind or CSS modules + design tokens | tokenized palette/radii (antislop consistency) |
| State | React Query (server/indexer) + local store for private state | separates chain data from secrets |
| Indexer | Midnight indexer client | scan commitments |
| Hosting | Vercel/Netlify (frontend), local/hosted proof server | L2/L4 live demo link |
| CI/CD | GitHub Actions: `compact compile` + tests + frontend build on every push | L3 requirement |
| Repo | public GitHub, README with privacy-model section | all levels |

### 6.1 Target repo layout
```
alphyn-midnight/
  contract/            # zeep.compact + managed/ (circuits+keys) + tests
  services/            # (existing) SDK / indexer-scan / proof orchestration
  frontend/            # (existing) React app -> zeep-web
  .github/workflows/   # ci.yml (compile + test + build)
  docs/                # architecture, privacy-model, runbook
  README.md
```

---

## 7. Flows (sequence)

### 7.1 Register
Connect Lace -> enter username -> client checks `usernames.lookup(hash)` for collision -> call `register` circuit (proof) -> tx to Preprod -> `HandleCard` shows `@username`.

### 7.2 Pay
Open `/pay/:username` -> resolve key from registry (not-found state if absent) -> enter amount (validate) -> confirm -> generate proof for `pay` (progress state) -> submit tx -> success receipt (local only) + claim hint.

### 7.3 Scan + Claim
Dashboard loads -> scan client pulls commitments from indexer -> local ownership check finds notes -> `NoteInbox` lists claimable -> click Claim -> `proving -> submitting` -> `claim` circuit enforces membership + nullifier -> `claimed` state (crescent-to-full motif) -> second claim attempt blocked (nullifier), surfaced as a clear error, not a crash.

### 7.4 Disclose
`/disclose` -> pick range + threshold -> generate aggregate proof -> output verifiable blob -> auditor verifies without seeing individual notes.

---

## 8. Milestones (mapped to hackathon levels)

> Reward at L4 requires L1–L3 met in the same program period (sequential rule). Plan builds all four.

### L1 — New Moon (foundation)
- [ ] Toolchain (compact, proof server, Node 22, Docker) installed.
- [ ] `zeep.compact` v0: `register` + `pay` compiles via `compact compile`.
- [ ] `managed/` generated (circuits + keys).
- [ ] At least 1 passing test; deploy to Preprod; contract address visible.
- [ ] README: initial idea paragraph + public-state-vs-private-witness section.
- [ ] At least 5 meaningful commits. Screenshots: compile output, deployed address.

### L2 — Waxing Crescent (frontend + wallet)
- [ ] Vite/React app; Lace connect/disconnect.
- [ ] Call `pay` (or `register`) circuit from UI; handle result.
- [ ] One observable privacy behavior (amount proven, never shown on ledger).
- [ ] Preprod address verifiable; live demo link; demo video (connect + circuit call).
- [ ] At least 8 commits.

### L3 — First Quarter (production-grade)
- [ ] Full `register/pay/claim` + nullifier double-claim protection.
- [ ] At least 3 tests passing; CI/CD (compile + test on push) green with badge.
- [ ] Selected provided-list idea for L3 = **"Private Payroll / Splits"** (ZEEP as private disbursement), evolving into the general rail at L4.
- [ ] README "privacy model" section (what an observer can/cannot learn).
- [ ] 1-min demo video; at least 10 commits.

### L4 — Waxing Gibbous (MVP live)
- [ ] All four flows on Preprod, documented.
- [ ] Selective disclosure demo.
- [ ] CI/CD; docs folder; public product **X** profile.
- [ ] Polished frontend passing the antislop Delivery Gate.

### L5 / L6 (context)
- L5: same MVP, feedback loop, 50 Preprod users, mentor market-fit checkpoint.
- L6: Mainnet deploy, 20 real users, brand assets.

---

## 9. Risks & Open Questions
| # | Risk | Mitigation |
|---|---|---|
| R1 | Scan mechanism: how the receiver learns `(amount, salt)` to reconstruct a note | MVP: out-of-band claim code from payer. Upgrade: on-chain encrypted payload trial-decrypted with `receiverSecret`. Decide before L3. |
| R2 | Compact API drift vs illustrative snippets | Pin compiler version at L1; adapt commit/nullifier helpers to actual std-lib. |
| R3 | Proof generation latency hurting UX | Honest determinate loading states (R-27); consider hosted proof server for demo. |
| R4 | Token transfer / shielded value movement (Zswap) integration | Scope a minimal single test-token transfer for MVP; document as the value layer. |
| R5 | Username squatting on public registry | First-come MVP; add fees/expiry later (not MVP). |
| R6 | Design direction unconfirmed (R-37) | Get owner sign-off on section 5.1 before frontend build. |

---

## 10. Definition of Done (L4)
- Register / Pay / Scan / Claim / Disclose all work on Preprod.
- Double-claim provably blocked (test + live).
- Amount and sender never appear in any public ledger field (documented + tested).
- CI green; public repo; docs; demo video; X profile live.
- Frontend passes antislop Delivery Gate (Hard Gate, Purpose-Gate, Liveliness dials ENERGY 2/RHYTHM 2/MOTION 1, Craftsmanship) with recorded click-through.

---

## Appendix A — README privacy-model section (draft)
> **What an observer can learn:** that a payment occurred, the total count of notes, and the public username-to-key directory.
> **What an observer cannot learn:** who paid, how much, which receiver a given note belongs to, or which note a claim spent. Sender, amount, and sender-receiver linkage stay private circuit witnesses. Selective disclosure reveals only an aggregate the receiver explicitly chooses to prove.
