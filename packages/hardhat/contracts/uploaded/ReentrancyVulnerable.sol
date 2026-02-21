 // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.0;

  contract DrainableBank {
      mapping(address => uint256) public balances;

      function deposit() external payable {
          balances[msg.sender] += msg.value;
      }

      // ❌ VULNERABLE: uses = 0 (idempotent) → all re-entries commit, ETH drained
      function withdraw() external {
          uint256 amount = balances[msg.sender];
          require(amount > 0, "No balance");
          (bool sent, ) = msg.sender.call{value: amount}("");
          require(sent, "Failed");
          balances[msg.sender] = 0;  // too late — re-entry already happened
      }

      function getContractBalance() external view returns (uint256) {
          return address(this).balance;
      }
  }
