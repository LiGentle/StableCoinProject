import { network } from "hardhat";

async function main() {
  console.log("🔍 检查token冻结状态...");

  // 连接到网络
  const { ethers } = await network.connect();

  // 获取部署者账户
  const [deployer, user1] = await ethers.getSigners();
  console.log(`📝 测试账户:`);
  console.log(`  部署者: ${deployer.address}`);
  console.log(`  测试用户: ${user1.address}`);

  // 从部署信息获取合约地址
  const deploymentInfo = {
    wltc: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    leverageToken: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    custodian: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
    liquidationManager: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318"
  };

  // 获取合约实例
  const wltc  = await ethers.getContractAt("WLTCMock", deploymentInfo.wltc);
  const leverageToken = await ethers.getContractAt("MultiLeverageToken", deploymentInfo.leverageToken);
  const custodian = await ethers.getContractAt("CustodianFixed", deploymentInfo.custodian);
  const liquidationManager = await ethers.getContractAt("Liquidation", deploymentInfo.liquidationManager);

  console.log("\n✅ 合约实例化完成");

  // 检查用户持有的所有token
  console.log("\n📋 检查用户持有的token...");
  const userTokens = await custodian.getAllLeverageTokenInfo(user1.address);
  console.log(`    用户持有 L 代币数量: ${userTokens[0].length} 种`);

  for (let i = 0; i < userTokens[0].length; i++) {
    const tokenId = userTokens[0][i];
    const balance = userTokens[1][i];
    
    console.log(`\n🔍 检查 Token ID: ${tokenId}`);
    console.log(`    余额: ${ethers.formatEther(balance)} L`);
    
    // 检查冻结状态
    const freezeStatus = await liquidationManager.checkFreezeStatus(user1.address, tokenId);
    console.log(`    冻结状态: ${freezeStatus ? "❌ 已冻结" : "✅ 未冻结"}`);
    
    // 检查清算状态
    const userStatus = await liquidationManager.userLiquidationStatus(user1.address, tokenId);
    console.log(`    清算中: ${userStatus.isUnderLiquidation ? "❌ 是" : "✅ 否"}`);
    console.log(`    已被清算: ${userStatus.isLiquidated ? "❌ 是" : "✅ 否"}`);
    console.log(`    风险等级: ${userStatus.riskLevel}`);
    console.log(`    最后检查时间: ${userStatus.lastCheckTime}`);
    
    // 检查token是否存在
    const tokenExists = await leverageToken.tokenExists(tokenId);
    console.log(`    Token存在: ${tokenExists ? "✅ 是" : "❌ 否"}`);
  }

  console.log("\n🎉 冻结状态检查完成!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 检查失败:", error);
    process.exit(1);
  });
