// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {PubkeyRegistry} from "../src/PubkeyRegistry.sol";

contract PubkeyRegistryTest is Test {
    PubkeyRegistry registry;

    Vm.Wallet alice;
    Vm.Wallet bob;

    event PubkeyRegistered(address indexed user, bytes pubkey);

    function setUp() public {
        registry = new PubkeyRegistry();
        alice = vm.createWallet("alice");
        bob = vm.createWallet("bob");
    }

    // ─────────── Helpers ───────────

    /// @dev Returns the 64-byte uncompressed pubkey (X || Y) for a Vm.Wallet.
    /// In production the registered pubkey is a derived encryption key, not
    /// the wallet pubkey — but for testing accept-any-bytes behaviour, this
    /// is convenient sample data.
    function _pubkey(Vm.Wallet memory w) internal pure returns (bytes memory) {
        return abi.encodePacked(w.publicKeyX, w.publicKeyY);
    }

    // ─────────── register ───────────

    function test_RegisterAnyValidLengthPubkey() public {
        // Encryption pubkey is derived from a wallet signature, so it does NOT
        // correspond to the wallet's address. Registry accepts any 64 bytes.
        bytes memory pk = new bytes(64);
        for (uint256 i = 0; i < 64; i++) {
            pk[i] = bytes1(uint8(i + 1));
        }

        vm.expectEmit(true, false, false, true);
        emit PubkeyRegistered(alice.addr, pk);

        vm.prank(alice.addr);
        registry.register(pk);

        assertEq(registry.getPubkey(alice.addr), pk);
        assertTrue(registry.isRegistered(alice.addr));
    }

    function test_OnlyMsgSenderCanWriteOwnSlot() public {
        // Bob cannot affect Alice's slot — slot is keyed by msg.sender.
        bytes memory bobPk = _pubkey(bob);

        vm.prank(bob.addr);
        registry.register(bobPk);

        assertEq(registry.getPubkey(bob.addr), bobPk);
        assertEq(registry.getPubkey(alice.addr).length, 0, "alice slot must be untouched");
    }

    function test_RevertWhen_PubkeyLengthInvalid() public {
        bytes memory tooShort = new bytes(63);
        bytes memory tooLong = new bytes(65);

        vm.startPrank(alice.addr);
        vm.expectRevert(PubkeyRegistry.InvalidPubkeyLength.selector);
        registry.register(tooShort);

        vm.expectRevert(PubkeyRegistry.InvalidPubkeyLength.selector);
        registry.register(tooLong);
        vm.stopPrank();
    }

    function test_OverwriteExistingPubkey() public {
        bytes memory pk = _pubkey(alice);

        vm.startPrank(alice.addr);
        registry.register(pk);
        registry.register(pk); // Overwrite with same value succeeds
        vm.stopPrank();

        assertEq(registry.getPubkey(alice.addr), pk);
    }

    // ─────────── getPubkey / isRegistered ───────────

    function test_GetPubkeyEmptyForUnregistered() public view {
        assertEq(registry.getPubkey(alice.addr).length, 0);
        assertFalse(registry.isRegistered(alice.addr));
    }

    function test_MultipleUsersIndependent() public {
        bytes memory alicePk = _pubkey(alice);
        bytes memory bobPk = _pubkey(bob);

        vm.prank(alice.addr);
        registry.register(alicePk);
        vm.prank(bob.addr);
        registry.register(bobPk);

        assertEq(registry.getPubkey(alice.addr), alicePk);
        assertEq(registry.getPubkey(bob.addr), bobPk);
        assertTrue(registry.isRegistered(alice.addr));
        assertTrue(registry.isRegistered(bob.addr));
    }

    // ─────────── Gas ───────────

    function test_GasRegister() public {
        bytes memory pk = _pubkey(alice);
        vm.prank(alice.addr);
        uint256 g = gasleft();
        registry.register(pk);
        emit log_named_uint("register gas", g - gasleft());
    }
}
