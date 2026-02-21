// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract InputValidationAttacker {
    event AttackExecuted(address victim, bool success);
    event AttackFinished(uint256 stolen);

    function attack(address victim, bytes calldata callData) external {
        (bool success, ) = victim.call(callData);
        require(success, "Attack failed");
        emit AttackExecuted(victim, success);
        emit AttackFinished(address(this).balance);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    receive() external payable {}
}
