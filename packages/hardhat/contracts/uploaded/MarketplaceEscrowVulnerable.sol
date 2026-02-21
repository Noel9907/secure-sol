// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract MarketplaceEscrowVulnerable {

    struct Listing {
        address seller;
        uint256 price;
        bool sold;
    }

    mapping(uint256 => Listing) public listings;
    mapping(address => uint256) public pendingWithdrawals;

    uint256 public listingCounter;

    // Seller lists an item
    function createListing(uint256 price) external {
        require(price > 0, "Price must be > 0");

        listings[listingCounter] = Listing({
            seller: msg.sender,
            price: price,
            sold: false
        });

        listingCounter++;
    }

    // Buyer purchases item
    function buy(uint256 listingId) external payable {
        Listing storage item = listings[listingId];

        require(!item.sold, "Already sold");
        require(msg.value == item.price, "Incorrect price");

        item.sold = true;

        // Funds move to escrow
        pendingWithdrawals[item.seller] += msg.value;
    }

    // ❌ VULNERABLE WITHDRAWAL
    function withdrawPayout() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No payout available");

        // External call BEFORE state update
        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Transfer failed");

        // State update AFTER transfer → reentrancy bug
        pendingWithdrawals[msg.sender] = 0;
    }

    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}