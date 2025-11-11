import hre from "hardhat";

/*
npx hardhat run scripts/deploy/deploy_InterestManager_Custodian.ts --network sepolia


📋 =============== 部署摘要 ===============
✅ 所有合约部署、初始化和启动成功!

📄 新部署的合约:
   - InterestManager: 0x10CE62AD5971D90e8D3Cc0B498d388E0d32F2321
   - CustodianFixed: 0x9Fb49EfD7dC50068eb19Cc7E4ac9cA77bCe9114A

🔗 使用的已有合约:
   - 底层资产: 0x9DFF6745444c05bbEc03bF59C0910731C02950dd
   - StableToken: 0xc737f2b19790120032327F7c6fCF886DA9ed672f
   - LeverageToken: 0x89106De21Be816F3823b7011C91569C27Cf8C18a
   - LTC Oracle: 0x0A0a35875bd2A7087D50c56A83D2571A50224eE5

⚙️ 系统配置:
   - 年化利率: 3%
   - 费用收集器: 0x4845d4db01b81A15559b8734D234e6202C556d32
   - 网络: sepolia
*/

async function main(): Promise<void> {
  const ethers = (hre as any).ethers;

  console.log("🚀 开始部署 InterestManager 和 CustodianFixed 合约...");
  console.log("📡 当前网络:", hre.network.name);

  const [deployer] = await ethers.getSigners();
  console.log("👤 部署账户:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 账户余额:", ethers.formatEther(balance), "ETH");

  // ============= 已部署的合约地址 =============
  const UNDERLYING_TOKEN_ADDRESS = "0x9DFF6745444c05bbEc03bF59C0910731C02950dd";
  const STABLE_TOKEN_ADDRESS = "0xc737f2b19790120032327F7c6fCF886DA9ed672f";
  const LEVERAGE_TOKEN_ADDRESS = "0x89106De21Be816F3823b7011C91569C27Cf8C18a";
  const LTC_ORACLE_ADDRESS = "0x0A0a35875bd2A7087D50c56A83D2571A50224eE5";

  console.log("\n📋 使用的已部署合约:");
  console.log(`   - 底层资产: ${UNDERLYING_TOKEN_ADDRESS}`);
  console.log(`   - StableToken: ${STABLE_TOKEN_ADDRESS}`);
  console.log(`   - LeverageToken: ${LEVERAGE_TOKEN_ADDRESS}`);
  console.log(`   - LTCOracle: ${LTC_ORACLE_ADDRESS}`);

  try {
    // ============= 第一步：验证已部署合约的权限 =============
    console.log("\n🔍 验证已部署合约权限...");
    
    const stableToken = await ethers.getContractAt("StableToken", STABLE_TOKEN_ADDRESS);
    const leverageToken = await ethers.getContractAt("MultiLeverageToken", LEVERAGE_TOKEN_ADDRESS);
    
    // 检查当前 custodian 和 owner
    try {
      const stableCustodian = await stableToken.custodian();
      const leverageCustodian = await leverageToken.custodian();
      const stableOwner = await stableToken.owner();
      const leverageOwner = await leverageToken.owner();
      
      console.log(`📋 StableToken 当前 custodian: ${stableCustodian}`);
      console.log(`📋 LeverageToken 当前 custodian: ${leverageCustodian}`);
      console.log(`📋 StableToken owner: ${stableOwner}`);
      console.log(`📋 LeverageToken owner: ${leverageOwner}`);
      console.log(`📋 当前部署者: ${deployer.address}`);
      
      // 验证权限
      if (stableOwner.toLowerCase() !== deployer.address.toLowerCase()) {
        throw new Error(`❌ 权限不足: StableToken owner (${stableOwner}) 不是当前部署者 (${deployer.address})`);
      }
      
      if (leverageOwner.toLowerCase() !== deployer.address.toLowerCase()) {
        throw new Error(`❌ 权限不足: LeverageToken owner (${leverageOwner}) 不是当前部署者 (${deployer.address})`);
      }
      
      console.log("✅ 权限验证通过");
      
    } catch (permissionError: any) {
      console.error("❌ 权限验证失败:", permissionError.message);
      throw permissionError;
    }

    // ============= 第二步：部署 InterestManager =============
    console.log("\n📄 部署 InterestManager 合约...");
    
    const ANNUAL_INTEREST_RATE = 300; // 3%
    console.log(`💰 设置年化利率: ${ANNUAL_INTEREST_RATE / 100}%`);

    const InterestManagerFactory = await ethers.getContractFactory("InterestManager");
    const interestManager = await InterestManagerFactory.deploy(
      UNDERLYING_TOKEN_ADDRESS,
      ANNUAL_INTEREST_RATE
    );

    console.log("⏳ 等待 InterestManager 部署确认...");
    await interestManager.waitForDeployment();
    
    const interestManagerAddress = await interestManager.getAddress();
    console.log("✅ InterestManager 部署成功!");
    console.log("📄 合约地址:", interestManagerAddress);

    // ============= 第三步：部署 CustodianFixed =============
    console.log("\n📄 部署 CustodianFixed 合约...");

    const CustodianFixedFactory = await ethers.getContractFactory("CustodianFixed");
    const custodianFixed = await CustodianFixedFactory.deploy(
      UNDERLYING_TOKEN_ADDRESS,
      STABLE_TOKEN_ADDRESS,
      LEVERAGE_TOKEN_ADDRESS
    );

    console.log("⏳ 等待 CustodianFixed 部署确认...");
    await custodianFixed.waitForDeployment();
    
    const custodianFixedAddress = await custodianFixed.getAddress();
    console.log("✅ CustodianFixed 部署成功!");
    console.log("📄 合约地址:", custodianFixedAddress);

    // ============= 第四步：初始化 InterestManager =============
    console.log("\n🔧 初始化 InterestManager...");
    
    try {
      const initIMTx = await interestManager.initialize(
        LEVERAGE_TOKEN_ADDRESS,
        custodianFixedAddress
      );
      await initIMTx.wait();
      console.log("✅ InterestManager 初始化完成");
    } catch (initError: any) {
      console.error("❌ InterestManager 初始化失败:", initError.message);
      throw initError;
    }

    // ============= 第五步：设置 Token 合约的 Custodian =============
    console.log("\n🔑 设置 Token 合约的 Custodian...");
    
    try {
      // 设置 StableToken 的 custodian
      console.log("🔄 设置 StableToken custodian...");
      const setStableCustodianTx = await stableToken.setCustodian(custodianFixedAddress);
      await setStableCustodianTx.wait();
      console.log("✅ StableToken custodian 设置成功");
      
      // 验证设置结果
      const newStableCustodian = await stableToken.custodian();
      console.log(`🔍 StableToken 新 custodian: ${newStableCustodian}`);
      
    } catch (stableError: any) {
      console.error("❌ 设置 StableToken custodian 失败:", stableError.message);
      throw stableError;
    }

    try {
      // 设置 LeverageToken 的 custodian
      console.log("🔄 设置 LeverageToken custodian...");
      const setLeverageCustodianTx = await leverageToken.setCustodian(custodianFixedAddress);
      await setLeverageCustodianTx.wait();
      console.log("✅ LeverageToken custodian 设置成功");
      
      // 验证设置结果
      const newLeverageCustodian = await leverageToken.custodian();
      console.log(`🔍 LeverageToken 新 custodian: ${newLeverageCustodian}`);
      
    } catch (leverageError: any) {
      console.error("❌ 设置 LeverageToken custodian 失败:", leverageError.message);
      throw leverageError;
    }

    // ============= 第六步：初始化并启动 CustodianFixed 系统 =============
    console.log("\n🚀 初始化并启动 CustodianFixed 系统...");
    
    try {
      // 🔧 现在 initializeSystem 会检查 custodian 设置并直接启动系统
      console.log("🔧 调用 initializeSystem...");
      const initCFTx = await custodianFixed.initializeSystem(
        interestManagerAddress,
        LTC_ORACLE_ADDRESS,
        deployer.address
      );
      await initCFTx.wait();
      console.log("✅ CustodianFixed 系统初始化并启动完成");
      
    } catch (initError: any) {
      console.error("❌ CustodianFixed 系统初始化失败:", initError.message);
      
      // 详细错误分析
      if (initError.message.includes("custodian not set")) {
        console.log("💡 可能原因: Custodian 未正确设置");
        console.log("   - 检查 StableToken 和 LeverageToken 的 custodian");
        console.log("   - 确认 setCustodian 调用成功");
      } else if (initError.message.includes("System already initialized")) {
        console.log("💡 可能原因: 系统已经初始化过");
        console.log("   - 这可能表示合约已经可用");
      } else if (initError.message.includes("Invalid")) {
        console.log("💡 可能原因: 传入参数无效");
        console.log("   - 检查 InterestManager、PriceFeed、FeeCollector 地址");
      } else {
        console.log("💡 建议: 检查 initializeSystem 函数的所有前置条件");
      }
      
      throw initError;
    }

    // ============= 第七步：系统功能验证 =============
    console.log("\n🔍 系统功能验证...");
    
    try {
      // 验证基本信息
      const cfPriceFeed = await custodianFixed.priceFeed();
      const cfInterestManager = await custodianFixed.interestManager();
      const cfFeeCollector = await custodianFixed.feeCollector();

      console.log("🔍 系统组件验证:");
      console.log(`   - 价格预言机: ${cfPriceFeed}`);
      console.log(`   - 利息管理器: ${cfInterestManager}`);
      console.log(`   - 费用收集器: ${cfFeeCollector}`);
      
      // 验证 custodian 设置
      const finalStableCustodian = await stableToken.custodian();
      const finalLeverageCustodian = await leverageToken.custodian();
      
      console.log("🔍 Custodian 验证:");
      console.log(`   - StableToken custodian: ${finalStableCustodian}`);
      console.log(`   - LeverageToken custodian: ${finalLeverageCustodian}`);
      console.log(`   - CustodianFixed 地址: ${custodianFixedAddress}`);
      
      const custodiansCorrect = (
        finalStableCustodian.toLowerCase() === custodianFixedAddress.toLowerCase() &&
        finalLeverageCustodian.toLowerCase() === custodianFixedAddress.toLowerCase()
      );
      console.log(`   - Custodian 设置正确: ${custodiansCorrect ? "✅" : "❌"}`);

      // 测试价格获取
      try {
        const priceResult = await custodianFixed.getLatestPriceView();
        console.log(`📊 LTC 价格测试: $${ethers.formatUnits(priceResult[0], 18)}`);
        console.log(`   - 价格有效性: ${priceResult[2] ? "✅ 有效" : "❌ 无效"}`);
        
        if (priceResult[0] === 0n) {
          console.log("⚠️ 价格为 0，可能需要更新 LTC 预言机");
        }
      } catch (priceError: any) {
        console.log(`⚠️ 价格获取失败: ${priceError.message}`);
      }

      // 测试项目统计
      try {
        const projectStats = await custodianFixed.getProjectStats();
        console.log("📊 项目统计:");
        console.log(`   - S Token 供应量: ${ethers.formatUnits(projectStats[0], 18)}`);
        console.log(`   - L Token 供应量: ${ethers.formatUnits(projectStats[1], 18)}`);
        console.log(`   - 锁定资产总量: ${ethers.formatUnits(projectStats[2], 18)}`);
      } catch (statsError: any) {
        console.log(`⚠️ 统计信息获取失败: ${statsError.message}`);
      }

      // 测试 mint 预览功能
      try {
        const testAmount = ethers.parseUnits("1.0", 18);
        const testPrice = ethers.parseUnits("120.00", 18);
        
        const mintPreview = await custodianFixed.previewMint(
          testAmount,
          1, // MODERATE
          testPrice,
          testPrice
        );
        
        console.log("🧪 Mint 预览功能测试:");
        console.log(`   - 投入: ${ethers.formatUnits(testAmount, 18)} underlying`);
        console.log(`   - 获得 S Token: ${ethers.formatUnits(mintPreview[0], 18)}`);
        console.log(`   - 获得 L Token: ${ethers.formatUnits(mintPreview[1], 18)}`);
        console.log(`   - 净值: ${ethers.formatUnits(mintPreview[2], 18)}`);
        console.log("✅ Mint 预览功能正常");
        
      } catch (mintError: any) {
        console.log("❌ Mint 预览测试失败:", mintError.message);
      }

    } catch (verifyError: any) {
      console.log(`⚠️ 系统验证部分失败: ${verifyError.message}`);
    }

    // ============= 输出最终部署摘要 =============
    console.log("\n📋 =============== 部署摘要 ===============");
    console.log("✅ 所有合约部署、初始化和启动成功!");
    console.log("");
    console.log("📄 新部署的合约:");
    console.log(`   - InterestManager: ${interestManagerAddress}`);
    console.log(`   - CustodianFixed: ${custodianFixedAddress}`);
    console.log("");
    console.log("🔗 使用的已有合约:");
    console.log(`   - 底层资产: ${UNDERLYING_TOKEN_ADDRESS}`);
    console.log(`   - StableToken: ${STABLE_TOKEN_ADDRESS}`);
    console.log(`   - LeverageToken: ${LEVERAGE_TOKEN_ADDRESS}`);
    console.log(`   - LTC Oracle: ${LTC_ORACLE_ADDRESS}`);
    console.log("");
    console.log("⚙️ 系统配置:");
    console.log(`   - 年化利率: ${ANNUAL_INTEREST_RATE / 100}%`);
    console.log(`   - 费用收集器: ${deployer.address}`);
    console.log(`   - 网络: ${hre.network.name}`);
    console.log("");
    console.log("🔍 Etherscan 验证:");
    console.log(`   - InterestManager: https://sepolia.etherscan.io/address/${interestManagerAddress}`);
    console.log(`   - CustodianFixed: https://sepolia.etherscan.io/address/${custodianFixedAddress}`);
    console.log("");
    console.log("🎯 下一步操作:");
    console.log("1. 🔍 在 Etherscan 上验证合约源码");
    console.log("2. 💰 向底层资产合约转入测试代币（如果需要）");
    console.log("3. 🧪 测试实际的 mint/burn 功能");
    console.log("4. 📊 监控系统运行状态和利息计算");
    console.log("5. 🔄 如果价格为 0，更新 LTC 预言机价格");
    console.log("");
    console.log("✨ 系统现在已经完全就绪，可以开始正常使用！");
    console.log("========================================");

    // ============= 保存部署信息 =============
    const deploymentInfo = {
      network: hre.network.name,
      deployer: deployer.address,
      timestamp: new Date().toISOString(),
      contracts: {
        interestManager: {
          address: interestManagerAddress,
          annualRate: ANNUAL_INTEREST_RATE,
          underlyingToken: UNDERLYING_TOKEN_ADDRESS,
          initialized: true
        },
        custodianFixed: {
          address: custodianFixedAddress,
          underlyingToken: UNDERLYING_TOKEN_ADDRESS,
          stableToken: STABLE_TOKEN_ADDRESS,
          leverageToken: LEVERAGE_TOKEN_ADDRESS,
          interestManager: interestManagerAddress,
          priceFeed: LTC_ORACLE_ADDRESS,
          feeCollector: deployer.address,
          systemInitialized: true,
          tradingActive: true
        }
      },
      tokenCustodians: {
        stableToken: await stableToken.custodian(),
        leverageToken: await leverageToken.custodian()
      },
      systemConfig: {
        annualInterestRate: ANNUAL_INTEREST_RATE,
        priceMaxAge: 3600,
        tradingActive: true
      }
    };

    console.log("\n💾 部署信息 (JSON):");
    console.log(JSON.stringify(deploymentInfo, null, 2));

  } catch (error: any) {
    console.error("\n❌ 部署失败:");
    console.error("错误信息:", error.message);
    
    if (error.message.includes("insufficient funds")) {
      console.log("\n💡 解决建议:");
      console.log("   - 账户ETH余额不足");
      console.log("   - 获取测试ETH: https://sepoliafaucet.com/");
    }
    
    if (error.message.includes("权限不足") || error.message.includes("owner")) {
      console.log("\n💡 权限问题:");
      console.log("   - 检查是否为 StableToken 和 LeverageToken 的 owner");
      console.log("   - 确认当前部署账户有足够权限");
      console.log("   - 可能需要先转移合约所有权");
    }

    if (error.message.includes("execution reverted")) {
      console.log("\n💡 合约执行失败:");
      console.log("   - 检查合约状态和前置条件");
      console.log("   - 验证所有地址是否正确");
      console.log("   - 确认 custodian 设置是否成功");
    }

    if (error.message.includes("setCustodian")) {
      console.log("\n💡 setCustodian 失败:");
      console.log("   - 确认当前账户是 StableToken 和 LeverageToken 的 owner");
      console.log("   - 检查 custodian 地址是否有效");
      console.log("   - 验证合约状态是否允许设置 custodian");
    }

    if (error.message.includes("custodian not set")) {
      console.log("\n💡 custodian 验证失败:");
      console.log("   - initializeSystem 要求 custodian 已经设置");
      console.log("   - 检查 setCustodian 调用是否成功");
      console.log("   - 验证 custodian 地址是否正确");
    }
    
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log("\n🎉 InterestManager 和 CustodianFixed 部署完成!");
    console.log("✨ 系统已完全启动，可以开始使用 mint/burn 功能！");
    process.exit(0);
  })
  .catch((error: Error) => {
    console.error("\n💥 脚本执行失败:", error);
    process.exit(1);
  });