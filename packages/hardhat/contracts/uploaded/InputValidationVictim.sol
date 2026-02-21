// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract InputValidationVictim {
    mapping(address => uint256) public deposits;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    constructor() payable {}

    function deposit() external payable {
        require(msg.value > 0, "Send ETH");
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        require(amount > 0, "Zero amount");
        require(address(this).balance >= amount, "Low balance");
        // MISSING: require(deposits[msg.sender] >= amount, "Exceeds your deposit")
        payable(msg.sender).transfer(amount);
        emit Withdrawn(msg.sender, amount);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
