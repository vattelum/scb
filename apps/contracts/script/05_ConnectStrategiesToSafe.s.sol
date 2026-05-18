// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script, console} from "forge-std/Script.sol";

interface ISafe {
    function enableModule(address module) external;

    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool success);
}

/// @notice Step 5: Connect both voting strategies to the Gnosis Safe as modules.
/// This authorizes the strategies to execute transactions through the Safe.
/// Requires SAFE_ADDRESS, NORMAL_STRATEGY_ADDRESS, CORE_STRATEGY_ADDRESS in .env.
contract ConnectStrategiesToSafe is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address safe = vm.envAddress("SAFE_ADDRESS");
        address normalStrategy = vm.envAddress("NORMAL_STRATEGY_ADDRESS");
        address coreStrategy = vm.envAddress("CORE_STRATEGY_ADDRESS");

        console.log("Safe:", safe);
        console.log("Normal Strategy:", normalStrategy);
        console.log("Core Strategy:", coreStrategy);

        vm.startBroadcast(deployerPrivateKey);

        _execSafe(safe, safe, abi.encodeWithSelector(ISafe.enableModule.selector, normalStrategy), deployer);
        console.log("Enabled normalStrategy as Safe module");

        _execSafe(safe, safe, abi.encodeWithSelector(ISafe.enableModule.selector, coreStrategy), deployer);
        console.log("Enabled coreStrategy as Safe module");

        vm.stopBroadcast();
    }

    function _execSafe(address safe, address to, bytes memory data, address signer) internal {
        // For a 1-of-1 Safe, the signature is the owner address with v=1 (pre-approved)
        bytes memory signature = abi.encodePacked(
            bytes32(uint256(uint160(signer))),
            bytes32(0),
            uint8(1)
        );

        ISafe(safe).execTransaction(
            to, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), signature
        );
    }
}
