// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script, console} from "forge-std/Script.sol";
import {PercentageQuorumAvatarStrategy} from "../src/PercentageQuorumAvatarStrategy.sol";

/// @notice Step 7 (optional): Permanently lock all admin functions on both strategies.
/// This is IRREVERSIBLE. After sealing, no one can change thresholds, quorum,
/// voting token, target Safe, or Space whitelist.
/// Requires NORMAL_STRATEGY_ADDRESS and CORE_STRATEGY_ADDRESS in .env.
contract SealStrategies is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address normalStrategy = vm.envAddress("NORMAL_STRATEGY_ADDRESS");
        address coreStrategy = vm.envAddress("CORE_STRATEGY_ADDRESS");

        console.log("Normal Strategy:", normalStrategy);
        console.log("Core Strategy:", coreStrategy);

        vm.startBroadcast(deployerPrivateKey);

        PercentageQuorumAvatarStrategy(normalStrategy).seal();
        console.log("Normal strategy sealed");

        PercentageQuorumAvatarStrategy(coreStrategy).seal();
        console.log("Core strategy sealed");

        vm.stopBroadcast();
    }
}
