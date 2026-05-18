// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {DAAToken} from "../src/DAAToken.sol";
import {IVerifier} from "../src/interfaces/IVerifier.sol";

/// @dev Mock verifier that approves only whitelisted addresses.
contract MockVerifier is IVerifier {
    mapping(address => bool) public approved;

    function setApproved(address account, bool status) external {
        approved[account] = status;
    }

    function isVerified(address account) external view override returns (bool) {
        return approved[account];
    }
}

/// @dev Malicious contract that attempts reentrancy on mint via onERC721Received.
contract ReentrantMinter {
    DAAToken public token;
    uint256 public attempts;

    constructor(DAAToken _token) {
        token = _token;
    }

    function attack(bytes calldata credential) external payable {
        token.mint{value: msg.value}(credential);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (attempts < 1) {
            attempts++;
            token.mint(hex"");
        }
        return this.onERC721Received.selector;
    }
}

/// @dev Malicious contract that attempts reentrancy on withdraw via receive.
contract ReentrantWithdrawer {
    DAAToken public token;
    uint256 public attempts;

    constructor(DAAToken _token) {
        token = _token;
    }

    receive() external payable {
        if (attempts < 1) {
            attempts++;
            token.withdraw();
        }
    }
}

contract DAATokenTest is Test {
    DAAToken token;
    MockVerifier verifier;

    address admin = makeAddr("admin");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    bytes constant CREDENTIAL = hex"deadbeef";
    bytes constant EMPTY_CREDENTIAL = "";

    event Minted(address indexed to, uint256 indexed tokenId);
    event Burned(address indexed from, uint256 indexed tokenId);
    event Locked(uint256 tokenId);
    event VerifierSet(address indexed verifier);
    event MintFeeSet(uint256 fee);
    event Withdrawn(address indexed to, uint256 amount);
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    function setUp() public {
        token = new DAAToken(admin, true, true);
        verifier = new MockVerifier();
    }

    // ──────────────────────── Scenario 1: Self-mint with credential ────

    function test_mint_storesCredentialAndMintsToken() public {
        vm.prank(alice);
        token.mint(CREDENTIAL);

        assertEq(token.ownerOf(0), alice);
        assertEq(token.balanceOf(alice), 1);
        assertEq(token.getCredential(0), CREDENTIAL);
    }

    function test_mint_emitsEvents() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit Transfer(address(0), alice, 0);
        vm.expectEmit(true, false, false, false);
        emit Locked(0);
        vm.expectEmit(true, true, false, false);
        emit Minted(alice, 0);
        token.mint(CREDENTIAL);
    }

    function test_mint_anyoneCanMint() public {
        vm.prank(alice);
        token.mint(CREDENTIAL);
        assertEq(token.ownerOf(0), alice);

        vm.prank(bob);
        token.mint(CREDENTIAL);
        assertEq(token.ownerOf(1), bob);
    }

    // ──────────────────────── Scenario 2: Transfer reverts (soulbound) ───

    function test_transferFrom_reverts() public {
        vm.prank(alice);
        token.mint(CREDENTIAL);

        vm.prank(alice);
        vm.expectRevert(DAAToken.Soulbound.selector);
        token.transferFrom(alice, bob, 0);
    }

    function test_safeTransferFrom_reverts() public {
        vm.prank(alice);
        token.mint(CREDENTIAL);

        vm.prank(alice);
        vm.expectRevert(DAAToken.Soulbound.selector);
        token.safeTransferFrom(alice, bob, 0);
    }

    // ──────────────────────── Scenario 3: locked() returns true ──────────

    function test_locked_returnsTrue() public {
        vm.prank(alice);
        token.mint(CREDENTIAL);

        assertTrue(token.locked(0));
    }

    function test_locked_revertsForNonexistentToken() public {
        vm.expectRevert();
        token.locked(999);
    }

    // ──────────────────────── Scenario 4: Holder burns own token ─────────

    function test_burn_byHolder() public {
        vm.prank(alice);
        token.mint(CREDENTIAL);

        vm.prank(alice);
        token.burn(0);

        vm.expectRevert();
        token.ownerOf(0);
        assertEq(token.balanceOf(alice), 0);
    }

    function test_burn_emitsEvent() public {
        vm.prank(alice);
        token.mint(CREDENTIAL);

        vm.prank(alice);
        vm.expectEmit(true, true, false, false);
        emit Burned(alice, 0);
        token.burn(0);
    }

    function test_burn_deletesCredential() public {
        vm.prank(alice);
        token.mint(CREDENTIAL);

        vm.prank(alice);
        token.burn(0);

        vm.expectRevert();
        token.getCredential(0);
    }

    // ──────────────────────── Scenario 5: Burn authorization ─────────────

    function test_burn_byNonHolder_reverts() public {
        vm.prank(alice);
        token.mint(CREDENTIAL);

        vm.prank(bob);
        vm.expectRevert(DAAToken.NotAuthorizedToBurn.selector);
        token.burn(0);
    }

    function test_burn_byAdmin_whenEnabled() public {
        vm.prank(alice);
        token.mint(CREDENTIAL);

        vm.prank(admin);
        token.burn(0);

        vm.expectRevert();
        token.ownerOf(0);
        assertEq(token.balanceOf(alice), 0);
    }

    function test_burn_byAdmin_emitsHolderAddress() public {
        vm.prank(alice);
        token.mint(CREDENTIAL);

        vm.prank(admin);
        vm.expectEmit(true, true, false, false);
        emit Burned(alice, 0);
        token.burn(0);
    }

    function test_burn_byAdmin_whenDisabled_reverts() public {
        DAAToken noAdminBurn = new DAAToken(admin, true, false);

        vm.prank(alice);
        noAdminBurn.mint(CREDENTIAL);

        vm.prank(admin);
        vm.expectRevert(DAAToken.NotAuthorizedToBurn.selector);
        noAdminBurn.burn(0);
    }

    function test_burn_adminCanBurn_immutableFlag() public view {
        assertTrue(token.adminCanBurn());
    }

    // ──────────────────────── Scenario 6: getCredential returns data ─────

    function test_getCredential_returnsStoredData() public {
        bytes memory cred = abi.encodePacked("email:sha256:abcdef1234567890");

        vm.prank(alice);
        token.mint(cred);

        assertEq(token.getCredential(0), cred);
    }

    function test_getCredential_revertsForNonexistentToken() public {
        vm.expectRevert();
        token.getCredential(999);
    }

    // ──────────────────────── Scenario 7: No verifier — mint proceeds ───

    function test_mint_noVerifier_proceeds() public {
        assertEq(address(token.verifier()), address(0));

        vm.prank(alice);
        token.mint(CREDENTIAL);

        assertEq(token.ownerOf(0), alice);
    }

    // ──────────────────────── Scenario 8: Verifier rejects unapproved ───

    function test_mint_verifierRejectsUnapproved() public {
        vm.prank(admin);
        token.setVerifier(address(verifier));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DAAToken.VerifierRejected.selector, alice));
        token.mint(CREDENTIAL);
    }

    function test_mint_verifierApprovesWhitelisted() public {
        verifier.setApproved(alice, true);

        vm.prank(admin);
        token.setVerifier(address(verifier));

        vm.prank(alice);
        token.mint(CREDENTIAL);

        assertEq(token.ownerOf(0), alice);
    }

    function test_setVerifier_emitsEvent() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, false);
        emit VerifierSet(address(verifier));
        token.setVerifier(address(verifier));
    }

    function test_setVerifier_removedWithZeroAddress() public {
        vm.startPrank(admin);
        token.setVerifier(address(verifier));
        token.setVerifier(address(0));
        vm.stopPrank();

        assertEq(address(token.verifier()), address(0));

        vm.prank(alice);
        token.mint(CREDENTIAL);
        assertEq(token.ownerOf(0), alice);
    }

    // ──────────────────────── Scenario 9: Owner-only admin functions ─────

    function test_setVerifier_byNonAdmin_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        token.setVerifier(address(verifier));
    }

    function test_setMintFee_byNonAdmin_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        token.setMintFee(1 ether);
    }

    function test_withdraw_byNonAdmin_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        token.withdraw();
    }

    // ──────────────────────── Scenario 10: Empty credential is valid ────

    function test_mint_emptyCredential() public {
        vm.prank(alice);
        token.mint(EMPTY_CREDENTIAL);

        assertEq(token.ownerOf(0), alice);
        assertEq(token.getCredential(0), EMPTY_CREDENTIAL);
    }

    // ──────────────────────── Single Token Per Address ─────────────────

    function test_singleToken_revertOnDoubleMint() public {
        vm.startPrank(alice);
        token.mint(CREDENTIAL);

        vm.expectRevert(abi.encodeWithSelector(DAAToken.AlreadyMember.selector, alice));
        token.mint(CREDENTIAL);
        vm.stopPrank();
    }

    function test_singleToken_allowsRemintAfterBurn() public {
        vm.prank(alice);
        token.mint(CREDENTIAL);

        vm.prank(alice);
        token.burn(0);

        vm.prank(alice);
        token.mint(CREDENTIAL);
        assertEq(token.ownerOf(1), alice);
    }

    function test_singleToken_disabledAllowsMultiple() public {
        DAAToken multiToken = new DAAToken(admin, false, true);

        vm.startPrank(alice);
        multiToken.mint(CREDENTIAL);
        multiToken.mint(CREDENTIAL);
        vm.stopPrank();

        assertEq(multiToken.balanceOf(alice), 2);
    }

    function test_singleToken_immutableFlag() public view {
        assertTrue(token.singleTokenPerAddress());
    }

    // ──────────────────────── ERC-165 Interface Support ─────────────────

    function test_supportsInterface_ERC721() public view {
        assertTrue(token.supportsInterface(0x80ac58cd)); // ERC-721
    }

    function test_supportsInterface_ERC5192() public view {
        assertTrue(token.supportsInterface(0xb45a3c0e)); // ERC-5192
    }

    function test_supportsInterface_ERC165() public view {
        assertTrue(token.supportsInterface(0x01ffc9a7)); // ERC-165
    }

    // ──────────────────────── Sequential Token IDs ──────────────────────

    function test_tokenIds_autoIncrement() public {
        vm.prank(alice);
        token.mint(CREDENTIAL);
        vm.prank(bob);
        token.mint(CREDENTIAL);

        assertEq(token.ownerOf(0), alice);
        assertEq(token.ownerOf(1), bob);
    }

    // ──────────────────────── Minting Fee ────────────────────────────────

    function test_mint_zeroFee_works() public {
        assertEq(token.mintFee(), 0);

        vm.prank(alice);
        token.mint(CREDENTIAL);
        assertEq(token.ownerOf(0), alice);
    }

    function test_mint_withCorrectFee_works() public {
        vm.prank(admin);
        token.setMintFee(0.01 ether);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        token.mint{value: 0.01 ether}(CREDENTIAL);
        assertEq(token.ownerOf(0), alice);
        assertEq(address(token).balance, 0.01 ether);
    }

    function test_mint_withInsufficientFee_reverts() public {
        vm.prank(admin);
        token.setMintFee(0.01 ether);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DAAToken.IncorrectFee.selector, 0.01 ether, 0.005 ether));
        token.mint{value: 0.005 ether}(CREDENTIAL);
    }

    function test_mint_withExcessFee_reverts() public {
        vm.prank(admin);
        token.setMintFee(0.01 ether);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DAAToken.IncorrectFee.selector, 0.01 ether, 0.1 ether));
        token.mint{value: 0.1 ether}(CREDENTIAL);
    }

    function test_mint_withZeroValueWhenFeeSet_reverts() public {
        vm.prank(admin);
        token.setMintFee(0.01 ether);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DAAToken.IncorrectFee.selector, 0.01 ether, 0));
        token.mint(CREDENTIAL);
    }

    function test_setMintFee_storesValue() public {
        vm.prank(admin);
        token.setMintFee(0.05 ether);
        assertEq(token.mintFee(), 0.05 ether);
    }

    function test_setMintFee_emitsEvent() public {
        vm.prank(admin);
        vm.expectEmit(false, false, false, true);
        emit MintFeeSet(0.05 ether);
        token.setMintFee(0.05 ether);
    }

    function test_setMintFee_canBeSetToZero() public {
        vm.startPrank(admin);
        token.setMintFee(0.01 ether);
        token.setMintFee(0);
        vm.stopPrank();

        assertEq(token.mintFee(), 0);

        vm.prank(alice);
        token.mint(CREDENTIAL);
        assertEq(token.ownerOf(0), alice);
    }

    // ──────────────────────── Withdraw ───────────────────────────────────

    function test_withdraw_sendsBalanceToOwner() public {
        vm.prank(admin);
        token.setMintFee(0.01 ether);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        token.mint{value: 0.01 ether}(CREDENTIAL);

        vm.deal(bob, 1 ether);
        vm.prank(bob);
        token.mint{value: 0.01 ether}(CREDENTIAL);

        uint256 adminBefore = admin.balance;

        vm.prank(admin);
        token.withdraw();

        assertEq(admin.balance, adminBefore + 0.02 ether);
        assertEq(address(token).balance, 0);
    }

    function test_withdraw_emitsEvent() public {
        vm.prank(admin);
        token.setMintFee(0.01 ether);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        token.mint{value: 0.01 ether}(CREDENTIAL);

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit Withdrawn(admin, 0.01 ether);
        token.withdraw();
    }

    function test_withdraw_zeroBalance_reverts() public {
        vm.prank(admin);
        vm.expectRevert(DAAToken.NothingToWithdraw.selector);
        token.withdraw();
    }

    // ──────────────────────── Verifier + Fee Combo ───────────────────────

    function test_mint_verifierAndFee_bothRequired() public {
        vm.startPrank(admin);
        token.setVerifier(address(verifier));
        token.setMintFee(0.01 ether);
        vm.stopPrank();

        vm.deal(alice, 1 ether);

        // No verification, correct fee — reverts (fee checked first, then verifier)
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DAAToken.VerifierRejected.selector, alice));
        token.mint{value: 0.01 ether}(CREDENTIAL);

        // Verified, insufficient fee — reverts
        verifier.setApproved(alice, true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(DAAToken.IncorrectFee.selector, 0.01 ether, 0));
        token.mint(CREDENTIAL);

        // Verified + correct fee — works
        vm.prank(alice);
        token.mint{value: 0.01 ether}(CREDENTIAL);
        assertEq(token.ownerOf(0), alice);
    }

    // ──────────────────────── Reentrancy ─────────────────────────────────

    function test_mint_reentrancy_reverts() public {
        DAAToken reentrancyToken = new DAAToken(admin, false, true);
        ReentrantMinter attacker = new ReentrantMinter(reentrancyToken);

        vm.expectRevert();
        attacker.attack(CREDENTIAL);
    }

    function test_withdraw_reentrancy_reverts() public {
        ReentrantWithdrawer attackOwner = new ReentrantWithdrawer(token);
        DAAToken attackToken = new DAAToken(address(attackOwner), true, true);

        vm.prank(address(attackOwner));
        attackToken.setMintFee(0.01 ether);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        attackToken.mint{value: 0.01 ether}(CREDENTIAL);

        vm.prank(address(attackOwner));
        vm.expectRevert();
        attackToken.withdraw();
    }

    // ──────────────────────── Gas Estimation ────────────────────────────

    function test_gas_mint() public {
        vm.prank(alice);
        uint256 gasBefore = gasleft();
        token.mint(CREDENTIAL);
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("Gas used for mint", gasUsed);
    }

    function test_gas_mintWithFee() public {
        vm.prank(admin);
        token.setMintFee(0.01 ether);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 gasBefore = gasleft();
        token.mint{value: 0.01 ether}(CREDENTIAL);
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("Gas used for mint with fee", gasUsed);
    }

    function test_gas_burn() public {
        vm.prank(alice);
        token.mint(CREDENTIAL);

        vm.prank(alice);
        uint256 gasBefore = gasleft();
        token.burn(0);
        uint256 gasUsed = gasBefore - gasleft();
        emit log_named_uint("Gas used for burn", gasUsed);
    }

    // ──────────────────────── Fuzz Tests ────────────────────────────────

    function testFuzz_mint_arbitraryCredential(bytes calldata cred) public {
        vm.prank(alice);
        token.mint(cred);

        assertEq(token.getCredential(0), cred);
    }

    function testFuzz_mint_multipleRecipients(address recipient) public {
        vm.assume(recipient != address(0));
        vm.assume(recipient.code.length == 0);

        vm.prank(recipient);
        token.mint(CREDENTIAL);

        assertEq(token.ownerOf(0), recipient);
        assertTrue(token.locked(0));
    }

    function testFuzz_mintFee_anyValue(uint256 fee) public {
        vm.prank(admin);
        token.setMintFee(fee);
        assertEq(token.mintFee(), fee);
    }

    function testFuzz_mint_withVariousFees(uint256 fee) public {
        fee = bound(fee, 1, 10 ether);

        vm.prank(admin);
        token.setMintFee(fee);

        vm.deal(alice, fee);
        vm.prank(alice);
        token.mint{value: fee}(CREDENTIAL);

        assertEq(token.ownerOf(0), alice);
        assertEq(address(token).balance, fee);
    }
}
