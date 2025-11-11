import { network } from "hardhat";

const { ethers } = await network.connect();

async function main(): Promise<void> {
  console.log("开始部署代币合约到 Sepolia...");

  // 获取部署者账户
  const [deployer] = await ethers.getSigners();
  console.log("部署者地址:", deployer.address);

  // 检查余额
  const balance = await deployer.provider?.getBalance(deployer.address);
  console.log("部署者余额:", balance ? ethers.formatEther(balance) : "0", "ETH");

  // 部署 USDCMock
  console.log("\n正在部署 USDCMock...");
  const USDCMock = await ethers.getContractFactory("USDCMock");
  const usdcMock = await USDCMock.deploy();
  await usdcMock.waitForDeployment();
  const usdcAddress: string = await usdcMock.getAddress();
  console.log("USDCMock 部署地址:", usdcAddress);

  // 部署 WLTCMock
  console.log("\n正在部署 WLTCMock...");
  const WLTCMock = await ethers.getContractFactory("WLTCMock");
  const wltcMock = await WLTCMock.deploy();
  await wltcMock.waitForDeployment();
  const wltcAddress: string = await wltcMock.getAddress();
  console.log("WLTCMock 部署地址:", wltcAddress);

  // 铸造一些测试币
  console.log("\n铸造测试币...");
  
  /*
    你自己铸造的代币本身没有价格，价格是由市场供需和流动性池决定的。
    在创建 AMM 池时，初始价格由你添加的流动性比例决定：
        如果你希望 1 USDC = 1 WLTC（即等价），那么添加流动性的比例应该是 1:1
        如果你希望 1 WLTC = 100 USDC（即 WLTC 更贵），那么比例应该是 1:100
        如果你希望 1 WLTC = 120 USDC（即 WLTC 更贵），那么比例应该是 1:120【默认】
  */

  //"1000000" 是 1,000,000 个 USDC，将 1,000,000 转换为带 6 位小数的格式
  //USDC (6位小数)：parseUnits("1000000", 6) = 1000000000000 (1,000,000 × 10^6)
  // 铸造 1,000,000 USDC (6位小数)
  await usdcMock.mint(deployer.address, ethers.parseUnits("12000000", 6));
  console.log("已向部署者铸造 12,000,000 USDC");

  //"1000" 是 1,000 个 WLTC
  //WLTC (18位小数)：parseUnits("1000", 18) = 1000000000000000000000 (1,000 × 10^18)
  // 铸造 1,000 WLTC (18位小数)
  await wltcMock.mint(deployer.address, ethers.parseUnits("100000", 18));
  console.log("已向部署者铸造 100,000 WLTC");

  // 验证余额
  const usdcBalance = await usdcMock.balanceOf(deployer.address);
  const wltcBalance = await wltcMock.balanceOf(deployer.address);
  
  console.log("\n=== 部署完成 ===");
  console.log("USDCMock 地址:", usdcAddress);
  console.log("WLTCMock 地址:", wltcAddress);
  console.log("USDC 余额:", ethers.formatUnits(usdcBalance, 6));
  console.log("WLTC 余额:", ethers.formatUnits(wltcBalance, 18));
  
  console.log("\n=== 在 MetaMask 中添加代币 ===");
  console.log("USDC 合约地址:", usdcAddress);
  console.log("USDC 符号: USDC");
  console.log("USDC 小数位: 6");
  console.log("WLTC 合约地址:", wltcAddress);
  console.log("WLTC 符号: WLTC");
  console.log("WLTC 小数位: 18");
}

main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });