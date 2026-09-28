import "./polyfills";
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
let connectedApi: DAppConnectorConnectedAPI | undefined;
let connectedWalletId = "";

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
    setStatus("No Midnight wallet detected. Open this page in Brave with 1AM enabled.");
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
  connectedApi = undefined;
  connectedWalletId = "";
  deployBtn.disabled = true;
  setStatus("Wallet selected. Connect to continue.");
});

connectBtn.addEventListener("click", async () => {
  if (!selected) return;
  const wallet = selected;
  connectBtn.disabled = true;
  deployBtn.disabled = true;
  setStatus("connecting...");
  log(`Connecting to ${wallet.name} on preprod...`);
  try {
    const api = await wallet.api.connect("preprod");
    const status = await api.getConnectionStatus();
    const config = await api.getConfiguration();
    const network = String(config.networkId ?? status.networkId ?? "");
    if (network !== "preprod") throw new Error(`1AM connected to ${network || "an unknown network"}. Switch to Preprod and reconnect.`);
    if (selected?.id !== wallet.id) return;
    connectedApi = api;
    connectedWalletId = wallet.id;
    deployBtn.disabled = false;
    setStatus("ready to deploy v3 on Preprod");
    log(`Connected to ${wallet.name} on ${network}. V3 resolves handles to unshielded addresses; registration ownership is checked by this UI, not enforced on-chain.`);
  } catch (err) {
    connectedApi = undefined;
    connectedWalletId = "";
    setStatus("connection failed");
    log(`Connect failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    connectBtn.disabled = false;
  }
});

deployBtn.addEventListener("click", async () => {
  if (!selected || !connectedApi || connectedWalletId !== selected.id) return;
  deployBtn.disabled = true;
  connectBtn.disabled = true;
  setStatus("deploying...");
  try {
    const address = await deployZeep(selected, log, connectedApi);
    setStatus("deployed ✓");
    addrEl.textContent = address;
    resultCard.classList.remove("hidden");
    try {
      localStorage.setItem(
        "zeep.deployed",
        JSON.stringify({ version: "v3", network: "preprod", contractAddress: address, deployedAt: new Date().toISOString() }),
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
