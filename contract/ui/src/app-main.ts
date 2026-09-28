import "./polyfills"; // sets globalThis.Buffer before midnight-js modules load
import "@fontsource-variable/fraunces"; // display voice (Fraunces variable)
document.documentElement.classList.add("js"); // gates .reveal hiding: content shows when scripts fail
import qrcode from "qrcode-generator";
import { parseTokenAmount, formatTokenAmount } from "./amount";
import { mountLandingPreview } from "./landing-preview";
import { isWalletSyncError } from "./wallet-ready";
import {
  waitForWallets,
  connect,
  register,
  handleStatus,
  registeredHandle,
  recipientAddress,
  myUnshieldedAddress,
  unshieldedPaymentBalance,
  sendToUnshielded,
  forgetApprovedWalletConnection,
  normalizeTransactionId,
  waitForFinalizedTx,
  watchUnshieldedTransactions,
  CONTRACT_ADDRESS,
  REGISTRY_VERSION,
  type Session,
  type Wallet,
} from "./zeep-app";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function syncContractLinks(): void {
  const explorerUrl = CONTRACT_ADDRESS
    ? `https://explorer.1am.xyz/contract/${CONTRACT_ADDRESS}?network=preprod`
    : "#";
  for (const id of ["verify"]) {
    const link = document.getElementById(id) as HTMLAnchorElement | null;
    if (link) {
      link.hidden = !CONTRACT_ADDRESS;
      if (CONTRACT_ADDRESS) link.href = explorerUrl;
    }
  }
  for (const id of ["addr"]) {
    const value = document.getElementById(id);
    if (value) value.textContent = CONTRACT_ADDRESS || "not configured";
  }
}
syncContractLinks();

const logEl = document.getElementById("log");
const log = (line: string) => {
  const ts = new Date().toISOString().slice(11, 19);
  if (logEl) {
    logEl.textContent += `[${ts}] ${line}\n`;
    (logEl as HTMLElement).scrollTop = logEl.scrollHeight;
  }
};

let session: Session | undefined;
let activeWalletAddress = "";
const walletCacheKey = (kind: string) => `zeep.${REGISTRY_VERSION === 3 ? "v3." : ""}${kind}.${activeWalletAddress}`;

// Light theme only, no toggle: <html data-theme="light"> is fixed in the markup. The
// hero stays a deliberately nocturnal zone via its own hardcoded colours.

// ---- sidebar views (Dashboard / Requests / Activity / Settings) ----
const VIEWS = ["dashboard", "activity", "settings"] as const;
type View = (typeof VIEWS)[number];
const navItems = [...document.querySelectorAll<HTMLAnchorElement>(".navitem")];
const viewEls = [...document.querySelectorAll<HTMLElement>(".view")];

// Unique document title per screen (landing keeps the marketing title).
const VIEW_TITLES: Record<View, string> = {
  dashboard: "Dashboard",
  activity: "Activity",
  settings: "Settings",
};
function setTitle(sub?: string): void {
  document.title = sub ? `ZEEP · ${sub}` : "ZEEP: get paid by username";
}

function currentView(): View {
  const v = location.hash.match(/^#\/app\/(\w+)/)?.[1] as View | undefined;
  return v && (VIEWS as readonly string[]).includes(v) ? v : "dashboard";
}
function showView(v: View) {
  setTitle(VIEW_TITLES[v]);
  for (const el of viewEls) el.hidden = el.id !== `view-${v}`;
  for (const a of navItems) {
    if (a.dataset.view === v) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  // Dashboard and Activity read live chain state when opened.
  if (v === "dashboard") {
    renderHandleCard();
    void refreshBalance();
  }
  if (v === "activity") {
    renderActivity();
    void refreshBalance().then(() => renderActivity());
  }
  if (v === "settings") void renderProfile();
}

// ---- dashboard handle card (real: handle from localStorage, share link + QR) ----
const handleCard = $<HTMLElement>("handleCard");
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const qrModal = $<HTMLElement>("qrModal");
const qrModalCode = $<HTMLElement>("qrModalCode");
const qrModalHandle = $<HTMLElement>("qrModalHandle");
const qrModalRoute = $<HTMLElement>("qrModalRoute");
const qrModalUrl = $<HTMLElement>("qrModalUrl");
let qrModalLink = "";

function closeQrModal(): void {
  qrModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function openQrModal(handle: string, link: string): void {
  qrModalLink = link;
  qrModalCode.innerHTML = "";
  const qr = qrcode(0, "M");
  qr.addData(link);
  qr.make();
  qrModalCode.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2 });
  const route = `/${handle.replace(/^@/, "")}`;
  qrModalHandle.textContent = route;
  qrModalRoute.textContent = route;
  qrModalUrl.textContent = link;
  qrModal.hidden = false;
  document.body.classList.add("modal-open");
}

$<HTMLButtonElement>("closeQrModal").addEventListener("click", closeQrModal);
qrModal.addEventListener("click", (event) => {
  if (event.target === qrModal) closeQrModal();
});
$<HTMLButtonElement>("copyQrLink").addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(qrModalLink);
    button.textContent = "Copied";
    window.setTimeout(() => (button.textContent = "Copy link"), 1400);
  } catch {
    button.textContent = "Copy failed";
    window.setTimeout(() => (button.textContent = "Copy link"), 1400);
  }
});
$<HTMLButtonElement>("openQrLink").addEventListener("click", () => {
  if (qrModalLink) window.open(qrModalLink, "_blank", "noopener");
});

function getHandle(): string {
  try {
    return activeWalletAddress ? localStorage.getItem(walletCacheKey("handle")) ?? "" : "";
  } catch {
    return "";
  }
}
function saveHandle(h: string): void {
  try {
    if (activeWalletAddress) localStorage.setItem(walletCacheKey("handle"), h);
  } catch {
    /* ignore private-mode */
  }
}
// New links contain only the handle. V3 resolves its unshielded address from
// the directory; v2 cannot resolve a native tNIGHT destination.
function payLink(handle: string, amount?: string | null): string {
  const qs = [amount ? `amt=${encodeURIComponent(amount)}` : ""]
    .filter(Boolean)
    .join("&");
  const base = `${location.origin}${import.meta.env.BASE_URL}#/pay/${encodeURIComponent(handle)}`;
  return `${base}${qs ? "?" + qs : ""}`.replace(/([^:])\/\/+/g, "$1/");
}
// Total tNIGHT balance from the wallet; send preflight checks unshielded funds.
async function refreshBalance(): Promise<void> {
  const el = document.getElementById("balanceVal");
  const note = document.getElementById("balancePoolNote");
  if (!el) return;
  if (!session) {
    el.textContent = "0";
    return;
  }
  try {
    const balance = await unshieldedPaymentBalance(session);
    const current = balance?.[1] ?? 0n;
    el.textContent = formatTokenAmount(current);
    if (note) {
      note.textContent = balance
        ? REGISTRY_VERSION === 3
          ? "Spendable unshielded tNIGHT in your wallet. Transfers are public."
          : "Unshielded tNIGHT in your wallet. This v2 handle directory cannot route it to a shielded address."
        : "No unshielded tNIGHT reported by 1AM.";
      note.classList.remove("balance-warning");
    }
    if (activeWalletAddress) {
      const key = walletCacheKey("lastBalance");
      // Store a snapshot for display/debugging only. A balance delta is not a
      // transaction: wallet syncs, change outputs, and shielded/unshielded
      // reconciliation can all make it move without a payment being received.
      localStorage.setItem(key, current.toString());
    }
  } catch (error) {
    el.textContent = "—";
    if (note) note.textContent = isWalletSyncError(error)
      ? "1AM is syncing. Balance will update after the wallet is ready."
      : "Balance temporarily unavailable. Try refreshing after 1AM reconnects.";
  }
}

const MOON = `<svg class="moon" width="150" height="150" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="9" fill="none" stroke="#c7a45a" stroke-width="0.5"/><path d="M11 2 a9 9 0 0 1 0 18 a6 9 0 0 0 0 -18" fill="#c7a45a" opacity="0.3"/></svg>`;
function renderHandleCard(): void {
  const h = getHandle();
  if (!h) {
    handleCard.innerHTML = `${MOON}<p class="eyebrow">Your handle</p><p class="handle-big">No handle yet</p><p class="handle-sub">${REGISTRY_VERSION === 3 ? "Register a handle to share your payment link." : "Register a handle on-chain. Payments by handle need a directory that stores tNIGHT addresses."}</p><button class="iconbtn cta" id="goRegister">Register a handle &rarr;</button>`;
    handleCard.querySelector("#goRegister")?.addEventListener("click", () => openPaymentModal("request"));
    return;
  }
  const link = payLink(h);
  handleCard.innerHTML =
    `${MOON}<p class="eyebrow">Your handle</p><p class="handle-big">@${esc(h)}</p>` +
    `<p class="handle-sub">${REGISTRY_VERSION === 3 ? "Share this handle link to receive tNIGHT in your unshielded wallet. Transfers are public." : "This handle link cannot supply a tNIGHT destination yet. Share your unshielded address separately to receive tNIGHT."}</p>` +
    `<div class="sharebar"><span class="url" title="${esc(link)}">${esc(link)}</span>` +
    `<button class="iconbtn" id="hCopy" aria-label="Copy payment link">Copy</button><button class="iconbtn" id="hQr" aria-label="Show QR code for payment link">QR</button>` +
    `<button class="iconbtn" id="hOpen" aria-label="Open payment link in a new tab">Open</button></div>`;
  handleCard.querySelector("#hCopy")?.addEventListener("click", async () => {
    const b = handleCard.querySelector<HTMLButtonElement>("#hCopy")!;
    try {
      await navigator.clipboard.writeText(link);
      b.textContent = "Copied";
      setTimeout(() => (b.textContent = "Copy"), 1500);
    } catch {
      log("Clipboard blocked; copy the link manually.");
    }
  });
  handleCard.querySelector("#hOpen")?.addEventListener("click", () => window.open(link, "_blank", "noopener"));
  handleCard.querySelector("#hQr")?.addEventListener("click", () => openQrModal(h, link));
}

// ---- payment requests (real: shareable links off your handle, Open/Fixed amount) ----
type Req = { id: string; label: string; amount: string | null; ts: number };
const reqListEl = $<HTMLElement>("reqList");
const reqAmtWrap = $<HTMLElement>("reqAmtWrap");
const doCreateReq = $<HTMLButtonElement>("doCreateReq");
const reqNeedHandle = $<HTMLElement>("reqNeedHandle");
let reqMode: "open" | "fixed" = "open";

function getRequests(): Req[] {
  try {
    return JSON.parse(activeWalletAddress ? localStorage.getItem(walletCacheKey("requests")) ?? "[]" : "[]") as Req[];
  } catch {
    return [];
  }
}
function saveRequests(r: Req[]): void {
  try {
    if (activeWalletAddress) localStorage.setItem(walletCacheKey("requests"), JSON.stringify(r));
  } catch {
    /* ignore private-mode */
  }
}
function reqLink(amount: string | null): string {
  return payLink(getHandle(), amount);
}
function renderRequests(): void {
  const rs = getRequests();
  if (!rs.length) {
    reqListEl.innerHTML = '<div class="empty">No request links yet. Create one above.</div>';
    return;
  }
  reqListEl.innerHTML = "";
  for (const r of rs) {
    const link = reqLink(r.amount);
    const wrap = document.createElement("div");
    wrap.className = "reqcard-wrap";
    wrap.innerHTML =
      `<div class="reqcard"><div class="meta"><div class="rl">${esc(r.label || "Untitled")} <span class="badge">${r.amount ? esc(r.amount) + " tNIGHT" : "Open"}</span></div>` +
      `<div class="ru" title="${esc(link)}">${esc(link)}</div></div>` +
      `<div class="acts"><button class="ghost sm" data-a="copy">Copy</button><button class="ghost sm" data-a="qr">QR</button><button class="ghost sm" data-a="del">Delete</button></div></div>`;
    wrap.querySelector('[data-a="copy"]')!.addEventListener("click", async (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      try {
        await navigator.clipboard.writeText(link);
        b.textContent = "Copied";
        setTimeout(() => (b.textContent = "Copy"), 1500);
      } catch {
        log("Clipboard blocked; copy the link manually.");
      }
    });
    wrap.querySelector('[data-a="qr"]')!.addEventListener("click", () => openQrModal(getHandle(), link));
    wrap.querySelector('[data-a="del"]')!.addEventListener("click", () => {
      saveRequests(getRequests().filter((x) => x.id !== r.id));
      renderRequests();
    });
    reqListEl.appendChild(wrap);
  }
}
function setReqMode(m: "open" | "fixed"): void {
  reqMode = m;
  $<HTMLButtonElement>("segOpen").setAttribute("aria-pressed", String(m === "open"));
  $<HTMLButtonElement>("segFixed").setAttribute("aria-pressed", String(m === "fixed"));
  reqAmtWrap.hidden = m !== "fixed";
}
function updateCreateAvail(): void {
  const has = !!getHandle();
  doCreateReq.disabled = !has;
  reqNeedHandle.hidden = has;
}
$<HTMLButtonElement>("segOpen").addEventListener("click", () => setReqMode("open"));
$<HTMLButtonElement>("segFixed").addEventListener("click", () => setReqMode("fixed"));
doCreateReq.addEventListener("click", () => {
  if (!getHandle()) return;
  const label = $<HTMLInputElement>("reqLabel").value.trim();
  let amount: string | null = null;
  if (reqMode === "fixed") {
    try {
      amount = formatTokenAmount(parseTokenAmount($<HTMLInputElement>("reqAmt").value));
    } catch (e) {
      return setStatus($<HTMLDivElement>("reqStatus"), "err", errMsg(e));
    }
  }
  const r: Req = { id: Math.random().toString(36).slice(2, 9), label, amount, ts: Date.now() };
  saveRequests([r, ...getRequests()]);
  renderRequests();
  $<HTMLInputElement>("reqLabel").value = "";
  $<HTMLInputElement>("reqAmt").value = "";
  setReqMode("open");
  setStatus($<HTMLDivElement>("reqStatus"), "ok", `Request link created${amount ? ` (fixed ${amount})` : " (open amount)"}.`);
});

// ---- activity feed (local presentation cache for wallet actions) ----
type Act = {
  id: string;
  type: "register" | "pay" | "receive";
  handle: string | null;
  recipientAddress?: string | null;
  amount: string | null;
  txId: string | null;
  submissionId: string | null;
  status: "pending" | "confirmed" | "failed" | "unverified";
  ts: number;
};
const actFeed = $<HTMLElement>("actFeed");
function getActivity(): Act[] {
  try {
    const key = activeWalletAddress ? walletCacheKey("activity") : "";
    const parsed = (key ? JSON.parse(localStorage.getItem(key) ?? "[]") : []) as Act[];
    // Older builds fabricated incoming payments from balance deltas. Those
    // entries have no transaction id and cannot be verified, so remove them
    // during the read migration instead of showing false payment amounts.
    const cleaned = parsed
      .filter((entry) => entry.type !== "receive" || !!entry.txId)
      .map((entry) => {
        const raw = entry as Act & { status?: Act["status"]; submissionId?: string | null };
        const normalized = normalizeTransactionId(raw.txId);
        // Older builds stored the wallet submission ID as txId. Keep it only
        // as an internal submissionId until the indexer confirms the real hash.
        const status = raw.status ?? (normalized ? "unverified" : "pending");
        const txId = status === "confirmed" ? normalized : null;
        const submissionId = raw.submissionId ?? normalized;
        return { ...raw, txId, submissionId, status };
      });
    if (key && JSON.stringify(cleaned) !== JSON.stringify(parsed)) localStorage.setItem(key, JSON.stringify(cleaned));
    return cleaned;
  } catch {
    return [];
  }
}
function addActivity(a: Omit<Act, "id" | "ts" | "status"> & { status?: Act["status"] }): string {
  const entry: Act = {
    ...a,
    status: a.status ?? (a.txId ? "unverified" : "pending"),
    id: Math.random().toString(36).slice(2, 9),
    ts: Date.now(),
  };
  try {
    if (activeWalletAddress) localStorage.setItem(walletCacheKey("activity"), JSON.stringify([entry, ...getActivity()].slice(0, 200)));
  } catch {
    /* ignore private-mode */
  }
  renderActivity();
  return entry.id;
}
function addReceivedActivity(txId: string, units: bigint, ts: number): void {
  const normalized = normalizeTransactionId(txId);
  if (!activeWalletAddress || !normalized || units <= 0n) return;
  const existing = getActivity();
  if (existing.some((entry) => entry.type === "receive" && entry.txId === normalized)) return;
  const entry: Act = {
    id: `receive-${normalized}`,
    type: "receive",
    handle: null,
    amount: formatTokenAmount(units),
    txId: normalized,
    submissionId: null,
    status: "confirmed",
    ts: Number.isFinite(ts) ? ts : Date.now(),
  };
  try {
    localStorage.setItem(walletCacheKey("activity"), JSON.stringify([entry, ...existing].slice(0, 200)));
  } catch {
    /* ignore private-mode */
  }
  renderActivity();
}
function updateActivity(id: string, patch: Partial<Pick<Act, "txId" | "status" | "submissionId">>): void {
  try {
    if (!activeWalletAddress) return;
    const next = getActivity().map((entry) => entry.id === id ? { ...entry, ...patch } : entry);
    localStorage.setItem(walletCacheKey("activity"), JSON.stringify(next));
  } catch {
    /* ignore private-mode */
  }
  renderActivity();
}
const activityWatchers = new Set<string>();
function watchActivity(sessionForTx: Session, activityId: string, submissionId: string | null): void {
  if (!submissionId || activityWatchers.has(activityId)) return;
  activityWatchers.add(activityId);
  void waitForFinalizedTx(sessionForTx, submissionId).then((finalized) => {
    if (finalized) {
      const succeeded = /succeed|success|applied|confirmed/i.test(finalized.status);
      updateActivity(activityId, {
        txId: succeeded ? finalized.txHash : null,
        submissionId,
        status: succeeded ? "confirmed" : "failed",
      });
    }
    else updateActivity(activityId, { status: "pending", submissionId });
  }).finally(() => activityWatchers.delete(activityId));
}
function actTitle(a: Act): string {
  if (a.type === "pay") return a.status === "confirmed" ? "Payment sent" : a.status === "failed" ? "Payment failed" : "Payment pending";
  if (a.type === "receive") return "Payment received";
  return a.status === "confirmed" ? "Handle registered" : a.status === "failed" ? "Handle registration failed" : "Handle registration pending";
}
function actParty(a: Act): string {
  const you = getHandle() ? "@" + esc(getHandle()) : "You";
  if (a.type === "pay") {
    if (a.handle) return `${you}  &rarr;  @${esc(a.handle)}`;
    if (a.recipientAddress) return `${you}  &rarr;  ${esc(a.recipientAddress.slice(0, 18) + "…" + a.recipientAddress.slice(-8))}`;
    return `${you}  &rarr;  Recipient`;
  }
  if (a.type === "receive") return `Sender  &rarr;  ${you}`;
  return `${you}  &middot;  ZEEP directory`;
}
function renderActivity(): void {
  const acts = getActivity();
  const sent = acts.filter((a) => a.type === "pay").length;
  const received = acts.filter((a) => a.type === "receive").length;
  const sentEl = document.getElementById("actSent");
  const receivedEl = document.getElementById("actReceived");
  const totalEl = document.getElementById("actTotal");
  if (sentEl) sentEl.textContent = String(sent);
  if (receivedEl) receivedEl.textContent = String(received);
  if (totalEl) totalEl.textContent = String(acts.length);
  if (!acts.length) {
    actFeed.innerHTML = '<div class="empty">No activity yet. Register or send a payment to see it here.</div>';
    return;
  }
  let html = "";
  let lastDay = "";
  for (const a of acts) {
    const d = new Date(a.ts);
    const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
    if (day !== lastDay) {
      html += `<div class="datehdr">${day}</div>`;
      lastDay = day;
    }
    const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const dir = a.type === "pay" ? "up" : a.type === "receive" ? "down" : "reg";
    const direction = a.type === "pay" ? "OUT" : a.type === "receive" ? "IN" : "ID";
    const amt = a.amount
      ? a.type === "receive"
        ? `<div class="aamt pos">+${esc(a.amount)} tNIGHT</div>`
        : `<div class="aamt neg">&minus;${esc(a.amount)} tNIGHT</div>`
      : `<div class="aamt neutral">On-chain</div>`;
    const tx = a.status === "confirmed" && a.txId
      ? `<a class="atx" href="https://explorer.1am.xyz/tx/${encodeURIComponent(a.txId)}?network=preprod" target="_blank" rel="noopener" title="Open transaction ${esc(a.txId)}" aria-label="Open transaction ${esc(a.txId)}">↗</a>`
      : "";
    const txState = a.status === "confirmed" ? "Confirmed" : a.status === "failed" ? "Failed" : "Awaiting indexer confirmation";
    html +=
      `<article class="act"><span class="dir ${dir}" aria-label="${direction}">${direction}</span>` +
      `<div class="ameta"><div class="atitle">${actTitle(a)}</div><div class="asub">${actParty(a)}</div><div class="atime">${esc(d.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }))} &middot; ${time}${a.type === "receive" ? " &middot; Sender hidden by wallet" : ""} &middot; ${txState}</div>${tx}</div>${amt}</article>`;
  }
  actFeed.innerHTML = html;
}

// ---- settings (profile / theme / device reset) ----
async function renderProfile(): Promise<void> {
  const el = $<HTMLElement>("profileBody");
  const h = getHandle();
  const handleRow = `<div class="settingrow"><span>Handle</span><span class="mono">${h ? "@" + esc(h) : "not registered"}</span></div>`;
  if (!session) {
    el.innerHTML = `<div class="empty" style="margin-bottom:8px">Connect a wallet to load your address.</div>${handleRow}`;
    return;
  }
  let addr = "";
  try {
    addr = session.unshieldedAddress;
  } catch {
    /* leave blank */
  }
  const short = addr ? `${addr.slice(0, 12)}…${addr.slice(-6)}` : "unavailable";
  el.innerHTML =
    handleRow +
    `<div class="settingrow"><span>Unshielded address</span><span class="mono" title="${esc(addr)}">${esc(short)}</span></div>` +
    (addr ? `<button class="ghost sm" id="copyAddr">Copy full address</button>` : "");
  el.querySelector("#copyAddr")?.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    try {
      await navigator.clipboard.writeText(addr);
      b.textContent = "Copied";
      setTimeout(() => (b.textContent = "Copy full address"), 1500);
    } catch {
      log("Clipboard blocked; copy the address from your wallet instead.");
    }
  });
}

// ---- status helpers (empty / loading / ok / error states, R-27) ----
function setStatus(el: HTMLElement, kind: "loading" | "ok" | "err" | "hide", msg = "") {
  el.className = "status" + (kind === "ok" ? " ok" : kind === "err" ? " err" : "");
  el.hidden = kind === "hide";
  el.textContent = msg;
}
function errMsg(e: unknown): string {
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  if (isWalletSyncError(e)) {
    return "1AM approved the connection but is still syncing wallet data. Keep 1AM open until it shows Synced; ZEEP will retry address reads automatically.";
  }
  if (/rate limited/i.test(raw)) {
    return "1AM is temporarily rate limiting wallet reads. Wait a moment, then press Connect wallet again; ZEEP will reuse the approved connection.";
  }
  // Midnight Preprod exposes ledger validation failures as numeric custom
  // errors. Keep the original message, then add the action that matches the
  // node's code so users are not left with an opaque number.
  if (/temporarily banned|temporarilybanned/i.test(raw)) {
    return `${raw} — the node has quarantined this transaction after an earlier invalid submission. Stop retrying this prompt, reload the app, reconnect 1AM, and create a fresh transaction after the wallet syncs.`;
  }
  if (/custom error:\s*182\b/i.test(raw)) {
    return `${raw} — the transaction intent is stale or already submitted. Reconnect the wallet and submit again; this creates a fresh intent.`;
  }
  if (/custom error:\s*115\b/i.test(raw)) {
    return `${raw} — the zero-knowledge proof does not match the verifier key stored by this contract. Stop retrying and redeploy the contract with the current ZK artifacts.`;
  }
  if (/custom error:\s*169\b/i.test(raw)) return `${raw} — the wallet's DUST registration signature is invalid. Reconnect 1AM and retry.`;
  if (/custom error:\s*170\b/i.test(raw)) return `${raw} — the previous 1AM fee proof is stale. Disconnect/reconnect 1AM to create a fresh wallet session, then submit once.`;
  if (/custom error:\s*171\b/i.test(raw)) return `${raw} — the DUST validity window has expired. Reconnect 1AM and retry.`;
  if (/custom error:\s*172\b/i.test(raw)) return `${raw} — this wallet already has a pending DUST registration. Wait for it to settle, then retry.`;
  if (/custom error:\s*173\b/i.test(raw)) return `${raw} — the wallet has insufficient DUST for this transaction.`;
  if (/duplicate request|similar request.*pending|already pending/i.test(raw)) {
    return `${raw} — 1AM still has a previous transfer request pending. Do not click again; close/restart 1AM, reconnect the wallet, then create one fresh transfer.`;
  }
  if (/SubmissionError|FiberFailure/i.test(raw)) {
    return `${raw} — the wallet/node rejected this transfer after balancing. Reconnect 1AM to refresh its synced UTXO and DUST state, then submit one fresh transfer.`;
  }
  if (/0\s*(available\s*)?DUST/i.test(raw)) return raw;
  if (/insufficient\s*(fund|funds|balance)|not enough\s*(fund|funds|balance)/i.test(raw)) {
    return `${raw} — check the exact token type and spendable balance in 1AM. A shielded address cannot receive native tNIGHT.`;
  }
  return raw;
}

// ---- connect ----
const connectBtn = $<HTMLButtonElement>("connect");
const loginStatus = $<HTMLDivElement>("loginStatus");
const actionButtons = ["doPay"].map((id) =>
  $<HTMLButtonElement>(id),
);
const walletMenu = $<HTMLElement>("walletMenu");
const walletButton = $<HTMLButtonElement>("walletButton");
const walletPopover = $<HTMLElement>("walletPopover");
const walletLabel = $<HTMLElement>("walletLabel");
const walletAddressEl = $<HTMLElement>("walletAddress");
let activeWallet: Wallet | undefined;
let stopIncomingActivityWatch: (() => void) | undefined;

function shortWalletAddress(address: string): string {
  return address.length > 22 ? `${address.slice(0, 12)}…${address.slice(-8)}` : address;
}

function syncWalletMenu(): void {
  const connected = !!session && !!activeWalletAddress;
  walletMenu.hidden = !connected;
  if (!connected || !session) return;
  walletLabel.textContent = shortWalletAddress(session.unshieldedAddress);
  walletAddressEl.textContent = session.unshieldedAddress;
}

function closeWalletPopover(): void {
  walletPopover.hidden = true;
  walletButton.setAttribute("aria-expanded", "false");
}

walletButton.addEventListener("click", () => {
  const open = walletPopover.hidden;
  walletPopover.hidden = !open;
  walletButton.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", (event) => {
  if (!walletMenu.contains(event.target as Node)) closeWalletPopover();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeWalletPopover();
});
$<HTMLButtonElement>("copyWalletAddress").addEventListener("click", async (event) => {
  if (!session) return;
  const button = event.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(session.unshieldedAddress);
    button.textContent = "Copied";
    window.setTimeout(() => (button.textContent = "Copy address"), 1400);
  } catch {
    button.textContent = "Copy failed";
    window.setTimeout(() => (button.textContent = "Copy address"), 1400);
  }
});

async function disconnectWallet(): Promise<void> {
  stopIncomingActivityWatch?.();
  stopIncomingActivityWatch = undefined;
  try {
    await activeWallet?.api.disconnect?.();
  } catch {
    // Disconnecting the app session still works when a wallet has no disconnect method.
  }
  closeWalletPopover();
  forgetApprovedWalletConnection();
  session = undefined;
  activeWallet = undefined;
  activeWalletAddress = "";
  connectBtn.textContent = "Connect wallet";
  syncWalletMenu();
  location.hash = "#/login";
  route();
}
$<HTMLButtonElement>("disconnectWallet").addEventListener("click", () => void disconnectWallet());

function requireSession(statusEl: HTMLElement): Session | undefined {
  if (!session) {
    setStatus(statusEl, "err", "Connect a Midnight wallet first.");
    return undefined;
  }
  return session;
}

// ---- hash router: landing (#/) vs app shell (#/app/<view>, #/login) ----
const landingEls = [...document.querySelectorAll<HTMLElement>(".landing")];
const appShell = $<HTMLElement>("appShell");
const launchApp = $<HTMLAnchorElement>("launchApp");
const loginGate = $<HTMLDivElement>("loginGate");
const handleGate = $<HTMLDivElement>("handleGate");
const payCtx = $<HTMLParagraphElement>("payCtx");
let reviewedHandle: { handle: string; address: string } | null = null;
if (REGISTRY_VERSION === 3) {
  $<HTMLElement>("payHandleWrap").hidden = false;
  $<HTMLElement>("payAddressWrap").hidden = true;
  $<HTMLElement>("sendHint").textContent = "Send unshielded tNIGHT using the recipient's handle. It resolves from the on-chain directory, but address ownership is not verified by the contract. Transfers are public.";
  $<HTMLElement>("payVerifyLabel").textContent = "I verified this handle's receiving address directly with the recipient.";
  $<HTMLElement>("requestHint").textContent = "Share your handle link or unshielded address to receive tNIGHT directly.";
  $<HTMLElement>("requestLinkHint").textContent = "The links below include your handle and optional amount. Confirm the linked address with payers before they send.";
  $<HTMLInputElement>("payHandle").addEventListener("input", () => {
    reviewedHandle = null;
    $<HTMLInputElement>("payAddressVerified").checked = false;
    if ($<HTMLInputElement>("payHandle").value.trim()) $<HTMLInputElement>("payAddress").value = "";
  });
  $<HTMLInputElement>("payAddress").addEventListener("input", () => {
    reviewedHandle = null;
    if ($<HTMLInputElement>("payAddress").value.trim()) $<HTMLInputElement>("payHandle").value = "";
  });
}
const sidenav = $<HTMLElement>("sidenav");
const navlinks = document.querySelector<HTMLElement>(".navlinks");
const paymentModal = $<HTMLElement>("paymentModal");
type PaymentMode = "send" | "request";

function setPaymentMode(mode: PaymentMode): void {
  const sendTab = $<HTMLButtonElement>("modalSendTab");
  const requestTab = $<HTMLButtonElement>("modalRequestTab");
  const sendPanel = $<HTMLElement>("modalSendPanel");
  const requestPanel = $<HTMLElement>("modalRequestPanel");
  const send = mode === "send";
  sendTab.setAttribute("aria-selected", String(send));
  requestTab.setAttribute("aria-selected", String(!send));
  sendPanel.hidden = !send;
  requestPanel.hidden = send;
  if (!send) {
    $<HTMLElement>("requestReceiveAddress").textContent = session?.unshieldedAddress ?? "Connect a wallet to see your address.";
    $<HTMLButtonElement>("copyRequestAddress").disabled = !session;
    updateCreateAvail();
    renderRequests();
  }
}

$<HTMLButtonElement>("copyRequestAddress").addEventListener("click", async (event) => {
  if (!session) return;
  const button = event.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(session.unshieldedAddress);
    button.textContent = "Copied";
    window.setTimeout(() => (button.textContent = "Copy receiving address"), 1400);
  } catch {
    button.textContent = "Copy failed";
    window.setTimeout(() => (button.textContent = "Copy receiving address"), 1400);
  }
});

function openPaymentModal(mode: PaymentMode, keepValues = false): void {
  if (!keepValues) {
    payCtx.hidden = true;
    if (mode === "send") {
      reviewedHandle = null;
      $<HTMLInputElement>("payHandle").value = "";
      $<HTMLInputElement>("payAddress").value = "";
      $<HTMLInputElement>("payAddressVerified").checked = false;
      $<HTMLInputElement>("payAmt").value = "";
      $<HTMLInputElement>("payAmt").readOnly = false;
    } else {
      $<HTMLInputElement>("reqLabel").value = "";
      $<HTMLInputElement>("reqAmt").value = "";
      setReqMode("open");
      setStatus($<HTMLDivElement>("reqStatus"), "hide");
    }
  }
  setPaymentMode(mode);
  paymentModal.hidden = false;
  document.body.classList.add("modal-open");
  const focusId = mode === "send" ? (REGISTRY_VERSION === 3 ? "payHandle" : "payAddress") : "reqLabel";
  window.setTimeout(() => $<HTMLInputElement>(focusId)?.focus(), 40);
}

function closePaymentModal(): void {
  paymentModal.hidden = true;
  document.body.classList.remove("modal-open");
}

$<HTMLButtonElement>("closePaymentModal").addEventListener("click", closePaymentModal);
$<HTMLButtonElement>("modalSendTab").addEventListener("click", () => openPaymentModal("send", true));
$<HTMLButtonElement>("modalRequestTab").addEventListener("click", () => openPaymentModal("request", true));
$<HTMLButtonElement>("openSendPayment").addEventListener("click", () => openPaymentModal("send"));
$<HTMLButtonElement>("openRequestPayment").addEventListener("click", () => openPaymentModal("request"));
paymentModal.addEventListener("click", (event) => {
  if (event.target === paymentModal) closePaymentModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !paymentModal.hidden) closePaymentModal();
  if (event.key === "Escape" && !qrModal.hidden) closeQrModal();
});
if (/\/login\/?$/.test(location.pathname) && !location.hash) location.hash = "#/login";

function route() {
  const hash = location.hash;
  // #/pay/<handle> is a shared payment link: the handle resolves on-chain and
  // lands on Send prefilled. The address is never trusted from the URL.
  const payMatch = hash.match(/^#\/pay\/(.+)$/);
  // Unknown route (custom 404): anything that is not the landing, an in-page anchor,
  // or a known app/pay/login route falls back to the landing instead of a blank shell.
  const known =
    hash === "" ||
    hash === "#" ||
    hash === "#/" ||
    hash.startsWith("#how") ||
    hash.startsWith("#faq") ||
    hash.startsWith("#main") ||
    hash.startsWith("#/app") ||
    hash.startsWith("#/login") ||
    payMatch !== null;
  if (!known) {
    location.hash = "#/"; // re-fires route()
    return;
  }
  const inApp = hash.startsWith("#/app") || hash.startsWith("#/login") || payMatch !== null;
  document.body.classList.toggle("app-route", inApp);
  for (const el of landingEls) el.hidden = inApp;
  appShell.hidden = !inApp;
  document.querySelector<HTMLElement>("footer")?.toggleAttribute("hidden", inApp); // no footer inside the app
  launchApp.hidden = inApp;
  connectBtn.hidden = true;
  syncWalletMenu();
  const netBadge = document.querySelector<HTMLElement>(".net");
  if (netBadge) netBadge.hidden = !inApp; // network badge only inside the app
  if (navlinks) navlinks.style.display = inApp ? "none" : "";
  if (!inApp) {
    document.body.classList.remove("app-gated");
    setTitle();
    return;
  }
  window.scrollTo(0, 0);
  const authed = !!session;
  const hasHandle = !!getHandle();
  const ready = authed && (hasHandle || payMatch !== null);
  document.body.classList.toggle("app-gated", !ready);
  // Two-step gate: connect the wallet, then register a handle. The app (nav + views)
  // only unlocks once both are done. The pay link's handle stays in the hash, so it
  // is re-applied after the wallet connects.
  loginGate.hidden = authed;
  handleGate.hidden = !(authed && !hasHandle && payMatch === null);
  // Gated (sign-in / register-handle) = minimal: hide the sidebar, center the one card.
  document.querySelector<HTMLElement>("#appShell .shell")?.classList.toggle("gated", !ready);
  sidenav.style.visibility = ready ? "visible" : "hidden";
  if (!ready) {
    for (const el of viewEls) el.hidden = true;
    setTitle(authed ? (CONTRACT_ADDRESS ? "Register your handle" : "Handle directory unavailable") : "Sign in");
    return;
  }
  if (payMatch) {
    // raw = "<handle>" or "<handle>?amt=<n>"; split off the query manually since the
    // whole thing lives in the fragment.
    const raw = payMatch[1];
    const qi = raw.indexOf("?");
    const handle = decodeURIComponent(qi >= 0 ? raw.slice(0, qi) : raw);
    const params = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : "");
    showView("dashboard");
    reviewedHandle = null;
    $<HTMLInputElement>("payHandle").value = REGISTRY_VERSION === 3 ? handle : "";
    $<HTMLInputElement>("payAddress").value = "";
    $<HTMLInputElement>("payAddressVerified").checked = false;
    const pa = $<HTMLInputElement>("payAmt");
    const amt = params.get("amt");
    pa.value = amt ?? "";
    pa.readOnly = false;
    pa.title = amt ? "Suggested amount from the shared link; verify it with the recipient" : "";
    // Shared-link context: who is being paid (and whether the amount is fixed).
    payCtx.innerHTML = REGISTRY_VERSION === 3
      ? `Paying <b>@${esc(handle)}</b>. Its receiving address will be read from the on-chain directory. Confirm the address with the recipient before approval.${amt ? ` Suggested amount: <b>${esc(amt)}</b>.` : ""}`
      : `This link names <b>@${esc(handle)}</b>, but the v2 directory has no tNIGHT address for that handle. Ask the recipient for their unshielded address and verify it separately.${amt ? ` Suggested amount: <b>${esc(amt)}</b>.` : ""}`;
    payCtx.hidden = false;
    openPaymentModal("send", true);
    return;
  }
  closePaymentModal();
  payCtx.hidden = true;
  showView(currentView());
}
window.addEventListener("hashchange", () => {
  route();
});

function revealApp() {
  for (const b of actionButtons) b.disabled = false;
  // Keep an existing #/app or #/pay target; otherwise land on the dashboard.
  if (location.hash.startsWith("#/app") || location.hash.startsWith("#/pay/")) route();
  else location.hash = "#/app/dashboard"; // fires route()
}

let connectInProgress = false;
async function doConnect(trigger: HTMLButtonElement) {
  if (connectInProgress) return;
  connectInProgress = true;
  const original = trigger.textContent;
  trigger.disabled = true;
  trigger.textContent = "Connecting...";
  setStatus(loginStatus, "loading", "Detecting Midnight wallet...");
  try {
    const wallets: Wallet[] = await waitForWallets();
    if (wallets.length === 0) throw new Error("No Midnight wallet detected. Open this page in Brave with 1AM enabled.");
    activeWallet = wallets.find((wallet) => /1am/i.test(`${wallet.id} ${wallet.name}`)) ?? wallets[0];
    session = await connect(activeWallet, log, (message) => setStatus(loginStatus, "loading", message));
    activeWalletAddress = await myUnshieldedAddress(session);
    stopIncomingActivityWatch?.();
    stopIncomingActivityWatch = watchUnshieldedTransactions(session, (indexed) => {
      if (!/success/i.test(indexed.status)) return;
      const address = activeWalletAddress.toLowerCase();
      const net = (utxos: typeof indexed.createdUtxos): bigint => utxos.reduce((total, utxo) => {
        if (utxo.owner.toLowerCase() !== address || utxo.tokenType.replace(/^0x/i, "").toLowerCase() !== session?.nativeTokenType) return total;
        try { return total + BigInt(utxo.value); } catch { return total; }
      }, 0n);
      const received = net(indexed.createdUtxos) - net(indexed.spentUtxos);
      if (received > 0n) addReceivedActivity(indexed.txHash, received, indexed.blockTimestamp ?? Date.now());
    });
    // Reconcile locally cached submissions with the indexer. A wallet return
    // value is not an explorer hash until this check resolves.
    if (CONTRACT_ADDRESS) {
      for (const entry of getActivity()) {
        if (entry.status !== "confirmed" && entry.submissionId) watchActivity(session, entry.id, entry.submissionId);
      }
    }
    const cachedHandle = getHandle();
    // The global registry is the source of truth. Local storage only caches the
    // display name plus browser-only request and activity UI data.
    setStatus(loginStatus, "loading", "Checking your registered handle...");
    let chainHandle: string | null = null;
    let lookupFailed = false;
    try {
      chainHandle = await registeredHandle(session);
    } catch (error) {
      lookupFailed = true;
      log(`Handle lookup unavailable: ${errMsg(error)}`);
      setStatus($<HTMLDivElement>("gateStatus"), "err", `Could not read the v${REGISTRY_VERSION} handle directory. Reconnect when the indexer responds.`);
    }
    if (chainHandle) saveHandle(chainHandle);
    else {
      try { localStorage.removeItem(walletCacheKey("handle")); } catch { /* ignore */ }
      if (cachedHandle) $<HTMLInputElement>("gateHandle").value = cachedHandle;
    }
    connectBtn.textContent = `Connected · ${activeWallet.name}`;
    setStatus(loginStatus, "hide");
    if (lookupFailed) {
      $<HTMLElement>("handleGateTitle").textContent = "Handle directory unavailable";
      $<HTMLElement>("handleGateCopy").textContent = `Your wallet is connected, but the v${REGISTRY_VERSION} directory could not be read yet.`;
      $<HTMLElement>("gateHandleField").hidden = true;
      $<HTMLButtonElement>("gateCreate").hidden = true;
    } else {
      $<HTMLElement>("handleGateTitle").textContent = "Register your handle";
      $<HTMLElement>("handleGateCopy").textContent = "Pick a handle so people can pay you. We check it is free, register it on-chain, and unlock the app.";
      $<HTMLElement>("gateHandleField").hidden = false;
      $<HTMLButtonElement>("gateCreate").hidden = false;
      setStatus($<HTMLDivElement>("gateStatus"), "hide");
    }
    syncWalletMenu();
    revealApp();
  } catch (e) {
    stopIncomingActivityWatch?.();
    stopIncomingActivityWatch = undefined;
    activeWallet = undefined;
    session = undefined;
    activeWalletAddress = "";
    trigger.textContent = original;
    log(`Connect failed: ${errMsg(e)}`);
    setStatus(loginStatus, "err", errMsg(e));
  } finally {
    connectInProgress = false;
    trigger.disabled = false;
    if (trigger !== connectBtn) trigger.textContent = original;
  }
}

connectBtn.addEventListener("click", () => doConnect(connectBtn));
$<HTMLButtonElement>("gateConnect").addEventListener("click", (ev) =>
  doConnect(ev.currentTarget as HTMLButtonElement),
);

// ---- onboarding: check availability, register on-chain, then unlock the app ----
$<HTMLButtonElement>("gateCreate").addEventListener("click", async () => {
  const st = $<HTMLDivElement>("gateStatus");
  const s = session;
  if (!s) return setStatus(st, "err", "Connect a wallet first.");
  const h = $<HTMLInputElement>("gateHandle").value.trim().toLowerCase();
  if (!h) return setStatus(st, "err", "Enter a handle.");
  const btn = $<HTMLButtonElement>("gateCreate");
  btn.disabled = true;
  setStatus(st, "loading", `Checking whether @${h} is free...`);
  try {
    const existing = await registeredHandle(s);
    if (existing) {
      saveHandle(existing);
      setStatus(st, "ok", `Welcome back. @${existing} is already registered to this wallet.`);
      location.hash = "#/app/dashboard";
      route();
      return;
    }
    const status = await handleStatus(s, h);
    if (status === "taken") {
      setStatus(st, "err", `@${h} is registered to a different wallet. Pick another one.`);
      return;
    }
    if (status === "mine") {
      // The handle is already registered to this wallet address; link it here
      // without submitting a duplicate transaction.
      saveHandle(h);
      setStatus(st, "ok", `Welcome back. @${h} is already yours. Opening the app...`);
      location.hash = "#/app/dashboard";
      route();
      return;
    }
    setStatus(st, "loading", `Registering @${h} on-chain (proof + submit, this can take a moment)...`);
    const submissionId = await register(s, h);
    const activityId = addActivity({ type: "register", handle: h, amount: null, txId: null, submissionId });
    setStatus(st, "loading", `Waiting for @${h} to be confirmed on-chain...`);
    const finalized = await waitForFinalizedTx(s, submissionId);
    if (!finalized) {
      setStatus(st, "loading", `@${h} was submitted but is still pending. Reconnect after it confirms; do not submit it again yet.`);
      return;
    }
    if (!/succeed|success|applied|confirmed/i.test(finalized.status)) {
      updateActivity(activityId, { status: "failed", submissionId });
      throw new Error(`Registration did not succeed: ${finalized.status}`);
    }
    updateActivity(activityId, { status: "confirmed", txId: finalized.txHash, submissionId });
    if (await registeredHandle(s) !== h) {
      setStatus(st, "loading", `@${h} confirmed. Waiting for the directory to sync; reconnect shortly.`);
      return;
    }
    saveHandle(h);
    setStatus(st, "ok", `@${h} is confirmed. Opening the app...`);
    location.hash = "#/app/dashboard";
    route();
  } catch (e) {
    setStatus(st, "err", errMsg(e));
  } finally {
    btn.disabled = false;
  }
});
route();
const landingPreview = document.getElementById("landingPreviewRoot");
if (landingPreview) mountLandingPreview(landingPreview);

// Cycle the decorative handle example gently; keep it still for reduced motion.
const rollName = document.getElementById("rollName");
const handleMotionPreference = matchMedia("(prefers-reduced-motion: reduce)");
if (rollName && !handleMotionPreference.matches) {
  const handleExamples = ["zeep", "maya", "raka", "nara"];
  let handleExampleIndex = 0;
  setInterval(() => {
    if (document.hidden || handleMotionPreference.matches) return;
    rollName.classList.add("out");
    window.setTimeout(() => {
      handleExampleIndex = (handleExampleIndex + 1) % handleExamples.length;
      rollName.textContent = handleExamples[handleExampleIndex];
      rollName.classList.remove("out");
    }, 280);
  }, 3200);
}

// Prevent double-submit: ignore repeat clicks while a tx is in flight and disable
// the button, so a payment or registration can never be sent twice by a fast click.
const inFlight = new Set<string>();
async function submitOnce(key: string, btn: HTMLButtonElement, fn: () => Promise<void>): Promise<void> {
  if (inFlight.has(key)) return;
  inFlight.add(key);
  btn.disabled = true;
  try {
    await fn();
  } finally {
    inFlight.delete(key);
    btn.disabled = false;
  }
}

// Registration happens once per receiving address in the onboarding gate. There
// is no re-register control in the app.

// ---- unshielded tNIGHT payment (recipient needs no claim step) ----
const payStatus = $<HTMLDivElement>("payStatus");
$<HTMLButtonElement>("doPay").addEventListener("click", () =>
  submitOnce("pay", $<HTMLButtonElement>("doPay"), async () => {
    const s = requireSession(payStatus);
    if (!s) return;
    const handle = REGISTRY_VERSION === 3 ? $<HTMLInputElement>("payHandle").value.trim().replace(/^@/, "").toLowerCase() : "";
    let address = $<HTMLInputElement>("payAddress").value.trim();
    const amtRaw = $<HTMLInputElement>("payAmt").value.trim();
    if (REGISTRY_VERSION === 3 && !handle) return setStatus(payStatus, "err", "Enter a recipient handle.");
    if (REGISTRY_VERSION !== 3 && !address) return setStatus(payStatus, "err", "Enter a recipient unshielded Preprod address.");
    if (handle && address) return setStatus(payStatus, "err", "Use either a handle or an address for this payment.");
    let amount: bigint;
    try { amount = parseTokenAmount(amtRaw); }
    catch (e) { return setStatus(payStatus, "err", errMsg(e)); }
    const displayAmount = formatTokenAmount(amount);
    try {
      if (handle) {
        setStatus(payStatus, "loading", `Resolving @${handle} on-chain...`);
        const resolved = await recipientAddress(s, handle);
        if (!resolved) throw new Error(`@${handle} is not registered in this directory.`);
        address = resolved;
        if (reviewedHandle?.handle !== handle || reviewedHandle.address !== address) {
          reviewedHandle = { handle, address };
          payCtx.textContent = `@${handle} resolves to ${address}. Verify this address with the recipient, check the box, then press Send again.`;
          payCtx.hidden = false;
          $<HTMLInputElement>("payAddressVerified").checked = false;
          return setStatus(payStatus, "ok", `Address for @${handle} loaded. Review it before sending.`);
        }
      }
      if (!$<HTMLInputElement>("payAddressVerified").checked) {
        return setStatus(payStatus, "err", "Confirm the recipient's receiving address with them, then check the confirmation box.");
      }
      setStatus(payStatus, "loading", "Checking spendable unshielded tNIGHT...");
      const balance = await unshieldedPaymentBalance(s);
      if (!balance || balance[1] < amount) {
        throw new Error(`1AM reports ${formatTokenAmount(balance?.[1] ?? 0n)} spendable unshielded tNIGHT; this payment needs ${displayAmount}.`);
      }
      setStatus(payStatus, "loading", "Approve this exact address and amount in 1AM. It may submit immediately after approval; do not retry while pending.");
      const submissionId = await sendToUnshielded(s, address, amount);
      const activityId = addActivity({ type: "pay", handle: handle || null, recipientAddress: address, amount: displayAmount, txId: null, submissionId });
      watchActivity(s, activityId, submissionId);
      setStatus(payStatus, "ok", `Submitted ${displayAmount} tNIGHT to ${handle ? `@${handle} (${address.slice(0, 18)}…${address.slice(-8)})` : `${address.slice(0, 18)}…${address.slice(-8)}`}. Wait for network confirmation and check the recipient's unshielded balance.`);
      await refreshBalance();
    } catch (e) {
      // A stale DUST proof poisons the current connector session. Drop the
      // session before showing the error so the next attempt cannot reuse it.
      if (/custom error:\s*170\b|SubmissionError|FiberFailure/i.test(e instanceof Error ? e.message : String(e))) {
        await disconnectWallet();
      }
      setStatus(payStatus, "err", errMsg(e));
    }
  }),
);

// ---- hero handle CTA: go to the app (sign-in), carry the handle for Register ----
$<HTMLButtonElement>("heroClaim").addEventListener("click", () => {
  const h = $<HTMLInputElement>("heroHandle").value.trim();
  // Carry the typed handle into the onboarding gate (registration lives there now).
  if (h) $<HTMLInputElement>("gateHandle").value = h;
  location.hash = "#/app/dashboard";
});

log("ZEEP ready. Connect a Midnight wallet to register or pay.");
setInterval(() => {
  if (session && !document.hidden && currentView() === "dashboard") void refreshBalance();
}, 30_000);

// ---- header elevation on scroll (sticky hierarchy cue, R-12) ----
const topbar = document.querySelector<HTMLElement>("header.top");
addEventListener("scroll", () => topbar?.classList.toggle("scrolled", scrollY > 8), { passive: true });

// ---- scroll reveals (MOTION 2, fired once; CSS shows content when JS is off) ----
if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const targets: HTMLElement[] = [];
  // Note: the hero ledger card is above the fold, so it is NOT a reveal target -- it
  // must be visible immediately, not faded in on scroll.
  for (const sel of [".flow .flowstep", ".whofor .who", ".ctacard", ".faqitem", ".herocard", ".view .panel", "#loginGate", "#handleGate"]) {
    [...document.querySelectorAll<HTMLElement>(sel)].forEach((el, i) => {
      el.classList.add("reveal");
      if (i % 3) el.setAttribute("data-d", String(i % 3));
      targets.push(el);
    });
  }
  const revealIo = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        revealIo.unobserve(e.target);
      }
    }
  }, { threshold: 0.15 });
  for (const el of targets) revealIo.observe(el);
}

// ---- FAQ accordion: smooth grid-rows open/close; native <button> = keyboard-operable ----
for (const item of document.querySelectorAll<HTMLElement>(".faqitem")) {
  const btn = item.querySelector<HTMLButtonElement>(".faqq");
  const answer = item.querySelector<HTMLElement>(".faqa");
  btn?.addEventListener("click", () => {
    if (!answer) return;
    answer.style.height = `${answer.getBoundingClientRect().height}px`;
    const open = item.classList.toggle("open");
    btn.setAttribute("aria-expanded", String(open));
    requestAnimationFrame(() => { answer.style.height = open ? `${answer.scrollHeight}px` : "0px"; });
  });
  if (answer) new ResizeObserver(() => {
    if (item.classList.contains("open")) answer.style.height = `${answer.scrollHeight}px`;
  }).observe(answer.firstElementChild!);
}
