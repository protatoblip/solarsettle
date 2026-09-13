# ☀️ SolarSettle

**A blockchain-based transparent settlement layer for subsidized solar energy in India.**

SolarSettle lets a government/DISCOM verify in real time that subsidized solar panels
(PM-KUSUM, rooftop schemes) actually generate power, scores each prosumer's reliability
on-chain, and settles peer-to-peer energy trades atomically through a smart contract.

**Live demo:** http://localhost:3000 (after local deploy — see Quickstart)

---

## How it works

Wallet-based — no passwords, no sign-up forms. When you connect your wallet, your role is
**resolved from the smart contract itself**:

| Role | Who | Route |
|---|---|---|
| **Government** | The wallet that deployed the contract (`owner()`) | `/govt` |
| **Prosumer** | Wallets with an approved on-chain panel registration | `/prosumer` |
| **Buyer** | Any other wallet | `/buyer` |

**Role resolution logic** (in `src/context/Web3Context.js`):
1. `msg.sender == owner()` → Government
2. `prosumers(msg.sender).registered == true` → Prosumer
3. `prosumers(msg.sender).pendingApproval == true` → Prosumer (shows "awaiting approval" state)
4. Otherwise → Buyer

**User journey:** Landing page (public, live marketplace preview) → Login (wallet connect,
role auto-detected) → Role-specific dashboard.

---

## Architecture

```
contracts/
  SolarSettle.sol          Registry, trust scores, marketplace (Solidity 0.8.28)
scripts/
  deploy.ts                Deploys + auto-syncs address & ABI into frontend/src
test/
  SolarSettle.test.ts      10-test Hardhat suite (roles, scoring, marketplace)

frontend/src/
  App.js                   react-router shell (/, /login, /prosumer, /buyer, /govt)
  config.js                Contract address + chain metadata
  deployedAddress.json     Auto-written by deploy.ts — never edit manually
  SolarSettleABI.json      Auto-written by deploy.ts
  context/Web3Context.js   Wallet connection, on-chain role resolution
  hooks/useTx()            Transaction lifecycle (pending → confirm → toast)
  lib/contractReads.js     Read-only market data + purchase history from events
  lib/meterSimulator.js    Simulated smart-meter feed (replace with oracle in prod)
  components/Navbar        Shared top nav
  components/ProtectedRoute Role-based route guard
  components/TiltCard       3D tilt-on-hover card
  pages/LandingPage         Public hero + live marketplace preview + stats
  pages/LoginPage           Wallet sign-in with role explanation
  pages/dashboards/
    GovtDashboard           Approvals queue, registry monitoring, fraud flags
    ProsumerDashboard       Register, log readings, trust/carbon stats, list energy
    BuyerDashboard          Marketplace, buy, on-chain purchase history
```

### Contract functions

| Function | Access | Purpose |
|---|---|---|
| `transferOwnership(addr)` | Owner only | Hand government seat to a multisig |
| `registerProsumer(id, capacity, loc)` | Public | Register a panel (starts as pending) |
| `approveProsumer(addr)` | Owner only | Approve a pending registration |
| `logEnergyGeneration(kWh)` | Registered prosumers | Log a reading, gain trust + carbon credit |
| `checkInactivity(addr)` | Public | Penalize a silent panel (once per 7-day window) |
| `listEnergy(kWh, price)` | Registered prosumers | List surplus energy for sale |
| `cancelListing(id)` | Seller | Cancel own listing |
| `buyEnergy(id)` payable | Public | Buy a listing (auto-refunds overpayment) |
| `getActiveListings(offset, limit)` | View | Paginated active listings |
| `platformStats()` | View | Total kWh, listings, active, registered count |
| `getProsumer(addr)` | View | Full prosumer record |

---

## Quickstart (local)

```bash
# Terminal 1 — local chain (10 funded test accounts)
npm run node

# Terminal 2 — deploy (rewrites frontend/src/deployedAddress.json automatically)
npm run deploy:local

# Terminal 3 — frontend
cd frontend
npm install
npm start            # http://localhost:3000
```

In MetaMask, add a custom network:
- **RPC:** `http://127.0.0.1:8545`
- **Chain ID:** `31337`
- **Currency:** ETH

Then import test accounts using the private keys printed by `npm run node`.

**Full test loop:**
1. Import **deployer key** → login → **Government** dashboard (at `/govt`)
2. Import **2nd key** → login → **Buyer** → go to `/prosumer` → register a panel
3. Switch to **Government** account → approve the pending registration
4. Switch back to **2nd key** → now a **Prosumer** → log readings, list energy
5. Import **3rd key** → **Buyer** → purchase from the marketplace

> **Note:** if you restart `npm run node`, the chain state resets. Re-run
> `npm run deploy:local` and refresh the browser — otherwise the contract address
> won't match and every login falls back to Buyer.

### Testnet deploy

```bash
# Create .env in project root
PRIVATE_KEY=0x...

npm run deploy:amoy   # Polygon Amoy
```

`deploy.ts` rewrites `frontend/src/deployedAddress.json` and the ABI on every deploy.

**Networks in `hardhat.config.ts`:** `amoy` (Polygon Amoy), `monadTestnet` (Monad).
Add a new network there and run `npm run deploy:<name>`.

---

## Commands

### Root (Hardhat)

| Command | Purpose |
|---|---|
| `npm run compile` | Compile contracts |
| `npm test` | Run the 10-test suite |
| `npm run node` | Local Hardhat chain (10 funded accounts) |
| `npm run deploy:local` | Deploy to local chain |
| `npm run deploy:amoy` | Deploy to Polygon Amoy |

### Frontend

| Command | Purpose |
|---|---|
| `cd frontend && npm start` | Dev server on :3000 |
| `cd frontend && npm run build` | Production bundle |
| `cd frontend && npm test` | Run React tests |

### SMTP alerts

Copy `.env.example` to `.env`, set the SMTP credentials and `ALERT_RECIPIENTS`, then run this alongside the frontend:

```bash
npm run alerts:server
```

The mailer receives no SMTP credential from the browser. It sends SMTP alerts for government monitoring signals (including simulated fraud data), simulated prosumer actions, MetaMask connection/network changes, and confirmed, rejected, or failed MetaMask transactions. Email delivery is best-effort and never delays a transaction or simulation.

To see the SMTP formatting without configuring a mailbox, run `npm.cmd run alerts:demo`. It uses an ephemeral Ethereal SMTP account and prints preview URLs for one simulated-meter alert and one MetaMask settlement alert.

---

## Key design decisions

- **Approval-gated registration** — prosumers can't log energy or sell until the
  government approves them on-chain. No trusted backend needed.
- **Physically-plausible readings** — a single reading is capped at
  `panelCapacity × 24h`. Fraudulent readings revert instead of farming trust score.
- **Trust score** — starts at 70, +2 per logged reading (cap 100), −20 for 7+ days
  of silence. `checkInactivity` is penalizable **once per window** — anyone can call
  it, but it can't be spammed to drain a score to zero.
- **Safe marketplace** — checks-effects-interactions ordering, `nonReentrant` guard,
  `.call`-based payouts, automatic overpayment refunds, seller-cancellable listings.
- **Carbon credits** — 1 credit per verified kWh, on the same immutable ledger.
- **Role resolution on-chain** — no database, no cookies. Switch MetaMask accounts
  and the app re-resolves your role automatically.

---

## Known limitations

- **Meter data is self-reported.** A real deployment needs an oracle feeding
  signed data from physical smart meters. The simulated meter (`lib/meterSimulator.js`)
  marks where that integration goes.
- **Carbon credits are counters**, not ERC-20 tokens — they can't be transferred
  or retired yet.
- **No partial fills** — listings are all-or-nothing.
- This codebase has **not had an independent audit**.

---

## Roadmap

- ERC-20 carbon credits (transferable / retirable)
- Meter oracle integration (IoT gateway signing readings)
- Partial fills and time-bound listings
- The Graph subquery for historical analytics
- Gas-optimized events for cheaper logging
