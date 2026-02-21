// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract StakingVaultVulnerable {

    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public rewardBalance;

    uint256 public totalStaked;

    // Users stake ETH
    function stake() external payable {
        require(msg.value > 0, "Stake > 0");

        stakedBalance[msg.sender] += msg.value;
        totalStaked += msg.value;

        // Give instant reward (10%)
        uint256 reward = msg.value / 10;
        rewardBalance[msg.sender] += reward;
    }

    // ❌ VULNERABLE: withdraw stake
    function unstake(uint256 amount) external {
        require(stakedBalance[msg.sender] >= amount, "Not enough stake");

        // External call BEFORE state update
        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Transfer failed");

        // State update AFTER
        stakedBalance[msg.sender] -= amount;
        totalStaked -= amount;
    }

    // ❌ ALSO VULNERABLE: claim rewards
    function claimRewards() external {
        uint256 reward = rewardBalance[msg.sender];
        require(reward > 0, "No rewards");

        // External call BEFORE zeroing rewards
        (bool sent, ) = msg.sender.call{value: reward}("");
        require(sent, "Reward transfer failed");

        rewardBalance[msg.sender] = 0;
    }

    function getVaultBalance() external view returns (uint256) {
        return address(this).balance;
    }
}