// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

contract AccessControlVictim {

    address public owner;

    constructor() payable {
        owner = msg.sender;
    }

    
    function deposit() public payable {}

    
    function withdrawContractFunds() external {

        payable(msg.sender).transfer(address(this).balance);

    }

    
    function emergencyWithdraw() external {

        payable(msg.sender).transfer(address(this).balance);

    }

}