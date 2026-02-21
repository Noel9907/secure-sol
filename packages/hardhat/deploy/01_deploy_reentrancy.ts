import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { parseEther } from "ethers";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // --- Reentrancy scenario ---
  const bank = await deploy("VulnerableBank", {
    from: deployer,
    log: true,
  });

  await deploy("ReentrancyAttacker", {
    from: deployer,
    args: [bank.address],
    log: true,
  });

  // --- Flash loan scenario ---
  const dex = await deploy("SimpleDEX", {
    from: deployer,
    value: parseEther("5").toString(),
    log: true,
  });

  const victim = await deploy("FlashLoanVictim", {
    from: deployer,
    args: [dex.address],
    value: parseEther("2").toString(),
    log: true,
  });

  const provider = await deploy("FlashLoanProvider", {
    from: deployer,
    value: parseEther("10").toString(),
    log: true,
  });

  await deploy("FlashLoanAttacker", {
    from: deployer,
    args: [victim.address, provider.address, dex.address],
    value: parseEther("3").toString(),
    log: true,
  });
};

export default deploy;
deploy.tags = ["all"];
