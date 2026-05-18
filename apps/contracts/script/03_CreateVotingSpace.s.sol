// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script, console} from "forge-std/Script.sol";
import {InitializeCalldata, Strategy} from "sx-evm/types.sol";

interface ISxProxyFactory {
    function deployProxy(address implementation, bytes memory initializer, uint256 saltNonce) external;
}

interface ISpace {
    function initialize(InitializeCalldata calldata input) external;
}

/// @notice Step 3: Create a Snapshot X voting space via the sx-evm ProxyFactory.
/// The Space address must be read from the transaction receipt (event logs).
/// After deployment, set SX_SPACE_ADDRESS in .env before running step 4.
///
/// CHAIN-SPECIFIC ADDRESSES — currently pinned to Sepolia.
/// sx-evm publishes a separate deployment per supported chain. To port to a
/// different chain, swap every SX_* constant for the chain's published
/// addresses. Sources:
///   - sx-monorepo deployments:    https://github.com/snapshot-labs/sx-monorepo/tree/master/apps/api/src/networks
///   - sx-evm address book:        https://github.com/snapshot-labs/sx-evm/tree/main/deployments
///   - Snapshot X docs:            https://docs.snapshot.box
/// Currently confirmed sx-evm deployments include Mainnet, Sepolia, Polygon,
/// Optimism and Arbitrum — but addresses differ on each. Do NOT reuse the
/// constants below outside Sepolia.
contract CreateVotingSpace is Script {
    // Target chain id — script reverts if executed against any other chain.
    // Update this together with the SX_* addresses below when porting.
    uint256 constant EXPECTED_CHAIN_ID = 11155111; // Sepolia

    // Snapshot X (sx-evm) on Sepolia
    address constant SX_PROXY_FACTORY = 0x4B4F7f64Be813Ccc66AEFC3bFCe2baA01188631c;
    address constant SX_SPACE_IMPL = 0xC3031A7d3326E47D49BfF9D374d74f364B29CE4D;
    address constant SX_ETH_TX_AUTH = 0xBA06E6cCb877C332181A6867c05c8b746A21Aed1;
    address constant SX_VANILLA_VOTING = 0xC1245C5DCa7885C73E32294140F1e5d30688c202;
    address constant SX_VANILLA_PROPOSAL_VALIDATION = 0x9A39194F870c410633C170889E9025fba2113c79;

    function run() external {
        require(
            block.chainid == EXPECTED_CHAIN_ID,
            "CreateVotingSpace: chainid mismatch. Update EXPECTED_CHAIN_ID and SX_* addresses for the target chain."
        );

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("Deployer:", deployer);

        // Configure voting parameters here.
        uint32 votingDelay = 0;          // blocks before voting starts
        uint32 minVotingDuration = 300;  // ~1 hour at 12s/block
        uint32 maxVotingDuration = 7200; // ~1 day at 12s/block

        Strategy[] memory votingStrategies = new Strategy[](1);
        votingStrategies[0] = Strategy(SX_VANILLA_VOTING, "");

        string[] memory votingStrategyMetadataURIs = new string[](1);
        votingStrategyMetadataURIs[0] = "";

        address[] memory authenticators = new address[](1);
        authenticators[0] = SX_ETH_TX_AUTH;

        InitializeCalldata memory input = InitializeCalldata({
            owner: deployer,
            votingDelay: votingDelay,
            minVotingDuration: minVotingDuration,
            maxVotingDuration: maxVotingDuration,
            proposalValidationStrategy: Strategy(SX_VANILLA_PROPOSAL_VALIDATION, ""),
            proposalValidationStrategyMetadataURI: "",
            daoURI: "",
            metadataURI: "",
            votingStrategies: votingStrategies,
            votingStrategyMetadataURIs: votingStrategyMetadataURIs,
            authenticators: authenticators
        });

        bytes memory spaceInitializer = abi.encodeWithSelector(ISpace.initialize.selector, input);
        uint256 spaceSalt = uint256(keccak256(abi.encodePacked(deployer, block.timestamp)));

        vm.startBroadcast(deployerPrivateKey);

        ISxProxyFactory(SX_PROXY_FACTORY).deployProxy(SX_SPACE_IMPL, spaceInitializer, spaceSalt);
        console.log("Space deployed - read address from ProxyDeployed event in tx receipt");

        vm.stopBroadcast();
    }
}
