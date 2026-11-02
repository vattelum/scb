# The Smart Contract Block — Legal Context for Ethereum Smart Contracts

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.31-363636.svg)](https://soliditylang.org)
[![Foundry Tests](https://img.shields.io/badge/Foundry_Tests-249_passing-brightgreen.svg)](https://getfoundry.sh)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-Frontend-FF3E00.svg)](https://kit.svelte.dev)

The Smart Contract Block (SCB) merges on-chain law and smart contracts into binding legal agreements.

It gives any blockchain project, entrepreneur, or decentralized network the ability to associate blockchain transactions with real goods, services, rights, and duties.

Combining the SCB with the law-making abilities developed by the Vattelum project, this opens the door to a new phase of the blockchain-based economy.

Part of the [Vattelum](https://github.com/vattelum) ecosystem.

### Highlight Video

https://github.com/user-attachments/assets/35c52245-38ce-4241-b706-fdb070fd31ef

## Why do we need the Smart Contract Block?

The world is governed by laws, not ledger entries.

On their own, smart contracts do not bind anyone. They need legal context. Without it, the most important promise of blockchain technology, a peer-to-peer economy, cannot happen.

The SCB offers smart contracts legal context. It turns (bottom-up) decentralized laws into legally binding contracts, opening the door to new methods for blockchain-based cooperation and self-regulation.

## How to turn decentralized law into a binding agreement

Just like any other contract, the SCB is an agreement between two or more parties.

Contracting parties select a template and governing laws from the DAA registry. They fill in the required variables (party names, dates, terms, smart contract details) and submit.

The contract text is hashed (SHA-256) and encrypted with ECIES. The encrypted blob is uploaded to [Arweave](https://arweave.org) for permanent storage; once Arweave confirms the upload, the hash and the storage pointer are recorded on-chain.

Every signatory can decrypt the legal contract in their browser using their wallet. They then sign the contract using an EIP-712 structured signature. Once all signatories have signed, the contract becomes Active.

The signed contract can now be printed as PDF. The printed version contains governing legislation, and a verification appendix listing the content hash, every signature, every legal reference (with clickable Etherscan and Arweave links), and the full lifecycle timeline of the engagement.

The result is an end-to-end system that creates blockchain-based laws and turns them into binding agreements: the legal texts and templates are written and voted on by members, the contracts are freely selected by the signatories, the proof of consent is independently auditable, and no third-party can control or read the contracts.

## Blockchain infrastructure

The SCB extends the [DAA](https://github.com/vattelum/daa) decentralized law-making deployment with contract-making abilities, while re-using the existing membership and governance infrastructure:

1. **Membership** — The same soulbound `DAAToken` used by the DAA. Individuals need to be token holders to create and sign contracts (frontend enforced only; the on-chain gate is creator-only by design, leaving room for non-UI counterparties in future iterations).

2. **Contract registry** — A new `ContractRegistry` smart contract on **Ethereum** records every contract's content hash, signatories, EIP-712 signatures, governing law references, encrypted Arweave TX IDs, lifecycle events, and status. Independent of the DAA's legislation registry.

3. **Encryption key registry** — A standalone `PubkeyRegistry` smart contract stores each member's secp256k1 encryption pubkey (separate from the wallet's transaction-signing key, derived deterministically from an EIP-712 wallet signature). This makes the in-browser ECIES flow possible without anyone exchanging files.

4. **Permanent encrypted storage** — Encrypted contract bodies are uploaded to [Arweave](https://arweave.org) via [ArDrive Turbo](https://ardrive.io). One shared encrypted blob per contract; every signatory unwraps their own key from the same blob.

*Privacy Notice: For those who do not want to store their encrypted contract on Arweave out of privacy concerns, a simple export-import function can verify the hash of the contract. The hash of the agreement only gets stored on the Ethereum blockchain. That is all the system needs to ensure authenticity.*

5. **Smart Contract Block Creation** — Each contract can reference an on-chain smart contract. The frontend fetches the deployed bytecode and computes its keccak256 hash, and stores it on-chain alongside the contract record.

*Future tightening: Future templates could include a "factory" (a smart contract that creates other smart contracts). That way, the app can enforce what is in the legal text directly onchain.*

## Architecture

The SCB is a fully native dApp. The blockchain is the backend. Smart contracts on Ethereum handle membership, document registration, encryption key registration, and contract lifecycle.

The frontend is a static SvelteKit application that connects directly to these contracts through the user's existing wallet (MetaMask, Rabby, Brave Wallet, Ledger via MetaMask, and any other browser-injected EIP-1193 provider).

The build output is a pre-rendered HTML + JS bundle with a fixed content hash. All state lives on-chain or on Arweave. Nothing is stored on a server.

**Smart Contracts** (Solidity 0.8.31, OpenZeppelin 5.x):
- `DAAToken.sol` — ERC-721 + ERC-5192 soulbound membership token. Inherited from the DAA build; gates contract creation via `balanceOf()`.
- `DAARegistry.sol` — Append-only document registry with categories, document layer, versioning, two-tier governance authority, per-document amendment restrictions, atomic `addDocumentWithRestrictions` for governance proposals that bundle a new document with its restrictions. Implements `IDocumentRegistry` from `@vattelum/document-registry`.
- `ContractRegistry.sol` — Per-contract record of content hashes, EIP-712 signatures, lifecycle events, and an optional reference to a deployed smart contract (address + bytecode hash + chain ID). Propose / accept / reject / dispute / finalize lifecycle with a 30-day notice window.
- `PubkeyRegistry.sol` — Standalone per-wallet encryption pubkey storage, slot keyed by `msg.sender` so impersonation is impossible.
- `PercentageQuorumAvatarStrategy.sol` — Custom Snapshot X execution strategy with percentage-based approval threshold and participation quorum calculated from `DAAToken.totalSupply()`.

**Frontend** (SvelteKit + adapter-static, Svelte 5 runes, Tailwind v4):
- `/` — Public registry browser. Loads categories and documents from the DAA registry, fetches full text from Arweave on demand.
- `/propose` — Structured markdown editor for legislation and contract templates. Token holders only.
- `/admin` (labelled **Members** in the nav) — Self-service token minting, resign membership (burn), paginated member list.
- `/vote` — Governance page. Active proposals with voting, passed proposals with execute, collapsible history. Decodes proposals of three shapes: plain `addDocument`, two-tx bundle, and atomic `addDocumentWithRestrictions`.
- `/contract` — Create, sign, view, and print individual contracts. Per-signatory ECIES decryption in-browser. Four-quadrant proposal model (Cancel / Accept / Reject / Dispute) on the lifecycle banner.

**External Services**:
- [Snapshot X](https://snapshotx.xyz) (sx-evm) — On-chain voting and execution for governance over legislation and templates.
- [Arweave](https://arweave.org) — Permanent encrypted storage of contract bodies via [ArDrive Turbo](https://ardrive.io).
- [Gnosis Safe](https://safe.global) — Governance execution target for the legislation registry.

**Vattelum Package** — The SCB ensures interoperability with the rest of the ecosystem by incorporating the [Vattelum document-registry package](https://github.com/vattelum/document-registry). This is a small Solidity + TypeScript library that every Vattelum app shares, so a contract written in one app can cite, hash-check, and trust a document published by another. It is the core standard that specifies how documents are identified, cited, and verified across the entire ecosystem.

**Deployment architecture:**

```
DAAToken (soulbound membership, exposes totalSupply())
    └── owner (deployer) — setMintFee(), withdraw(), setVerifier()

DAARegistry (append-only document registry with document layer)
    ├── normalAuthority ─┐
    └── coreAuthority ───┴── Gnosis Safe
                               ├── Module: PercentageQuorumAvatarStrategy (normal, e.g. 50%)
                               └── Module: PercentageQuorumAvatarStrategy (core, e.g. 70%)

Snapshot X Space
    ├── Normal Strategy (e.g. 50% approval, 50% quorum) → Safe → DAARegistry
    └── Core Strategy (e.g. 70% approval, 50% quorum) → Safe → DAARegistry

ContractRegistry (independent — cites DAARegistry but does not depend on it)
    └── DocumentReference[] points into any IDocumentRegistry on any chain

PubkeyRegistry (standalone — no DAA dependency)
    └── per-wallet encryption pubkeys for ECIES
```

## Quick Start

### Browse the demo

The repository ships with a demo deployment on Sepolia testnet. To see it in action:

1. Clone the repository
2. Copy `.env.example` to `.env` in `apps/frontend/`
3. Run `npm install && npm run dev -- --host`
4. Open the app in your browser; the registry loads with the test deployment

To interact (mint, propose, vote, create contracts, sign), connect a wallet with Sepolia ETH.

### Deploy your own

To create your own SCB deployment, you must deploy new smart contracts and set up the governance infrastructure. This must be done in order, because each contract builds on the previous one.

You are free to select your own categories of legislation, contract template categories, and voting strategies.

#### Prerequisites

- [Node.js](https://nodejs.org) 22.17+ (required by SvelteKit 3)
- [Foundry](https://getfoundry.sh) (for contract compilation, testing, and deployment)
- An Ethereum wallet (MetaMask, Ledger, etc.)

#### 1. Deploy the contracts

The deployment consists of seven required steps to set up the Decentralized Autonomous Association, and two additional contract deployments. Each step depends on addresses produced by the previous one. The contracts can be deployed to any EVM-compatible network where Snapshot X (sx-evm) is also deployed (Ethereum, Optimism, Polygon, Arbitrum, Base, Sepolia, and others). 

*Important: the script ships pointing at the Snapshot X deployments on Sepolia. If you deploy this on another chain, you must replace the Snapshot X Sepolia smart contracts with the contracts you're using. Instructions are found in the comments.*

Start by compiling and testing:

```sh
cd apps/contracts
forge install
forge build
forge test
```

Run the numbered scripts in `script/` in order. Each step depends on addresses from the previous step. Update `.env` between runs.

```sh
forge script script/01_Deploy.s.sol --broadcast --rpc-url $SEPOLIA_RPC_URL
```

**`01_Deploy.s.sol` — DAAToken + DAARegistry.** Deploys the core contracts and seeds categories (including the "Contract Templates" category that the `/contract` page reads from via `VITE_CONTRACT_TEMPLATE_CATEGORY_ID`). The deployer (you) becomes the initial `coreAuthority` on the registry. Edit the category names in the script before deploying. After running, set `DAATOKEN_ADDRESS` and `DAAREGISTRY_ADDRESS` in `.env`.

**`02_DeploySafe.s.sol` — Gnosis Safe.** Deploys a Safe with the deployer as sole owner (threshold=1). This Safe becomes the governance gateway through which all approved proposals execute. After running, set `SAFE_ADDRESS` in `.env`.

**`03_CreateVotingSpace.s.sol` — Snapshot X Space.** Creates a voting space via the sx-evm ProxyFactory. Configure voting parameters in the script: voting delay, minimum and maximum voting duration. The Space address must be read from the `ProxyDeployed` event in the transaction receipt. After running, set `SX_SPACE_ADDRESS` in `.env`.

**`04_DeployVotingStrategies.s.sol` — Two execution strategies.** Deploys two instances of `PercentageQuorumAvatarStrategy`, each pointing to the Safe, the Space, and the DAAToken. These are the defaults, and you are free to change them:
- **Normal strategy** — 50% approval threshold, 50% participation quorum (for regular votes)
- **Core strategy** — 70% approval threshold, 50% participation quorum (for core votes, or votes of locked sections)

These percentages are configurable until sealed (see step 7). After running, set `NORMAL_STRATEGY_ADDRESS` and `CORE_STRATEGY_ADDRESS` in `.env`.

**`05_ConnectStrategiesToSafe.s.sol` — Connects voting strategies to Safe.** Registers both strategy contracts as modules on the Safe. This authorizes them to execute transactions through the Safe when a proposal passes. Without this step, the strategies have no permission to act.

**`06_HandoverToGovernance.s.sol` — Decentralizes the registry.** Sets `normalAuthority` and `coreAuthority` on the DAARegistry to the Safe address. After this call, the deployer has zero control over the registry. All document additions, category changes, and restriction updates require a governance vote.

**`07_SealStrategies.s.sol` — Seal strategies (optional, irreversible).** Permanently locks all admin functions on both strategy contracts. After sealing, no one can change approval thresholds, participation quorum, voting token, target Safe, or Space whitelist. This step is optional: the deployer may choose to retain the ability to adjust governance parameters. However, until sealed, the deployer can unilaterally alter voting rules. **This cannot be undone.**

That finishes the Decentralized Autonomous Association. Next, it is time to deploy the SCB tooling:

**`08_DeployContractRegistry.s.sol` — ContractRegistry.** Deploys the contract record smart contract. It cites legislation from any registry via `DocumentReference[]`. After running, set `CONTRACT_REGISTRY_ADDRESS` in `.env`.

**`09_DeployPubkeyRegistry.s.sol` — PubkeyRegistry.** Deploys the per-wallet encryption pubkey registry. Stands alone, meaning no constructor arguments, and no dependencies. After running, set `PUBKEY_REGISTRY_ADDRESS` in `.env`.

After deployment, the deployer retains ownership of the DAAToken (for `setMintFee()`, `withdraw()`, `setVerifier()`).

An off-sequence helper script (`ReduceVotingPeriod.s.sol`) is provided for demo/testing convenience. It shortens the active Space's voting window from 24 hours to ten minutes. It is not part of the launch deployment chain.

#### 2. Configure and run frontend

```sh
cd apps/frontend
npm install
cp .env.example .env
```

Edit `.env` with your deployed contract addresses, governance addresses, chain ID, and RPC URL.

```sh
npm run dev -- --host
```

The `--host` flag is required so the dev server is reachable on the local network (per project convention).

### Arweave Setup

The SCB uses [ArDrive Turbo](https://ardrive.io) to upload encrypted contract bodies to Arweave. Creators sign uploads through their connected wallet. No separate Arweave wallet or AR tokens are required.

ArDrive Turbo offers a 100 KiB free tier, which is enough for typical contracts. During the development and testing of this project, no payment was required at all for any standard-sized agreements.

If an upload is refused due to size limits:

1. Go to [app.ardrive.io](https://app.ardrive.io) and connect your Ethereum wallet (the same wallet you use to create contracts)
2. Purchase Turbo credits using ETH — Arweave storage is very cheap (a few cents stores hundreds of kilobytes permanently), so even a small top-up covers many contracts

Every upload is followed by a Turbo status verification call (`verifyTurboHas`) with a `[0, 3, 8, 15]` second retry schedule before any on-chain write. It usually happens within 10 seconds. If Turbo has not registered the upload within the schedule, the on-chain write is aborted. You are asked to verify again, and if the app still cannot find the document, you are asked to re-upload.

### Test the full flow

1. **Mint a membership token** — Go to Members, click Mint. Repeat with a second wallet so you have at least two members.
2. **Add a contract template** — Go to Propose. Pick the "Contract Templates" category, write a template with a YAML frontmatter `roles:` block declaring the abstract parties (e.g. `client`, `contractor`) and an optional `variables:` block for non-party fields. Submit the proposal, vote it through, execute.
3. **Register encryption pubkeys** — Go to Contract on each wallet. The app prompts each member to register their encryption pubkey (one-time wallet signature, derives a separate keypair).
4. **Create a contract** — From the first wallet, go to Contract → Create. Pick the template, bind a role to each wallet, fill the variables, optionally cite governing legislation (local or from another registry), pick a storage mode (Arweave-encrypted or hash-only), and submit.
5. **Sign** — From the second wallet, open Contract. The contract appears in the list. Click to open. The app fetches the encrypted blob, unwraps the wallet's key, decrypts in-browser, recomputes the SHA-256, and verifies against the on-chain hash. Click Sign.
6. **Print** — From either wallet, open the now-Active contract and click Print. Pick which legislation sections appear in full. The browser print dialog generates a PDF with the verification appendix.
7. **Lifecycle** — Optionally test Propose Termination / Propose Completion. Watch the four-quadrant model (Cancel / Accept / Reject / Dispute) in action: the proposer sees Cancel; non-proposer signatories see Accept and Reject; everyone can Dispute from the footer.

## Configuration

### Contracts `.env`

| Variable | Description |
|---|---|
| `SEPOLIA_RPC_URL` | RPC endpoint for your target network |
| `PRIVATE_KEY` | Deployer wallet private key (see `.env.example` for safer alternatives including hardware wallets and encrypted keystores) |

The deploy scripts also read the addresses they wrote into `.env` in previous steps (`DAATOKEN_ADDRESS`, `DAAREGISTRY_ADDRESS`, `SAFE_ADDRESS`, `SX_SPACE_ADDRESS`, `NORMAL_STRATEGY_ADDRESS`, `CORE_STRATEGY_ADDRESS`).

### Frontend `.env`

| Variable | Description |
|---|---|
| `VITE_DAA_TOKEN_ADDRESS` | Deployed DAAToken contract address |
| `VITE_DAA_REGISTRY_ADDRESS` | Deployed DAARegistry contract address |
| `VITE_CONTRACT_REGISTRY_ADDRESS` | Deployed ContractRegistry contract address |
| `VITE_PUBKEY_REGISTRY_ADDRESS` | Deployed PubkeyRegistry contract address |
| `VITE_CONTRACT_TEMPLATE_CATEGORY_ID` | DAARegistry category ID containing contract templates (the `/contract` page reads from this) |
| `VITE_CHAIN_ID` | Chain ID of your target network |
| `VITE_DEPLOY_BLOCK` | Block number of contract deployment (for efficient log fetching) |
| `VITE_RPC_URL` | RPC endpoint |
| `VITE_SAFE_ADDRESS` | Gnosis Safe address (governance authority) |
| `VITE_SX_SPACE_ADDRESS` | Snapshot X Space address |
| `VITE_NORMAL_STRATEGY_ADDRESS` | Normal execution strategy (50% approval) |
| `VITE_CORE_STRATEGY_ADDRESS` | Core execution strategy (70% approval) |
| `VITE_AUTHENTICATOR_ADDRESS` | Snapshot X EthTxAuthenticator address |
| `VITE_TERMS_CATEGORY_ID` | DAARegistry pointer to a "Terms of Membership" document; shown as a collapsible box on the Mint form. Both `VITE_TERMS_*` vars must be set together; omit either to disable. |
| `VITE_TERMS_DOCUMENT_ID` | Document ID of the "Terms of Membership" document (see above). |

## Forward Compatibility

The SCB is the fourth product in the Vattelum ecosystem. With these four implementations plus the Vattelum package, the ecosystem has the basics it needs to start decentralized law-creation. Future repos will be variations of what is already here, and the system reserves several hooks so those variations can plug in without smart-contract changes:

- **External identity systems** — `createContract` only checks that the *caller* holds a DAA token; non-creator signatories are not gated on-chain. The frontend enforces DAA membership today, but any other identity layer can be included: a different DAO's membership token, a KYC attester, an off-chain credential provider, an API counterparty.

- **Cross-registry, cross-chain legislation** — Document references carry a registry address, chain ID, and relationship type, so contracts can cite legislation hosted on any Vattelum registry on any EVM chain, today, with no contract change.

- **Extensible audit timeline** — The on-chain lifecycle log is append-only and uses a numbering scheme that reserves room for new event types (`50` AMENDED is already reserved). New integrations can write new event types without disturbing clients that already index existing ones.

## Dependencies

`apps/frontend/package.json` pins these transitive packages with `overrides`:

| Override | Why it exists |
|---|---|
| `ox` 0.14.59 | Keeps `@wagmi/core` installable. Must follow the exact `ox` version `viem` requires, so update it with every `viem` bump. |
| `elliptic` 6.6.1 | Patched version for audit findings through `@ardrive/turbo-sdk`. |
| `secp256k1` 5.0.1 | Patched version for audit findings through `@ardrive/turbo-sdk`. |
| `uuid` 11.1.1 (under `jayson`) | Patched version for an audit finding through `@ardrive/turbo-sdk`. |

`npm audit` still reports findings:

- **`bigint-buffer` (high):** comes from Turbo's Solana code, which ships in the bundle but which the app does not use (it uploads with `token: 'ethereum'`). There is no upstream fix.
- **`elliptic` (low):** the remaining advisory has no patched release.
- **`ws` and `stream-json`:** come through Turbo and have patched releases, but are not in the production bundle, so they are not overridden.
- **Build tooling:** the rest come through development dependencies such as `vite` and `vite-plugin-node-polyfills`.

## License

MIT
