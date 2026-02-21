// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/*
    ⚠️ WARNING:
    This contract is intentionally vulnerable to reentrancy.
    Deploy ONLY in a local test environment.
*/

contract VulnerableBank {

    mapping(address => uint256) public balances;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    // Allow users to deposit ETH
    function deposit() external payable {
        require(msg.value > 0, "Must send ETH");
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    // 🚨 VULNERABLE FUNCTION
    function withdraw() external {
        uint256 userBalance = balances[msg.sender];
        require(userBalance > 0, "No balance");

        // ❌ Interaction FIRST (external call)
        (bool success, ) = msg.sender.call{value: userBalance}("");
        require(success, "Transfer failed");

        // ❌ Effects AFTER interaction
        balances[msg.sender] = 0;

        emit Withdrawn(msg.sender, userBalance);
    }

    function getBankBalance() external view returns (uint256) {
        return address(this).balance;
    }
}