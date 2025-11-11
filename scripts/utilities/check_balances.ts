// import { ethers } from "hardhat";
import hre from "hardhat";

/*
运行命令：npx hardhat run scripts/check_balances.ts --network sepolia
*/

async function main(): Promise<void> {
  // 使用 hre.ethers 避免导入问题
  const ethers = (hre as any).ethers;

  console.log("查询代币余额...");
  console.log("当前网络:", hre.network.name);

  // 获取部署者账户
  const [deployer] = await ethers.getSigners();
  console.log("查询地址:", deployer.address);

  // 代币合约地址（从部署脚本输出中获取）
  const USDC_ADDRESS = "0xCc90Ce982aD208b0F90b872e8A1880Ace299c371";
  const WLTC_ADDRESS = "0x9DFF6745444c05bbEc03bF59C0910731C02950dd";

  try {
    // 连接到已部署的合约
    const usdcContract = await ethers.getContractAt("USDCMock", USDC_ADDRESS);
    const wltcContract = await ethers.getContractAt("WLTCMock", WLTC_ADDRESS);

    // 查询余额
    const usdcBalance = await usdcContract.balanceOf(deployer.address);
    const wltcBalance = await wltcContract.balanceOf(deployer.address);

    // 查询ETH余额
    const ethBalance = await ethers.provider.getBalance(deployer.address);

    console.log("\n=== 当前余额 ===");
    console.log("ETH 余额:", ethers.formatEther(ethBalance), "ETH");
    console.log("USDC 余额:", ethers.formatUnits(usdcBalance, 6), "USDC");
    console.log("WLTC 余额:", ethers.formatUnits(wltcBalance, 18), "WLTC");

    // 获取代币信息
    const usdcName = await usdcContract.name();
    const usdcSymbol = await usdcContract.symbol();
    const usdcDecimals = await usdcContract.decimals();

    const wltcName = await wltcContract.name();
    const wltcSymbol = await wltcContract.symbol();
    const wltcDecimals = await wltcContract.decimals();

    console.log("\n=== 代币信息 ===");
    console.log(`${usdcName} (${usdcSymbol}) - ${usdcDecimals} 位小数`);
    console.log(`合约地址: ${USDC_ADDRESS}`);
    console.log(`${wltcName} (${wltcSymbol}) - ${wltcDecimals} 位小数`);
    console.log(`合约地址: ${WLTC_ADDRESS}`);

  } catch (error) {
    console.error("❌ 查询失败:", error);
    console.log("可能原因: 合约未部署或网络连接问题");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error("脚本执行失败:", error);
    process.exit(1);
  });