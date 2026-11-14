// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

/// @title OpsExecutor
/// @notice Application-owned executor for policy-approved, batched calls.
/// @dev The executor is deliberately minimal: it performs `call` only, never
///      `delegatecall`, so an approved batch cannot escalate into arbitrary
///      code execution in the executor's storage context.
contract OpsExecutor {
    /// @notice Owner authorized to update the relayer allowlist.
    address public owner;

    /// @notice Relayers permitted to submit approved batches.
    mapping(address => bool) public relayers;

    /// @notice Intent hashes already executed, to prevent replay.
    mapping(bytes32 => bool) public executedIntents;

    struct Call {
        address target;
        uint256 value;
        bytes data;
        bool allowFailure;
    }

    error NotOwner();
    error NotRelayer();
    error IntentAlreadyExecuted(bytes32 intentHash);
    error CallFailed(uint256 index);
    error ValueTransferFailed();

    event RelayerUpdated(address indexed relayer, bool allowed);
    event BatchExecuted(bytes32 indexed intentHash, uint256 callCount);
    event CallResult(uint256 indexed index, bool success, bytes returnData);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRelayer() {
        if (!relayers[msg.sender]) revert NotRelayer();
        _;
    }

    constructor(address initialOwner) {
        owner = initialOwner;
        relayers[initialOwner] = true;
    }

    receive() external payable {}

    /// @notice Allow or revoke a relayer.
    function setRelayer(address relayer, bool allowed) external onlyOwner {
        relayers[relayer] = allowed;
        emit RelayerUpdated(relayer, allowed);
    }

    /// @notice Execute a batch bound to a single-use intent hash.
    /// @dev Calls marked `allowFailure = false` revert the whole batch on failure.
    function execute(bytes32 intentHash, Call[] calldata calls) external onlyRelayer {
        if (executedIntents[intentHash]) revert IntentAlreadyExecuted(intentHash);
        executedIntents[intentHash] = true;

        uint256 length = calls.length;
        for (uint256 i = 0; i < length; ++i) {
            Call calldata c = calls[i];
            (bool ok, bytes memory ret) = c.target.call{value: c.value}(c.data);
            emit CallResult(i, ok, ret);
            if (!ok && !c.allowFailure) revert CallFailed(i);
        }
        emit BatchExecuted(intentHash, length);
    }
}
