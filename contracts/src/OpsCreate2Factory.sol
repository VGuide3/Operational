// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

/// @title OpsCreate2Factory
/// @notice Deterministic deployment factory.
/// @dev Address derivation is `keccak256(0xff ++ address(this) ++ salt ++
///      keccak256(initCode))[12:]`, matching the off-chain computation in
///      `@ops/contracts`. The same factory, salt, and init code always produce
///      the same address.
contract OpsCreate2Factory {
    error DeploymentFailed();
    error AddressOccupied(address predicted);

    event Deployed(address indexed deployed, bytes32 indexed salt);

    /// @notice Deploy `initCode` deterministically for `salt`.
    function deploy(bytes32 salt, bytes calldata initCode) external payable returns (address deployed) {
        address predicted = predict(salt, initCode);
        if (predicted.code.length != 0) revert AddressOccupied(predicted);

        assembly {
            deployed := create2(callvalue(), add(initCode, 0x20), initCode.length, salt)
        }
        if (deployed == address(0)) revert DeploymentFailed();
        emit Deployed(deployed, salt);
    }

    /// @notice Reproducible address prediction for a salt and init code.
    function predict(bytes32 salt, bytes calldata initCode) public view returns (address) {
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(initCode)))))
        );
    }
}
