// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IFlashLoanReceiver {
    function executeFlashLoan(uint256 amount) external payable;
}

contract FlashLoanProvider {
    event LoanIssued(address borrower, uint256 amount);
    event LoanRepaid(address borrower, uint256 amount);

    constructor() payable {}

    function flashLoan(uint256 amount) external {
        require(address(this).balance >= amount, "Insufficient reserves");
        uint256 balanceBefore = address(this).balance;
        emit LoanIssued(msg.sender, amount);
        IFlashLoanReceiver(msg.sender).executeFlashLoan{value: amount}(amount);
        require(address(this).balance >= balanceBefore, "Loan not repaid");
        emit LoanRepaid(msg.sender, amount);
    }

    receive() external payable {}
}
