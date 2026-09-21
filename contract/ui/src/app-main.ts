import {
  detectWallets,
  connect,
  register,
  pay,
  claim,
  readLedger,
  CONTRACT_ADDRESS,
  type Session,
  type Wallet,
  type ClaimCode,
} from "./zeep-app";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const logEl = $<HTMLPreElement>("log");
const log = (line: string) => {
  const ts = new Date().toISOString().slice(11, 19);
  logEl.textContent += `[${ts}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
};

let session: Session | undefined;

// ---- theme (light default; dark toggle for crypto users, R-21) ----
const themeBtn = $<HTMLButtonElement>("theme");
const applyTheme = (t: string) => {
  document.documentElement.setAttribute("data-theme", t);
  themeBtn.textContent = t === "dark" ? "Light" : "Dark";
};
try {
  applyTheme(localStorage.getItem("zeep.theme") ?? "light");
} catch {
  applyTheme("light");
}
themeBtn.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("zeep.theme", next);
  } catch {
    /* ignore */
  }
});

// ---- tabs (real state toggle, keyboard-operable) ----
const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tab")];
function selectTab(tab: HTMLButtonElement) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    const panel = document.getElementById(t.getAttribute("aria-controls")!)!;
    panel.hidden = !on;
  }
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => selectTab(t));
  t.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      selectTab(next);
    }
  });
});

// ---- status helpers (empty / loading / ok / error states, R-27) ----
function setStatus(el: HTMLElement, kind: "loading" | "ok" | "err" | "hide", msg = "") {
  el.className = "status" + (kind === "ok" ? " ok" : kind === "err" ? " err" : "");
  el.hidden = kind === "hide";
  el.textContent = msg;
}
function errMsg(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

// ---- connect ----
const connectBtn = $<HTMLButtonElement>("connect");
const actionButtons = ["doPay", "doClaim", "doRegister", "refreshLedger"].map((id) =>
  $<HTMLButtonElement>(id),
);

function requireSession(statusEl: HTMLElement): Session | undefined {
  if (!session) {
    setStatus(statusEl, "err", "Connect a Midnight wallet on Preprod first.");
    return undefined;
  }
  return session;
}

connectBtn.addEventListener("click", async () => {
  const wallets: Wallet[] = detectWallets();
  if (wallets.length === 0) {
    connectBtn.textContent = "No Midnight wallet found";
    log("No injected Midnight wallet (window.midnight). Install 1AM or Lace for Preprod.");
    return;
  }
  connectBtn.disabled = true;
  connectBtn.textContent = "Connecting...";
  try {
    session = await connect(wallets[0], log);
    connectBtn.textContent = `Connected · ${wallets[0].name}`;
    for (const b of actionButtons) b.disabled = false;
    await loadLedger();
  } catch (e) {
    connectBtn.disabled = false;
    connectBtn.textContent = "Connect wallet";
    log(`Connect failed: ${errMsg(e)}`);
  }
});

// ---- register ----
const regStatus = $<HTMLDivElement>("regStatus");
$<HTMLButtonElement>("doRegister").addEventListener("click", async () => {
  const s = requireSession(regStatus);
  if (!s) return;
  const user = $<HTMLInputElement>("regUser").value.trim();
  if (!user) return setStatus(regStatus, "err", "Enter a handle to register.");
  setStatus(regStatus, "loading", "Generating zero-knowledge proof and submitting, this can take a moment...");
  try {
    const tx = await register(s, user);
    setStatus(regStatus, "ok", `Registered @${user}. tx ${tx}`);
  } catch (e) {
    setStatus(regStatus, "err", errMsg(e));
  }
});

// ---- pay ----
const payStatus = $<HTMLDivElement>("payStatus");
const payCode = $<HTMLDivElement>("payCode");
const payCodeVal = $<HTMLSpanElement>("payCodeVal");
let lastCode = "";
$<HTMLButtonElement>("doPay").addEventListener("click", async () => {
  const s = requireSession(payStatus);
  if (!s) return;
  const user = $<HTMLInputElement>("payUser").value.trim();
  const amtRaw = $<HTMLInputElement>("payAmt").value.trim();
  const amount = BigInt(Math.trunc(Number(amtRaw)) || 0);
  if (!user) return setStatus(payStatus, "err", "Enter the recipient handle.");
  if (amount <= 0n) return setStatus(payStatus, "err", "Enter an amount greater than zero.");
  payCode.hidden = true;
  setStatus(payStatus, "loading", "Proving and submitting the private payment...");
  try {
    const code: ClaimCode = await pay(s, user, amount);
    lastCode = btoa(JSON.stringify(code));
    payCodeVal.textContent = lastCode;
    payCode.hidden = false;
    setStatus(payStatus, "ok", `Paid @${user}. Note recorded on-chain, amount stayed private.`);
    await loadLedger();
  } catch (e) {
    setStatus(payStatus, "err", errMsg(e));
  }
});
$<HTMLButtonElement>("copyCode").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(lastCode);
    $<HTMLButtonElement>("copyCode").textContent = "Copied";
    setTimeout(() => ($<HTMLButtonElement>("copyCode").textContent = "Copy claim code"), 1500);
  } catch {
    log("Clipboard blocked; select the code manually.");
  }
});

// ---- claim (crescent -> full reveal on success, MOTION 1) ----
const claimStatus = $<HTMLDivElement>("claimStatus");
$<HTMLButtonElement>("doClaim").addEventListener("click", async () => {
  const s = requireSession(claimStatus);
  if (!s) return;
  const raw = $<HTMLTextAreaElement>("claimCode").value.trim();
  let code: ClaimCode;
  try {
    code = JSON.parse(atob(raw)) as ClaimCode;
    if (!code.commitment || !code.amount || !code.salt) throw new Error("missing fields");
  } catch {
    return setStatus(claimStatus, "err", "That claim code is not valid. Paste the exact code from the payer.");
  }
  setStatus(claimStatus, "loading", "Proving ownership and submitting the claim...");
  try {
    const tx = await claim(s, code);
    setStatus(claimStatus, "ok", `Claimed. The nullifier is published, a second claim is now blocked. tx ${tx}`);
    const arc = document.getElementById("brandArc");
    if (arc) arc.setAttribute("d", "M11 2 a9 9 0 0 1 0 18 a9 9 0 0 0 0 -18"); // fill to full disc
    await loadLedger();
  } catch (e) {
    setStatus(claimStatus, "err", errMsg(e));
  }
});

// ---- ledger (live counts; loading / empty / error states) ----
const ledgerBody = $<HTMLDivElement>("ledgerBody");
function renderLedger(html: string) {
  ledgerBody.innerHTML = html;
}
async function loadLedger() {
  if (!session) {
    renderLedger('<div class="empty">Connect a wallet to read the contract state.</div>');
    return;
  }
  renderLedger('<div class="empty">Reading contract state from the indexer...</div>');
  try {
    const l = await readLedger(session);
    if (l.usernames === 0 && l.noteCount === 0n) {
      renderLedger(
        '<div class="empty">No handles or notes yet. Register a handle, then pay it to create the first note.</div>',
      );
      return;
    }
    renderLedger(
      `<div class="kv"><span class="k">registered handles</span><span class="v">${l.usernames}</span></div>` +
        `<div class="kv"><span class="k">notes created (volume only)</span><span class="v">${l.noteCount}</span></div>` +
        `<div class="kv"><span class="k">open commitments</span><span class="v">${l.commitments.length}</span></div>` +
        `<div class="kv"><span class="k">contract</span><span class="v mono">${CONTRACT_ADDRESS}</span></div>`,
    );
  } catch (e) {
    renderLedger(`<div class="status err">Could not read the indexer: ${errMsg(e)}</div>`);
  }
}
$<HTMLButtonElement>("refreshLedger").addEventListener("click", loadLedger);

// ---- verify link: real indexer query, result shown inline (R-26) ----
$<HTMLAnchorElement>("verify").addEventListener("click", async (e) => {
  e.preventDefault();
  const q = {
    query: `query{contractAction(address:"${CONTRACT_ADDRESS}"){__typename address}}`,
  };
  try {
    const r = await fetch("https://indexer.preprod.midnight.network/api/v4/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(q),
    });
    const j = await r.json();
    log(`indexer: ${JSON.stringify(j.data?.contractAction ?? j)}`);
  } catch (err) {
    log(`indexer verify failed: ${errMsg(err)}`);
  }
});

// ---- hero handle claim: jump to the Register tab, prefill, and focus ----
$<HTMLButtonElement>("heroClaim").addEventListener("click", () => {
  const h = $<HTMLInputElement>("heroHandle").value.trim();
  selectTab($<HTMLButtonElement>("tab-register"));
  const reg = $<HTMLInputElement>("regUser");
  if (h) reg.value = h;
  document.getElementById("app")?.scrollIntoView({ behavior: "smooth" });
  reg.focus();
});

log("ZEEP ready. Connect a Midnight wallet (Preprod) to register, pay, or claim.");
