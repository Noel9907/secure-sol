// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MultiVulnerableVault {

    mapping(address => uint256) public balances;
    mapping(address => uint256) public rewardPoints;

    address public owner;

    constructor() {
        owner = msg.sender;
    }

    // ==============================
    // 1️⃣ Deposit Function
    // ==============================
    function deposit() external payable {
        require(msg.value > 0, "Send ETH");

        balances[msg.sender] += msg.value;

        // Give reward points (used for overflow test)
        unchecked {
            rewardPoints[msg.sender] += msg.value * 1000;
        }
    }

    // ==============================
    // 2️⃣ REENTRANCY VULNERABILITY
    // ==============================
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");

        // ❌ External call BEFORE state update
        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Transfer failed");

        // State update AFTER → reentrancy window
        balances[msg.sender] -= amount;
    }

    // ==============================
    // 3️⃣ INPUT VALIDATION FLAW
    // ==============================
    function transferBalance(address to, uint256 amount) external {
        // ❌ Missing proper validation
        // No require(balances[msg.sender] >= amount);

        balances[msg.sender] -= amount;
        balances[to] += amount;
    }

    // ==============================
    // 4️⃣ INTEGER UNDERFLOW / OVERFLOW
    // ==============================
    function redeemPoints(uint256 points) external {
        // ❌ Forced underflow via unchecked block
        unchecked {
            rewardPoints[msg.sender] -= points;
        }
    }

    // ==============================
    // 5️⃣ ACCESS CONTROL FLAW
    // ==============================
    function emergencyWithdrawAll() external {
        // ❌ Missing onlyOwner modifier
        // Anyone can drain the contract

        payable(msg.sender).call{value: address(this).balance}("");
    }

    // ==============================
    // Helper
    // ==============================
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}