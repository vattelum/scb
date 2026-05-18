// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title PubkeyRegistry — On-chain secp256k1 public key directory
/// @notice Maps wallet addresses to their ECIES encryption public keys
///         (64-byte uncompressed secp256k1, no 0x04 prefix). The stored
///         pubkey is NOT the wallet's transaction-signing pubkey — it is
///         a separate encryption keypair the user derives deterministically
///         from a wallet signature, so the same wallet always re-derives
///         the same encryption key without ever exposing its private key.
///         This design is wallet-agnostic: any EVM wallet that supports
///         personal_sign can participate (MetaMask, WalletConnect, hardware
///         wallets, mobile wallets). Standalone — no dependency on DAAToken
///         or any other contract — so the registry is reusable across products.
contract PubkeyRegistry {
    // ──────────────────────── State ───────────────────────────

    mapping(address => bytes) private _pubkeys;

    // ──────────────────────── Events ──────────────────────────

    event PubkeyRegistered(address indexed user, bytes pubkey);

    // ──────────────────────── Errors ──────────────────────────

    error InvalidPubkeyLength();

    // ──────────────────────── Public ──────────────────────────

    /// @notice Register or overwrite the caller's encryption public key.
    /// @param pubkey 64-byte uncompressed secp256k1 public key (X || Y, no 0x04 prefix).
    /// @dev Only `msg.sender` can write their own slot, so impersonation is
    ///      impossible. The pubkey is NOT validated against the caller's
    ///      address because it is a derived encryption key, not the wallet's
    ///      transaction-signing key. Submitting a pubkey the caller cannot
    ///      re-derive only causes self-DoS — incoming contracts will be
    ///      undecryptable for that user.
    function register(bytes calldata pubkey) external {
        if (pubkey.length != 64) revert InvalidPubkeyLength();

        _pubkeys[msg.sender] = pubkey;
        emit PubkeyRegistered(msg.sender, pubkey);
    }

    /// @notice Returns the registered public key for `user`, or empty bytes if unregistered.
    function getPubkey(address user) external view returns (bytes memory) {
        return _pubkeys[user];
    }

    /// @notice True if `user` has registered a public key.
    function isRegistered(address user) external view returns (bool) {
        return _pubkeys[user].length == 64;
    }
}
