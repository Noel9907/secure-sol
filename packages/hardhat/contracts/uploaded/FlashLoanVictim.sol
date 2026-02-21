// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPriceOracle {
    function getPrice() external view returns (uint256);
}

contract FlashLoanVictim {
    IPriceOracle public oracle;
    mapping(address => uint256) public tokenBalances;
    uint256 public tokenSupply = 1000 ether;

    event TokensBought(address buyer, uint256 tokens, uint256 pricePaid);

    constructor(address _oracle) payable {
        oracle = IPriceOracle(_oracle);
        tokenBalances[address(this)] = tokenSupply;
    }

    function buyWithPrice() external payable {
        require(msg.value > 0, "Send ETH");
        uint256 price = oracle.getPrice();
        uint256 tokensOut = (msg.value * 1e18) / price;
        require(tokenBalances[address(this)] >= tokensOut, "Not enough tokens");
        tokenBalances[address(this)] -= tokensOut;
        tokenBalances[msg.sender] += tokensOut;
        emit TokensBought(msg.sender, tokensOut, msg.value);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
