// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title IVerifier — Pluggable minting gate for DAAToken
/// @dev Implement this interface to create custom minting verification logic.
///      The verifier is called on every mint() to approve or reject the recipient.
interface IVerifier {
    /// @notice Check whether an address is approved to receive a membership token.
    /// @param account The address to verify.
    /// @return True if the address is approved, false otherwise.
    function isVerified(address account) external view returns (bool);
}
