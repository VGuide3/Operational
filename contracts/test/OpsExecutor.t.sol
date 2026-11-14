// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {OpsExecutor} from "../src/OpsExecutor.sol";

contract OpsExecutorTest is Test {
    OpsExecutor internal executor;
    address internal relayer = address(0xBEEF);
    address internal stranger = address(0xCAFE);

    function setUp() public {
        executor = new OpsExecutor(address(this));
        executor.setRelayer(relayer, true);
    }

    function testOnlyRelayerCanExecute() public {
        OpsExecutor.Call[] memory calls = new OpsExecutor.Call[](0);
        vm.prank(stranger);
        vm.expectRevert(OpsExecutor.NotRelayer.selector);
        executor.execute(keccak256("intent-1"), calls);
    }

    function testIntentCannotBeReplayed() public {
        OpsExecutor.Call[] memory calls = new OpsExecutor.Call[](0);
        bytes32 intent = keccak256("intent-2");
        vm.prank(relayer);
        executor.execute(intent, calls);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(OpsExecutor.IntentAlreadyExecuted.selector, intent));
        executor.execute(intent, calls);
    }

    function testAllowFailureFalseRevertsBatch() public {
        OpsExecutor.Call[] memory calls = new OpsExecutor.Call[](1);
        calls[0] = OpsExecutor.Call({target: address(0xdead), value: 0, data: hex"", allowFailure: false});
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(OpsExecutor.CallFailed.selector, 0));
        executor.execute(keccak256("intent-3"), calls);
    }
}
