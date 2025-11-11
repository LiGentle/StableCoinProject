import { network } from "hardhat";

 // 连接到Sepolia网络
  const { ethers } = await network.connect({
    network: "sepolia",
    chainType: "l1",
  });


async function main(): Promise<void> {
  console.log("开始铸造代币...");

  // 获取部署者账户
  const [deployer] = await ethers.getSigners();
  console.log("铸币者地址:", deployer.address);

  // 代币合约地址（替换为你的实际部署地址）
  const USDC_ADDRESS = "0xCc90Ce982aD208b0F90b872e8A1880Ace299c371";
  const WLTC_ADDRESS = "0x9DFF6745444c05bbEc03bF59C0910731C02950dd";

  // 连接到已部署的合约
  console.log("\n连接到代币合约...");
  const usdcContract = await ethers.getContractAt("USDCMock", USDC_ADDRESS);
  const wltcContract = await ethers.getContractAt("WLTCMock", WLTC_ADDRESS);

  // 查询铸币前的余额
  console.log("\n=== 铸币前余额 ===");
  const usdcBalanceBefore = await usdcContract.balanceOf(deployer.address);
  const wltcBalanceBefore = await wltcContract.balanceOf(deployer.address);
  console.log("USDC 余额:", ethers.formatUnits(usdcBalanceBefore, 6), "USDC");
  console.log("WLTC 余额:", ethers.formatUnits(wltcBalanceBefore, 18), "WLTC");

  // 铸造 USDC (6位小数)
  console.log("\n正在铸造 12,000,000 USDC...");
  const usdcMintAmount = ethers.parseUnits("12000000", 6);
  const usdcTx = await usdcContract.mint(deployer.address, usdcMintAmount);
  await usdcTx.wait();
  console.log("✅ USDC 铸造完成，交易哈希:", usdcTx.hash);

  // 铸造 WLTC (18位小数)
  console.log("\n正在铸造 100,000 WLTC...");
  const wltcMintAmount = ethers.parseUnits("100000", 18);
  const wltcTx = await wltcContract.mint(deployer.address, wltcMintAmount);
  await wltcTx.wait();
  console.log("✅ WLTC 铸造完成，交易哈希:", wltcTx.hash);

  // 查询铸币后的余额
  console.log("\n=== 铸币后余额 ===");
  const usdcBalanceAfter = await usdcContract.balanceOf(deployer.address);
  const wltcBalanceAfter = await wltcContract.balanceOf(deployer.address);
  console.log("USDC 余额:", ethers.formatUnits(usdcBalanceAfter, 6), "USDC");
  console.log("WLTC 余额:", ethers.formatUnits(wltcBalanceAfter, 18), "WLTC");

  // 计算铸造的数量
  const usdcMinted = usdcBalanceAfter - usdcBalanceBefore;
  const wltcMinted = wltcBalanceAfter - wltcBalanceBefore;
  
  console.log("\n=== 本次铸造数量 ===");
  console.log("新增 USDC:", ethers.formatUnits(usdcMinted, 6), "USDC");
  console.log("新增 WLTC:", ethers.formatUnits(wltcMinted, 18), "WLTC");

  console.log("\n🎉 铸币操作完成！");
}

main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error("❌ 铸币失败:", error);
    process.exit(1);
  });