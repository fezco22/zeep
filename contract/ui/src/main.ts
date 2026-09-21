import { detectWallets, deployZeep, type Wallet, type Logger } from "./deploy";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const walletSel = $<HTMLSelectElement>("wallet");
const connectBtn = $<HTMLButtonElement>("connect");
const deployBtn = $<HTMLButtonElement>("deploy");
const statusVal = $<HTMLSpanElement>("statusVal");
const logEl = $<HTMLPreElement>("log");
const resultCard = $<HTMLDivElement>("result");
const addrEl = $<HTMLDivElement>("addr");

let wallets: Wallet[] = [];
let selected: Wallet | undefined;

const log: Logger = (line) => {
  const ts = new Date().toISOString().slice(11, 19);
  logEl.textContent += `[${ts}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
};

function setStatus(s: string) {
  statusVal.textContent = s;
}

function refreshWallets() {
  wallets = detectWallets();
  walletSel.innerHTML = "";
  if (wallets.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No Midnight wallet detected";
    walletSel.appendChild(opt);
    connectBtn.disabled = true;
    return;
  }
  for (const w of wallets) {
    const opt = document.createElement("option");
    opt.value = w.id;
    opt.textContent = `${w.name} (${w.id})`;
    walletSel.appendChild(opt);
  }
  selected = wallets[0];
  connectBtn.disabled = false;
}

walletSel.addEventListener("change", () => {
  selected = wallets.find((w) => w.id === walletSel.value);
});

connectBtn.addEventListener("click", () => {
  if (!selected) return;
  deployBtn.disabled = false;
  setStatus(`ready — ${selected.name}`);
  log(`Selected wallet: ${selected.name}. Click "Deploy ZEEP" to proceed.`);
});

deployBtn.addEventListener("click", async () => {
  if (!selected) return;
  deployBtn.disabled = true;
  connectBtn.disabled = true;
  setStatus("deploying...");
  try {
    const address = await deployZeep(selected, log);
    setStatus("deployed ✓");
    addrEl.textContent = address;
    resultCard.classList.remove("hidden");
    try {
      localStorage.setItem(
        "zeep.deployed",
        JSON.stringify({ network: "preprod", contractAddress: address, deployedAt: new Date().toISOString() }),
      );
    } catch {
      /* localStorage may be blocked; the address is shown on-screen regardless */
    }
  } catch (err) {
    setStatus("failed ✗");
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    log(`ERROR: ${msg}`);
    if (err instanceof Error && err.stack) log(err.stack);
    deployBtn.disabled = false;
    connectBtn.disabled = false;
  }
});

// Wallets inject asynchronously after page load; poll briefly until one appears.
refreshWallets();
let tries = 0;
const poll = setInterval(() => {
  tries += 1;
  if (wallets.length === 0) refreshWallets();
  if (wallets.length > 0 || tries > 20) clearInterval(poll);
}, 500);

log("ZEEP deploy console ready. Detecting Midnight wallets...");
