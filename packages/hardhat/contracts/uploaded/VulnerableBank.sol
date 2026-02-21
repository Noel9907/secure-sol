// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract VulnerableBank {
    mapping(address => uint256) public balances;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    function deposit() external payable {
        require(msg.value > 0, "Must send ETH");
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw() external {
        uint256 userBalance = balances[msg.sender];
        require(userBalance > 0, "No balance");
        (bool success, ) = msg.sender.call{value: userBalance}("");
        require(success, "Transfer failed");
        balances[msg.sender] = 0;
        emit Withdrawn(msg.sender, userBalance);
    }

    function getBankBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
