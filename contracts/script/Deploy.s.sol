// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {OpsExecutor} from "../src/OpsExecutor.sol";
import {OpsCreate2Factory} from "../src/OpsCreate2Factory.sol";
import {OpsDelegationRegistry} from "../src/OpsDelegationRegistry.sol";

/// @notice Deploys the operations contracts and prints their addresses.
/// @dev The printed addresses are recorded in `deployments/` as immutable
///      artifacts. For deterministic addresses, deploy through
///      `OpsCreate2Factory` with a pinned salt and init code.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.envAddress("EXECUTOR_OWNER");

        vm.startBroadcast(pk);
        OpsCreate2Factory factory = new OpsCreate2Factory();
        OpsExecutor executor = new OpsExecutor(owner);
        OpsDelegationRegistry registry = new OpsDelegationRegistry();
        vm.stopBroadcast();

        console2.log("OpsCreate2Factory", address(factory));
        console2.log("OpsExecutor", address(executor));
        console2.log("OpsDelegationRegistry", address(registry));
    }
}
