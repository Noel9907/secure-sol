// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract OverflowVictim {
    mapping(address => uint256) public balances;
    uint256 public constant PRICE = 0.1 ether;

    event Bought(address buyer, uint256 tokens);
    event Sent(address from, address to, uint256 amount);
    event Redeemed(address redeemer, uint256 tokens, uint256 eth);

    constructor() payable {}

    function buy() external payable {
        require(msg.value >= PRICE, "Min 0.1 ETH");
        balances[msg.sender] += msg.value / PRICE;
        emit Bought(msg.sender, msg.value / PRICE);
    }

    function sendTokens(address to, uint256 amount) external {
        unchecked {
            balances[msg.sender] -= amount;
            balances[to] += amount;
        }
        emit Sent(msg.sender, to, amount);
    }

    function redeem(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient tokens");
        require(address(this).balance >= amount * PRICE, "Pool empty");
        balances[msg.sender] -= amount;
        payable(msg.sender).transfer(amount * PRICE);
        emit Redeemed(msg.sender, amount, amount * PRICE);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
