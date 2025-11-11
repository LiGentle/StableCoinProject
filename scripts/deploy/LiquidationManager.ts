import hre from "hardhat";

async function main(): Promise<void> {
  const ethers = (hre as any).ethers;

  console.log("🚀 开始部署清算管理合约...");
  console.log("📡 当前网络:", (hre.network as any).name);

  const [deployer] = await ethers.getSigners();
  console.log("👤 部署账户:", deployer.address);
  console.log("💰 部署账户余额:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH");

  // ============= 已部署的合约地址 =============
  const CUSTODIAN_FIXED_ADDRESS = "0x9Fb49EfD7dC50068eb19Cc7E4ac9cA77bCe9114A";

  // ============= 部署参数配置 =============
  const INITIAL_MANAGERS = [deployer.address]; // 初始管理人列表
  const REQUIRED_VOTES = 1; // 通过决议所需票数

  console.log("\n⚙️ 部署参数:");
  console.log(`   - Custodian 地址: ${CUSTODIAN_FIXED_ADDRESS}`);
  console.log(`   - 初始管理人: ${INITIAL_MANAGERS.join(", ")}`);
  console.log(`   - 所需票数: ${REQUIRED_VOTES}`);

  try {
    // ============= 第一步：验证 Custodian 合约 =============
    console.log("\n🔍 验证 Custodian 合约...");
    
    const custodianFixed = await ethers.getContractAt("CustodianFixed", CUSTODIAN_FIXED_ADDRESS);
    
    // 验证合约地址
    const stableTokenAddr = await custodianFixed.stableToken();
    const leverageTokenAddr = await custodianFixed.leverageToken();
    const underlyingTokenAddr = await custodianFixed.underlyingToken();
    
    console.log("✅ Custodian 合约验证成功:");
    console.log(`   - StableToken: ${stableTokenAddr}`);
    console.log(`   - LeverageToken: ${leverageTokenAddr}`);
    console.log(`   - UnderlyingToken: ${underlyingTokenAddr}`);

    // ============= 第二步：部署 LiquidationManager =============
    console.log("\n📦 部署 LiquidationManager 合约...");
    
    const LiquidationManagerFactory = await ethers.getContractFactory("LiquidationManager");
    
    console.log("⏳ 正在部署...");
    const liquidationManager = await LiquidationManagerFactory.deploy(
      CUSTODIAN_FIXED_ADDRESS,
      INITIAL_MANAGERS,
      REQUIRED_VOTES
    );

    console.log("⏳ 等待部署交易确认...");
    const deploymentReceipt = await liquidationManager.waitForDeployment();
    
    const liquidationManagerAddress = await liquidationManager.getAddress();
    console.log("✅ LiquidationManager 部署成功!");
    console.log(`📋 合约地址: ${liquidationManagerAddress}`);
    console.log(`🔗 交易哈希: ${deploymentReceipt.hash}`);
    console.log(`🌐 Etherscan: https://sepolia.etherscan.io/address/${liquidationManagerAddress}`);

    // ============= 第三步：验证部署结果 =============
    console.log("\n🔍 验证部署结果...");
    
    // 验证合约引用
    const deployedCustodian = await liquidationManager.custodian();
    const deployedStableToken = await liquidationManager.stableToken();
    const deployedLeverageToken = await liquidationManager.leverageToken();
    const deployedUnderlyingToken = await liquidationManager.underlyingToken();
    
    console.log("✅ 合约引用验证成功:");
    console.log(`   - Custodian: ${deployedCustodian}`);
    console.log(`   - StableToken: ${deployedStableToken}`);
    console.log(`   - LeverageToken: ${deployedLeverageToken}`);
    console.log(`   - UnderlyingToken: ${deployedUnderlyingToken}`);

    // 验证清算配置
    const config = await liquidationManager.getLiquidationConfig();
    console.log("✅ 清算配置验证成功:");
    console.log(`   - 预警阈值: ${ethers.formatUnits(config.warningThreshold, 18)}`);
    console.log(`   - 清算阈值: ${ethers.formatUnits(config.liquidationThreshold, 18)}`);
    console.log(`   - 惩罚金比例: ${ethers.formatUnits(config.penaltyRate, 18)}`);
    console.log(`   - 宽限期: ${config.gracePeriod} 秒`);
    console.log(`   - 清算功能: ${config.enabled ? "启用" : "禁用"}`);

    // 验证管理人设置
    const managers = await liquidationManager.getAllManagers();
    console.log("✅ 管理人设置验证成功:");
    console.log(`   - 管理人数量: ${managers.length}`);
    console.log(`   - 管理人列表: ${managers.join(", ")}`);

    // 验证所需票数
    const requiredVotes = await liquidationManager.requiredVotes();
    console.log(`   - 所需票数: ${requiredVotes}`);

    // ============= 第四步：保存部署信息 =============
    console.log("\n💾 保存部署信息...");
    
    const deploymentInfo = {
      network: (hre.network as any).name,
      timestamp: new Date().toISOString(),
      contracts: {
        LiquidationManager: liquidationManagerAddress,
        CustodianFixed: CUSTODIAN_FIXED_ADDRESS,
        StableToken: stableTokenAddr,
        LeverageToken: leverageTokenAddr,
        UnderlyingToken: underlyingTokenAddr
      },
      config: {
        initialManagers: INITIAL_MANAGERS,
        requiredVotes: REQUIRED_VOTES,
        liquidationConfig: {
          warningThreshold: config.warningThreshold.toString(),
          liquidationThreshold: config.liquidationThreshold.toString(),
          penaltyRate: config.penaltyRate.toString(),
          gracePeriod: config.gracePeriod.toString(),
          enabled: config.enabled
        }
      },
      deployment: {
        deployer: deployer.address,
        transactionHash: deploymentReceipt.hash,
        blockNumber: deploymentReceipt.blockNumber
      }
    };

    // 保存到文件
    const fs = require('fs');
    const path = require('path');
    
    const deploymentsDir = path.join(__dirname, '../../deployments');
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }
    
    const deploymentFile = path.join(deploymentsDir, `liquidation-${(hre.network as any).name}-${Date.now()}.json`);
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
    
    console.log(`✅ 部署信息已保存到: ${deploymentFile}`);

    // ============= 第五步：后续操作建议 =============
    console.log("\n📋 后续操作建议:");
    console.log("   1. 更新监控脚本中的合约地址");
    console.log("   2. 测试清算功能是否正常工作");
    console.log("   3. 考虑添加更多管理人");
    console.log("   4. 设置合适的清算参数");

    // ============= 成功总结 =============
    console.log("\n🎉 =============== 部署完成 ===============");
    console.log(`✅ LiquidationManager 部署成功!`);
    console.log(`📋 合约地址: ${liquidationManagerAddress}`);
    console.log(`👤 部署账户: ${deployer.address}`);
    console.log(`🌐 网络: ${(hre.network as any).name}`);
    console.log(`🔗 Etherscan: https://sepolia.etherscan.io/address/${liquidationManagerAddress}`);
    console.log("========================================");

  } catch (error: any) {
    console.error("\n❌ 部署失败:");
    console.error("错误信息:", error.message);
    
    // 🔧 增强错误分析
    if (error.message.includes("insufficient funds")) {
      console.log("\n💡 解决建议:");
      console.log("   - 账户 ETH 余额不足支付 Gas");
      console.log("   - 获取测试 ETH: https://sepoliafaucet.com/");
    }
    
    if (error.message.includes("nonce")) {
      console.log("\n💡 Nonce 问题:");
      console.log("   - 可能的原因：交易 nonce 冲突");
      console.log("   - 建议等待一段时间后重试");
    }
    
    if (error.message.includes("execution reverted")) {
      console.log("\n💡 合约执行失败:");
      console.log("   - 可能的原因：构造函数参数无效");
      console.log("   - 建议检查所有部署参数");
    }
    
    if (error.message.includes("Invalid custodian address")) {
      console.log("\n💡 Custodian 地址问题:");
      console.log("   - 提供的 Custodian 地址无效");
      console.log("   - 请检查地址是否正确部署");
    }
    
    process.exit(1);
  }
}

// 导出部署函数
export { main };

// 主执行逻辑
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error: Error) => {
      console.error("部署脚本执行失败:", error);
      process.exit(1);
    });
}
