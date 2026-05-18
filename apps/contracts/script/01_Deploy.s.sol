// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script, console} from "forge-std/Script.sol";
import {DAAToken} from "../src/DAAToken.sol";
import {DAARegistry} from "../src/DAARegistry.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        DAAToken token = new DAAToken(deployer, true, true);
        console.log("DAAToken deployed at:", address(token));

        DAARegistry registry = new DAARegistry(deployer);
        console.log("DAARegistry deployed at:", address(registry));

        // Configure your categories here. After governance handover,
        // adding new categories requires a core (70%) vote.
        registry.addCategory("Governing Laws");
        registry.addCategory("Chain Standards");
        registry.addCategory("Model Agreements");
        registry.addCategory("Contract Templates");
        console.log("Seeded 4 categories (Contract Templates = 3)");

        vm.stopBroadcast();
    }
}
