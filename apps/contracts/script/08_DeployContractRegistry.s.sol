// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script, console} from "forge-std/Script.sol";
import {ContractRegistry} from "../src/ContractRegistry.sol";

contract DeployContractRegistry is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address daaToken = vm.envAddress("DAATOKEN_ADDRESS");

        console.log("Deployer:", deployer);
        console.log("Balance:", deployer.balance);
        console.log("DAAToken:", daaToken);

        vm.startBroadcast(deployerPrivateKey);

        ContractRegistry registry = new ContractRegistry(daaToken);
        console.log("ContractRegistry deployed at:", address(registry));

        vm.stopBroadcast();
    }
}
