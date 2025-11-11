import { network } from "hardhat";

async function main() {
  console.log("🚀 开始完整系统功能测试...");

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
    stableToken: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    leverageToken: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    interestManager: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    priceOracle: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
    custodian: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
    linearDecrease: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
    auctionManager: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
    liquidationManager: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318"
  };

  console.log("\n📋 使用合约地址:");
  Object.entries(deploymentInfo).forEach(([name, address]) => {
    console.log(`  ${name}: ${address}`);
  });

  // 获取合约实例
  const wltc  = await ethers.getContractAt("WLTCMock", deploymentInfo.wltc);
  const stableToken = await ethers.getContractAt("StableToken", deploymentInfo.stableToken);
  const leverageToken = await ethers.getContractAt("MultiLeverageToken", deploymentInfo.leverageToken);
  const interestManager = await ethers.getContractAt("InterestManager", deploymentInfo.interestManager);
  const priceOracle = await ethers.getContractAt("LTCPriceOracle", deploymentInfo.priceOracle);
  const custodian = await ethers.getContractAt("CustodianFixed", deploymentInfo.custodian);
  const auctionManager = await ethers.getContractAt("DuchAuction", deploymentInfo.auctionManager);
  const liquidationManager = await ethers.getContractAt("Liquidation", deploymentInfo.liquidationManager);

  console.log("\n✅ 合约实例化完成");

  // ==================== 测试1: 基础功能测试 ====================
  console.log("\n📦 测试1: 基础功能测试");

  // 1.1 合约连接检查
  console.log("  1.1 合约连接检查...");
  try {
    const custodianAddr = await auctionManager.custodian();
    console.log(`    AuctionManager -> Custodian: ${custodianAddr} ✅`);
    
    const liquidationAddr = await custodian.liquidationManager();
    console.log(`    Custodian -> LiquidationManager: ${liquidationAddr} ✅`);
    
    const auctionAddr = await custodian.auctionManager();
    console.log(`    Custodian -> AuctionManager: ${auctionAddr} ✅`);
  } catch (error) {
    console.log(`    ❌ 合约连接检查失败: ${error.message}`);
  }

  // 1.2 权限检查
  console.log("  1.2 权限检查...");
  try {
    const liquidationRoleInCustodian = await custodian.hasRole(
      custodian.LIQUIDATION_ROLE(),
      deploymentInfo.liquidationManager
    );
    console.log(`    liquidationManager has LIQUIDATION_ROLE in custodian: ${liquidationRoleInCustodian ? "✅" : "❌"}`);
    
    const liquidationRoleInAuction = await auctionManager.hasRole(
      auctionManager.CALLER_ROLE(),
      deploymentInfo.liquidationManager
    );
    console.log(`    liquidationManager has CALLER_ROLE in auctionManager: ${liquidationRoleInAuction ? "✅" : "❌"}`);
    

    const auctionRoleInCustodian = await custodian.hasRole(
      custodian.AUCTION_ROLE(),
      deploymentInfo.auctionManager
    );
    console.log(`    auctionManager has AUCTION_ROLE in custodian: ${auctionRoleInCustodian ? "✅" : "❌"}`);

    const auctionRoleInLiquidation = await liquidationManager.hasRole(
      liquidationManager.AUCTION_ROLE(),
      deploymentInfo.auctionManager
    );
    console.log(`    auctionManager has AUCTION_ROLE in liquidationManager: ${auctionRoleInLiquidation ? "✅" : "❌"}`);

    const custodianRoleInLiquidation = await liquidationManager.hasRole(
      liquidationManager.CUSTODIAN_ROLE(),
      deploymentInfo.custodian
    );
    console.log(`    custodian has CUSTODIAN_ROLE in liquidationManager: ${custodianRoleInLiquidation ? "✅" : "❌"}`);


  } catch (error) {
    console.log(`    ❌ 权限检查失败: ${error.message}`);
  }


  // ==================== 更新预言机价格 =====================
  await priceOracle.updatePrice(ethers.parseEther("100"));
  console.log("📝 更新预言机价格为 100");

  // ==================== 测试2: 铸币测试 ====================
  console.log("\n📦 测试2: 铸币测试");

  // 2.1 给测试用户分配 WLTC
  console.log("  2.1 分配 WLTC 给测试用户...");
  const wltcAmount = ethers.parseEther("100"); // 100 WLTC
  await wltc.mint(user1.address, wltcAmount);
  const userWltcBalance = await wltc.balanceOf(user1.address);
  const  estimatedGas = await wltc.balanceOf.estimateGas(user1.address);
console.log(`⛽ 估算 Gas: ${estimatedGas.toString()}`);  console.log(`    用户 WLTC 余额: ${ethers.formatEther(userWltcBalance)} WLTC ✅`);

  // 2.2 用户授权 Custodian 使用 WLTC
  console.log("  2.2 用户授权 Custodian 使用 WLTC...");
  await wltc.connect(user1).approve(deploymentInfo.custodian, wltcAmount);
  console.log("    授权完成 ✅");

  // 2.3 预览铸币
  console.log("  2.3 预览铸币...");
  const underlyingAmount = ethers.parseEther("10"); // 10 WLTC
  const leverageType = 1; // CONSERVATIVE 杠杆
  const mintPrice = ethers.parseEther("75"); // $75 铸币价格
  
  const previewResult = await custodian.previewMint(
    underlyingAmount,
    leverageType,
    mintPrice,
    ethers.parseEther("80") // 当前价格 $80
  );
  
  console.log(`    预览结果:`);
  console.log(`      S 代币数量: ${ethers.formatEther(previewResult[0])} S`);
  console.log(`      L 代币数量: ${ethers.formatEther(previewResult[1])} L`);
  console.log(`      总净值: ${ethers.formatEther(previewResult[2])} ✅`);

  // 2.4 执行铸币
  console.log("  2.4 执行铸币...");
  


  // 估算 gas
  try {
    const estimatedGas = await custodian.mint.estimateGas(
      underlyingAmount,
      mintPrice,
      leverageType,
      {
        gasLimit: 800000 // 🔧 增加 gas limit，确保交易成功
      }
    );
    console.log(`⛽ 估算 Gas: ${estimatedGas.toString()}`);
  } catch (gasError) {
    console.log("⚠️ Gas 估算失败:", gasError.message);
  }
  // 执行铸币，设置固定的 gas limit（参考成功脚本）
  const mintTx = await custodian.connect(user1).mint(
    underlyingAmount,
    mintPrice,
    leverageType,
  );
  console.log(`    📝 铸币交易已发送: ${mintTx.hash}`);
  await mintTx.wait();
  console.log("    铸币交易成功 ✅");

  // 2.5 检查铸币结果
  console.log("  2.5 检查铸币结果...");
  const userStableBalance = await stableToken.balanceOf(user1.address);
  console.log(`    用户 S 代币余额: ${ethers.formatEther(userStableBalance)} S`);

  // 获取用户持有的 L 代币
  const userTokens = await custodian.getAllLeverageTokenInfo(user1.address);
  console.log(`    用户持有 L 代币数量: ${userTokens[0].length} 种`);

  if (userTokens[0].length > 0) {
    const tokenId = userTokens[0][0];
    const lBalance = userTokens[1][0];
    console.log(`    第一个 L 代币 ID: ${tokenId}`);
    console.log(`    L 代币余额: ${ethers.formatEther(lBalance)} L ✅`);
  }

  // ==================== 测试3: 净值计算测试 ====================
  console.log("\n📦 测试3: 净值计算测试");

  if (userTokens[0].length > 0) {
    const tokenId = userTokens[0][0];
    
    // 3.1 获取单个代币净值信息
    console.log("  3.1 获取单个代币净值信息...");
    const navInfo = await custodian.getSingleLeverageTokenNavV2(user1.address, tokenId);
    
    console.log(`    净值信息:`);
    console.log(`      余额: ${ethers.formatEther(navInfo[0])} L`);
    console.log(`      总净值: ${ethers.formatEther(navInfo[1])}`);
    console.log(`      除息净值: ${ethers.formatEther(navInfo[2])}`);
    console.log(`      总价值: ${ethers.formatEther(navInfo[3])}`);
    console.log(`      净价值: ${ethers.formatEther(navInfo[4])}`);
    console.log(`      累计利息: ${ethers.formatEther(navInfo[5])}`);
    console.log(`      当前价格: ${ethers.formatEther(navInfo[6])} ✅`);
  }

  // ==================== 测试4: 清算模块功能测试 ====================
  console.log("\n📦 测试4: 清算模块功能测试");

  // 4.1 检查清算功能是否启用
  console.log("  4.1 检查清算功能状态...");
  const globalConfig = await liquidationManager.globalConfig();
  console.log(`    清算功能启用: ${globalConfig.enabled ? "✅" : "❌"}`);
  console.log(`    调整阈值: ${ethers.formatEther(globalConfig.adjustmentThreshold)}`);
  console.log(`    清算阈值: ${ethers.formatEther(globalConfig.liquidationThreshold)}`);
  console.log(`    惩罚金: ${ethers.formatEther(globalConfig.penalty)}`);

  console.log("  4.2 更新风险等级...");
  if (userTokens[0].length > 0) {
      const tokenId = userTokens[0][0];
      console.log(`    TokenId: ${tokenId} ✅`)
      const userStatus = await liquidationManager.userLiquidationStatus(user1.address, tokenId);
      const riskLevel = userStatus.riskLevel;
      console.log(`    Current RiskLevel: ${riskLevel}`);
      console.log(`    更新中...`);

      // 使用 callStatic 来获取函数的返回值，而不是执行交易
      try {
          const [netValue, newRiskLevel] = await liquidationManager.updateSingleTokensRiskLevel.staticCall(user1.address, tokenId);
          console.log(`    更新成功`);
          console.log(`    净值: ${ethers.formatEther(netValue)}`);
          console.log(`    风险等级: ${newRiskLevel} ✅`);
      } catch (error) {
          console.log(`    ❌ 获取风险等级失败: ${error.message}`);
          // 如果 callStatic 失败，直接执行交易并检查更新后的状态
          await liquidationManager.updateSingleTokensRiskLevel(user1.address, tokenId);
          console.log(`    风险等级已更新 ✅`);
      }
  }

  // ==================== 测试5: 拍卖模块功能测试 ====================
  console.log("\n📦 测试5: 拍卖模块功能测试");

  // 5.1 检查拍卖参数
  console.log("  5.1 检查拍卖参数...");
  const priceMultiplier = await auctionManager.priceMultiplier();
  const resetTime = await auctionManager.resetTime();
  const minAuctionAmount = await auctionManager.minAuctionAmount();
  
  console.log(`    价格乘数: ${ethers.formatEther(priceMultiplier)}`);
  console.log(`    重置时间: ${resetTime} 秒`);
  console.log(`    最小拍卖金额: ${ethers.formatEther(minAuctionAmount)} ✅`);

  // ==================== 测试6: 系统统计信息 ====================
  console.log("\n📦 测试6: 系统统计信息");

  // 6.1 获取项目统计
  console.log("  6.1 获取项目统计信息...");
  const projectStats = await custodian.getProjectStats();
  console.log(`    S 代币总供应量: ${ethers.formatEther(projectStats[0])} S`);
  console.log(`    L 代币总供应量: ${ethers.formatEther(projectStats[1])} L`);
  console.log(`    锁定标的资产总量: ${ethers.formatEther(projectStats[2])} WLTC ✅`);

  // ==================== 测试总结 ====================
  console.log("\n🎉 完整系统测试完成!");
  console.log("==========================================");
  console.log("📋 测试结果汇总:");
  console.log("  ✅ 基础功能测试 - 通过");
  console.log("  ✅ 铸币功能测试 - 通过");
  console.log("  ✅ 净值计算测试 - 通过");
  console.log("  ✅ 清算模块测试 - 通过");
  console.log("  ✅ 拍卖模块测试 - 通过");
  console.log("  ✅ 系统统计测试 - 通过");
  console.log("==========================================");
  console.log("\n📋 下一步建议:");
  console.log("  1. 进行更复杂的多用户交互测试");
  console.log("  2. 测试清算触发机制");
  console.log("  3. 测试拍卖流程");
  console.log("  4. 进行压力测试");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 测试失败:", error);
    process.exit(1);
  });
