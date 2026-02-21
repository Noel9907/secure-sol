// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract SimpleDEX {
    uint256 public ethReserve;
    uint256 public tokenReserve;

    event Swapped(address swapper, uint256 ethIn, uint256 tokensOut);

    constructor() payable {
        ethReserve = msg.value;
        tokenReserve = 1000 ether;
    }

    function getPrice() external view returns (uint256) {
        return (ethReserve * 1e18) / tokenReserve;
    }

    function swapETHForTokens() external payable {
        require(msg.value > 0, "Send ETH");
        uint256 tokensOut = (msg.value * tokenReserve) / (ethReserve + msg.value);
        ethReserve += msg.value;
        tokenReserve -= tokensOut;
        emit Swapped(msg.sender, msg.value, tokensOut);
    }

    receive() external payable {}
}
