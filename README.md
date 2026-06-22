# Cell

Try it here: [celll.exe.xyz](https://celll.exe.xyz/)

Example cells:

- [chucky888@cell](https://celll.exe.xyz/chucky888)
- [coco@cell](https://celll.exe.xyz/coco)

More gallery examples will be added over time.

Cell (`cell.sui`) is personal, infinite* generative art funded by micropayments. Each user names a cell, receives an addressable identity under the `cell.sui` namespace, and watches that cell grow as long as it has heartbeats.

A cell has its own name, account, memory, and living drawing. As it grows, it adds rectilinear segments to the canvas and remembers that growth over time. One cent of USDC in the cell account equals one heartbeat; heartbeats power both visual expansion and persistence.

Anyone can fund a cell if they know its name, such as `adeniyi@cell`. That makes each cell a small onchain/offchain object: named through SuiNS, funded through Sui assets, rendered in the browser, and backed up through MemWal.

## How It Works

- A user onboards by choosing a `name.cell.sui` name.
- The cell is associated with a Sui account and can be funded with native Sui USDC.
- The UI reads heartbeat balance from Sui: `1 heartbeat = 0.01 USDC`.
- Growth appears as rectilinear visual segments on a canvas.
- The running growth state can be remembered and recalled through MemWal.
- Cells are addressable by human-readable names, so another user can fund a friend's cell by name instead of by raw address.

The production project combines SuiNS, Sui accounts, gasless USDC micropayments, generative art, persistent memory, and MemWal into a living organism: a named cell that can keep growing as long as it is funded.

## Hackathon Submission

This submission is about a real, self-contained, operational project. The hosted deployment demonstrates the working product, and this repository contains a sanitized MVP implementation that shows the Sui and MemWal integration points without disclosing sensitive server details.

Included here:

- Browser onboarding and local cell growth UI.
- Client-side Sui SDK reads for heartbeat balance using native Sui USDC.
- Server-side SuiNS lookups for `*.cell.sui` names and owner records.
- Optional MemWal remember/recall endpoints for persisted growth snapshots.

Intentionally omitted from this public repository:

- Production custody details.
- Registration transaction construction.
- Funding transaction internals.
- Private server configuration.
- Private generative-growth internals.

The included flow stores a local demo cell after name selection so the interface can be run end-to-end while keeping those production details out of the hackathon repository.

Future expansion can add game mechanics, rewards, richer visual progression, and more autonomous behavior for named cells with memory.

## Run Locally

```sh
npm install
npm start
```

Open http://localhost:3000.

If port `3000` is already in use:

```sh
PORT=3015 npm start
```

## API Sample

```txt
GET  /api/health
GET  /api/name/:name
GET  /api/owner/:address/cell-names
GET  /api/address/:address/heartbeats
GET  /api/memwal/status?fqdn=name.cell.sui
GET  /api/cell/:fqdn/memwal
POST /api/cell/:fqdn/memwal
```

MemWal writes are optional. Set these environment variables to enable them:

```sh
MEMWAL_ACCOUNT_ID=...
MEMWAL_PRIVATE_KEY=...
MEMWAL_SERVER_URL=https://relayer.memwal.ai
```

## Resources

- Live app: [celll.exe.xyz](https://celll.exe.xyz/)
- SuiNS names are displayed in the app as handles like `adeniyi@cell`.
- Heartbeats represent spendable growth capacity: `1 cent USDC = 1 heartbeat`.

## Common Questions

**Is this only a mockup?**  
No. The hosted project is operational. This repository is a public hackathon version with sensitive implementation details removed.

**Why are some implementation details missing?**  
The public repo is meant to show the architecture and integrations without exposing production custody, funding, or private growth logic.

**Can someone else fund my cell?**  
Yes. The design uses addressable cell names so a user can fund another cell by name, not just by raw wallet address.
