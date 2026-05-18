// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script, console} from "forge-std/Script.sol";
import {UpdateSettingsCalldata, Strategy} from "sx-evm/types.sol";

interface ISpace {
    function updateSettings(UpdateSettingsCalldata calldata input) external;
    function minVotingDuration() external view returns (uint32);
    function maxVotingDuration() external view returns (uint32);
}

/// @notice Optional convenience script — NOT part of the 01–09 deployment
/// sequence. Shortens the active Space's voting window for demo/testing.
/// Runs against an already-deployed Space referenced via SX_SPACE_ADDRESS.
///
/// CHAIN-SPECIFIC ADDRESS — currently pinned to Sepolia.
/// The `proposalValidationStrategy` field is required by
/// `UpdateSettingsCalldata` even when only the duration is being changed.
/// The address below is the Sepolia VanillaProposalValidationStrategy used in
/// 03_CreateVotingSpace.s.sol. If the Space was created on a different chain
/// or with a different validation strategy, replace it with the strategy the
/// Space currently uses (read it via `Space.proposalValidationStrategy()`
/// before running this script). See 03_CreateVotingSpace.s.sol for the
/// sx-evm deployment sources.
contract UpdateSpace is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address space = vm.envAddress("SX_SPACE_ADDRESS");

        console.log("Space:", space);
        console.log("Current min:", ISpace(space).minVotingDuration());
        console.log("Current max:", ISpace(space).maxVotingDuration());

        Strategy[] memory emptyStrategies = new Strategy[](0);
        string[] memory emptyStrings = new string[](0);
        address[] memory emptyAddresses = new address[](0);
        uint8[] memory emptyUint8s = new uint8[](0);

        UpdateSettingsCalldata memory settings = UpdateSettingsCalldata({
            minVotingDuration: 10,
            maxVotingDuration: 50,
            votingDelay: 0,
            metadataURI: "",
            daoURI: "",
            proposalValidationStrategy: Strategy(0x9A39194F870c410633C170889E9025fba2113c79, ""),
            proposalValidationStrategyMetadataURI: "",
            authenticatorsToAdd: emptyAddresses,
            authenticatorsToRemove: emptyAddresses,
            votingStrategiesToAdd: emptyStrategies,
            votingStrategyMetadataURIsToAdd: emptyStrings,
            votingStrategiesToRemove: emptyUint8s
        });

        vm.startBroadcast(deployerPrivateKey);
        ISpace(space).updateSettings(settings);
        vm.stopBroadcast();

        console.log("Updated min:", ISpace(space).minVotingDuration());
        console.log("Updated max:", ISpace(space).maxVotingDuration());
    }
}
