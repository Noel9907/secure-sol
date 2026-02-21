import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployReentrancy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // Deploy VulnerableBank
  const bank = await deploy("VulnerableBank", {
    from: deployer,
    log: true,
  });

  // Deploy reentrancy attack contract
  await deploy("reentrancy", {
    from: deployer,
    args: [bank.address],
    log: true,
  });
};

export default deployReentrancy;

deployReentrancy.tags = ["reentrancy"];
