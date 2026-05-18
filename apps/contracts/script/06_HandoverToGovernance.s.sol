// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script, console} from "forge-std/Script.sol";
import {DAARegistry} from "../src/DAARegistry.sol";

/// @notice Step 6: Hand over registry control to governance.
/// After this, the deployer has zero control over the registry.
/// All changes require a governance vote.
/// Requires DAAREGISTRY_ADDRESS and SAFE_ADDRESS in .env.
contract HandoverToGovernance is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address registryAddress = vm.envAddress("DAAREGISTRY_ADDRESS");
        address safe = vm.envAddress("SAFE_ADDRESS");

        DAARegistry registry = DAARegistry(registryAddress);

        console.log("Deployer:", deployer);
        console.log("Registry:", registryAddress);
        console.log("Safe:", safe);
        console.log("Current coreAuthority:", registry.coreAuthority());
        console.log("Current normalAuthority:", registry.normalAuthority());

        vm.startBroadcast(deployerPrivateKey);

        registry.setNormalAuthority(safe);
        console.log("Set normalAuthority to Safe");

        registry.setCoreAuthority(safe);
        console.log("Set coreAuthority to Safe");

        vm.stopBroadcast();

        console.log("Handover complete - deployer has no registry control");
    }
}
