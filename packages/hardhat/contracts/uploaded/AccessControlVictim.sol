// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract AccessControlVictim {
    address public owner;

    event FundsDrained(address recipient, uint256 amount);

    constructor() payable {
        owner = msg.sender;
    }

    function drainFunds(address payable recipient) external {
        uint256 amount = address(this).balance;
        require(amount > 0, "Nothing to drain");
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "Transfer failed");
        emit FundsDrained(recipient, amount);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
