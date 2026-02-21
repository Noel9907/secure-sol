// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract CrowdfundRefundVulnerable {

    mapping(address => uint256) public contributions;
    uint256 public totalFunds;
    bool public campaignEnded;

    // Users contribute ETH
    function contribute() external payable {
        require(!campaignEnded, "Campaign ended");
        require(msg.value > 0, "Send ETH");

        contributions[msg.sender] += msg.value;
        totalFunds += msg.value;
    }

    // Owner ends campaign (simulated failure)
    function endCampaign() external {
        campaignEnded = true;
    }

    // ❌ VULNERABLE REFUND FUNCTION
    function claimRefund() external {
        require(campaignEnded, "Campaign still active");

        uint256 amount = contributions[msg.sender];
        require(amount > 0, "No contribution");

        // --- External call BEFORE state update ---
        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Refund failed");

        // State update AFTER transfer → reentrancy window
        contributions[msg.sender] = 0;
        totalFunds -= amount;
    }

    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}