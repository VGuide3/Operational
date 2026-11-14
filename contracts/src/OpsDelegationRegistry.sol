// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

/// @title OpsDelegationRegistry
/// @notice On-chain mirror of scoped, revocable delegations.
/// @dev The backend enforces scope on every execution; this registry provides
///      an on-chain revocation and expiry signal so a compromised backend
///      cannot keep using a delegation the grantor has revoked.
contract OpsDelegationRegistry {
    struct Delegation {
        address grantor;
        address delegate;
        uint256 chainId;
        bytes32 scopeHash;
        uint64 validFrom;
        uint64 validUntil;
        bool revoked;
    }

    mapping(bytes32 => Delegation) private delegations;

    error NotGrantor();
    error AlreadyRevoked();
    error InvalidWindow();

    event DelegationGranted(
        bytes32 indexed delegationId,
        address indexed grantor,
        address indexed delegate,
        bytes32 scopeHash,
        uint64 validFrom,
        uint64 validUntil
    );
    event DelegationRevoked(bytes32 indexed delegationId, address indexed grantor);

    /// @notice Register a delegation bound to a scope hash and validity window.
    function grant(
        bytes32 delegationId,
        address delegate,
        uint256 chainId,
        bytes32 scopeHash,
        uint64 validFrom,
        uint64 validUntil
    ) external {
        if (validUntil <= validFrom) revert InvalidWindow();
        Delegation storage d = delegations[delegationId];
        d.grantor = msg.sender;
        d.delegate = delegate;
        d.chainId = chainId;
        d.scopeHash = scopeHash;
        d.validFrom = validFrom;
        d.validUntil = validUntil;
        d.revoked = false;
        emit DelegationGranted(delegationId, msg.sender, delegate, scopeHash, validFrom, validUntil);
    }

    /// @notice Revoke a delegation. Only the grantor may revoke.
    function revoke(bytes32 delegationId) external {
        Delegation storage d = delegations[delegationId];
        if (d.grantor != msg.sender) revert NotGrantor();
        if (d.revoked) revert AlreadyRevoked();
        d.revoked = true;
        emit DelegationRevoked(delegationId, msg.sender);
    }

    /// @notice Whether a delegation is currently active at `now`.
    function isActive(bytes32 delegationId, uint256 chainId, uint64 now_) external view returns (bool) {
        Delegation storage d = delegations[delegationId];
        if (d.revoked) return false;
        if (d.chainId != chainId) return false;
        return now_ >= d.validFrom && now_ <= d.validUntil;
    }
}
