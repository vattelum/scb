// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script, console} from "forge-std/Script.sol";
import {PercentageQuorumAvatarStrategy} from "../src/PercentageQuorumAvatarStrategy.sol";

/// @notice Step 4: Deploy two execution strategies with voting thresholds.
/// Requires DAATOKEN_ADDRESS, SAFE_ADDRESS, SX_SPACE_ADDRESS in .env.
/// After deployment, set NORMAL_STRATEGY_ADDRESS and CORE_STRATEGY_ADDRESS in .env.
contract SetVotingThresholds is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address token = vm.envAddress("DAATOKEN_ADDRESS");
        address safe = vm.envAddress("SAFE_ADDRESS");
        address space = vm.envAddress("SX_SPACE_ADDRESS");

        console.log("Deployer:", deployer);
        console.log("Token:", token);
        console.log("Safe:", safe);
        console.log("Space:", space);

        address[] memory spaces = new address[](1);
        spaces[0] = space;

        vm.startBroadcast(deployerPrivateKey);

        // approvalThreshold, participationQuorum (0 = disabled)
        PercentageQuorumAvatarStrategy normalStrategy = new PercentageQuorumAvatarStrategy(
            deployer, safe, spaces, token, 50, 50
        );
        console.log("Normal Strategy (50% approval, 50% quorum):", address(normalStrategy));

        PercentageQuorumAvatarStrategy coreStrategy = new PercentageQuorumAvatarStrategy(
            deployer, safe, spaces, token, 70, 50
        );
        console.log("Core Strategy (70% approval, 50% quorum):", address(coreStrategy));

        vm.stopBroadcast();
    }
}
