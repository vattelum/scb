// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script, console} from "forge-std/Script.sol";
import {PubkeyRegistry} from "../src/PubkeyRegistry.sol";

contract DeployPubkeyRegistry is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);

        vm.startBroadcast(deployerPrivateKey);

        PubkeyRegistry registry = new PubkeyRegistry();
        console.log("PubkeyRegistry deployed at:", address(registry));

        vm.stopBroadcast();
    }
}
