// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {OpsCreate2Factory} from "../src/OpsCreate2Factory.sol";

contract OpsCreate2FactoryTest is Test {
    OpsCreate2Factory internal factory;

    function setUp() public {
        factory = new OpsCreate2Factory();
    }

    /// The same salt and init code always predict the same address.
    function testPredictIsDeterministic() public view {
        bytes32 salt = keccak256("treasury-1");
        bytes memory initCode = hex"60006000";
        address a = factory.predict(salt, initCode);
        address b = factory.predict(salt, initCode);
        assertEq(a, b, "prediction must be reproducible");
    }

    /// Different salts yield different addresses.
    function testDifferentSaltsDiffer() public view {
        bytes memory initCode = hex"60006000";
        address a = factory.predict(keccak256("a"), initCode);
        address b = factory.predict(keccak256("b"), initCode);
        assertTrue(a != b, "distinct salts must map to distinct addresses");
    }

    /// Deployment lands at the predicted address and cannot be repeated.
    function testDeployMatchesPrediction() public {
        bytes32 salt = keccak256("treasury-2");
        // Minimal contract that returns empty runtime code.
        bytes memory initCode = hex"60006000";
        address predicted = factory.predict(salt, initCode);

        address deployed = factory.deploy(salt, initCode);
        assertEq(deployed, predicted, "deployed address must equal prediction");

        vm.expectRevert(abi.encodeWithSelector(OpsCreate2Factory.AddressOccupied.selector, predicted));
        factory.deploy(salt, initCode);
    }
}
