import hre from "hardhat";

async function main(): Promise<void> {
  const ethers = (hre as any).ethers;

  console.log("🪙 开始铸币操作...");
  console.log("📡 当前网络:", (hre.network as any).name);

  const [minter] = await ethers.getSigners();
  console.log("👤 铸币账户:", minter.address);

  // ============= 已部署的合约地址 =============
  const UNDERLYING_TOKEN_ADDRESS = "0x9DFF6745444c05bbEc03bF59C0910731C02950dd"; // WLTC
  const STABLE_TOKEN_ADDRESS = "0xc737f2b19790120032327F7c6fCF886DA9ed672f";
  const LEVERAGE_TOKEN_ADDRESS = "0x89106De21Be816F3823b7011C91569C27Cf8C18a";
  const CUSTODIAN_FIXED_ADDRESS = "0x9Fb49EfD7dC50068eb19Cc7E4ac9cA77bCe9114A";

  // ============= 杠杆级别定义 =============
  const LeverageType = {
    CONSERVATIVE: 0, // 1:8 比例，低杠杆
    MODERATE: 1,     // 1:4 比例，中等杠杆
    AGGRESSIVE: 2    // 1:1 比例，高杠杆
  } as const;

  // ============= 铸币参数设置 =============
  const UNDERLYING_AMOUNT = ethers.parseUnits("1.0", 18); // 投入 1 个 WLTC
  const MINT_PRICE = ethers.parseUnits("120.0", 18);        // 铸币价格 $120
  const LEVERAGE_LEVEL = LeverageType.MODERATE;            // 使用枚举类型

  // 🔧 辅助函数：获取杠杆级别描述
  function getLeverageDescription(level: number): string {
    switch (level) {
      case LeverageType.CONSERVATIVE:
        return "CONSERVATIVE (1:8)";
      case LeverageType.MODERATE:
        return "MODERATE (1:4)";
      case LeverageType.AGGRESSIVE:
        return "AGGRESSIVE (1:1)";
      default:
        return "UNKNOWN";
    }
  }

  console.log("\n💰 铸币参数:");
  console.log(`   - 投入数量: ${ethers.formatUnits(UNDERLYING_AMOUNT, 18)} WLTC`);
  console.log(`   - 铸币价格: $${ethers.formatUnits(MINT_PRICE, 18)}`);
  console.log(`   - 杠杆级别: ${getLeverageDescription(LEVERAGE_LEVEL)}`);

  try {
    // ============= 第一步：连接合约 =============
    console.log("\n🔗 连接合约...");
    
    const underlyingToken = await ethers.getContractAt("WLTCMock", UNDERLYING_TOKEN_ADDRESS);
    const stableToken = await ethers.getContractAt("StableToken", STABLE_TOKEN_ADDRESS);
    const leverageToken = await ethers.getContractAt("MultiLeverageToken", LEVERAGE_TOKEN_ADDRESS);
    const custodianFixed = await ethers.getContractAt("CustodianFixed", CUSTODIAN_FIXED_ADDRESS);

    console.log("✅ 所有合约连接成功");

    // ============= 第二步：检查余额和授权 =============
    console.log("\n💳 检查账户余额和授权...");
    
    const wltcBalance = await underlyingToken.balanceOf(minter.address);
    const allowance = await underlyingToken.allowance(minter.address, CUSTODIAN_FIXED_ADDRESS);
    
    console.log(`📋 WLTC 余额: ${ethers.formatUnits(wltcBalance, 18)}`);
    console.log(`📋 已授权额度: ${ethers.formatUnits(allowance, 18)}`);

    // 检查余额是否足够
    if (wltcBalance < UNDERLYING_AMOUNT) {
      throw new Error(`❌ WLTC 余额不足: 需要 ${ethers.formatUnits(UNDERLYING_AMOUNT, 18)}，当前 ${ethers.formatUnits(wltcBalance, 18)}`);
    }

    // 检查授权是否足够
    if (allowance < UNDERLYING_AMOUNT) {
      console.log("🔓 需要增加授权额度...");
      
      const approveTx = await underlyingToken.approve(
        CUSTODIAN_FIXED_ADDRESS, 
        UNDERLYING_AMOUNT
      );
      console.log("⏳ 等待授权交易确认...");
      await approveTx.wait();
      
      const newAllowance = await underlyingToken.allowance(minter.address, CUSTODIAN_FIXED_ADDRESS);
      console.log(`✅ 授权成功，新额度: ${ethers.formatUnits(newAllowance, 18)}`);
    } else {
      console.log("✅ 授权额度充足");
    }

    // ============= 第三步：获取当前价格 =============
    console.log("\n📊 获取当前 LTC 价格...");
    
    let currentPriceForCalculation = MINT_PRICE; // 默认使用铸币价格
    
    try {
      const priceResult = await custodianFixed.getLatestPriceView();
      const currentPrice = priceResult[0];
      const priceTimestamp = priceResult[1];
      const isValid = priceResult[2];
      
      if (isValid && currentPrice > 0) {
        console.log(`📈 当前 LTC 价格: $${ethers.formatUnits(currentPrice, 18)}`);
        console.log(`📅 价格时间戳: ${new Date(Number(priceTimestamp) * 1000).toLocaleString()}`);
        currentPriceForCalculation = currentPrice;
      } else {
        console.log("⚠️ 价格数据无效，使用铸币价格作为当前价格");
      }
    } catch (priceError: any) {
      console.log("⚠️ 获取价格失败:", priceError.message);
      console.log("💡 继续使用设定的铸币价格");
    }

    // ============= 第四步：预览铸币结果 =============
    console.log("\n🔮 预览铸币结果...");
    
    try {
      const previewResult = await custodianFixed.previewMint(
        UNDERLYING_AMOUNT,
        LEVERAGE_LEVEL,           // 使用枚举值
        MINT_PRICE,
        currentPriceForCalculation
      );
      
      const sAmount = previewResult[0];
      const lAmount = previewResult[1];
      const nav = previewResult[2];
      
      console.log("📊 预览结果:");
      console.log(`   - 将获得 S Token: ${ethers.formatUnits(sAmount, 18)}`);
      console.log(`   - 将获得 L Token: ${ethers.formatUnits(lAmount, 18)}`);
      console.log(`   - 初始净值: ${ethers.formatUnits(nav, 18)}`);
      
      // 🔧 计算投入产出比
      const totalValueOut = sAmount + lAmount;
      const valueRatio = Number(ethers.formatUnits(totalValueOut, 18)) / Number(ethers.formatUnits(UNDERLYING_AMOUNT, 18));
      console.log(`   - 价值转换比: ${valueRatio.toFixed(4)}:1`);
      
    } catch (previewError: any) {
      console.log("⚠️ 预览失败:", previewError.message);
      console.log("💡 继续执行铸币操作");
    }

    // ============= 第五步：执行铸币 =============
    console.log("\n🪙 执行铸币操作...");
    
    console.log("📝 铸币参数确认:");
    console.log(`   - underlyingTokenFrom: ${minter.address}`);
    console.log(`   - StokenTo: ${minter.address}`);
    console.log(`   - LtokenTo: ${minter.address}`);
    console.log(`   - underlyingAmount: ${ethers.formatUnits(UNDERLYING_AMOUNT, 18)}`);
    console.log(`   - mintPrice: ${ethers.formatUnits(MINT_PRICE, 18)}`);
    console.log(`   - leverageLevel: ${LEVERAGE_LEVEL} (${getLeverageDescription(LEVERAGE_LEVEL)})`);

    // 估算 gas
    try {
      const estimatedGas = await custodianFixed.mint.estimateGas(
        UNDERLYING_AMOUNT, // underlyingAmountInWei - 投入的 WLTC 数量
        MINT_PRICE,        // mintPriceInWei - 铸币价格
        LEVERAGE_LEVEL,    // leverageLevel - 杠杆级别 (枚举类型)
        {
          gasLimit: 800000 // 🔧 增加 gas limit，确保交易成功
        }
      );
      console.log(`⛽ 估算 Gas: ${estimatedGas.toString()}`);
    } catch (gasError: any) {
      console.log("⚠️ Gas 估算失败:", gasError.message);
    }

    // 执行铸币交易
    const mintTx = await custodianFixed.mint(
      UNDERLYING_AMOUNT, // underlyingAmountInWei - 投入的 WLTC 数量
      MINT_PRICE,        // mintPriceInWei - 铸币价格
      LEVERAGE_LEVEL,    // leverageLevel - 杠杆级别 (枚举类型)
      {
        gasLimit: 800000 // 🔧 增加 gas limit，确保交易成功
      }
    );

    console.log("⏳ 等待铸币交易确认...");
    console.log(`🔗 交易哈希: ${mintTx.hash}`);
    
    const receipt = await mintTx.wait();
    console.log("✅ 铸币交易确认成功!");
    console.log(`📋 区块号: ${receipt.blockNumber}`);
    console.log(`⛽ 实际 Gas 使用: ${receipt.gasUsed.toString()}`);

    // ============= 第六步：解析交易结果 =============
    console.log("\n📊 解析铸币结果...");
    
    // 查找 Mint 事件
    const mintEvent = receipt.logs.find((log: any) => {
      try {
        const parsedLog = custodianFixed.interface.parseLog(log);
        return parsedLog && parsedLog.name === 'Mint';
      } catch {
        return false;
      }
    });

    if (mintEvent) {
      const parsedLog = custodianFixed.interface.parseLog(mintEvent);
      const args = parsedLog.args;
      
      console.log("🎉 铸币成功详情:");
      console.log(`   - 用户地址: ${args.user}`);
      console.log(`   - 投入数量: ${ethers.formatUnits(args.underlyingAmountInWei, 18)} WLTC`);
      console.log(`   - 杠杆级别: ${args.leverageLevel.toString()} (${getLeverageDescription(Number(args.leverageLevel))})`);
      console.log(`   - 铸币价格: $${ethers.formatUnits(args.mintPriceInWei, 18)}`);
      console.log(`   - 获得 S Token: ${ethers.formatUnits(args.sAmountInWei, 18)}`);
      console.log(`   - 获得 L Token: ${ethers.formatUnits(args.lAmountInWei, 18)}`);
    }

    // ============= 第七步：验证余额变化 =============
    console.log("\n💳 验证余额变化...");
    
    const newWltcBalance = await underlyingToken.balanceOf(minter.address);
    const sTokenBalance = await stableToken.balanceOf(minter.address);
    const newAllowance = await underlyingToken.allowance(minter.address, CUSTODIAN_FIXED_ADDRESS);
    
    console.log("📊 余额变化:");
    console.log(`   - WLTC 余额: ${ethers.formatUnits(wltcBalance, 18)} → ${ethers.formatUnits(newWltcBalance, 18)}`);
    console.log(`   - 消耗 WLTC: ${ethers.formatUnits(wltcBalance - newWltcBalance, 18)}`);
    console.log(`   - S Token 余额: ${ethers.formatUnits(sTokenBalance, 18)}`);
    console.log(`   - 剩余授权: ${ethers.formatUnits(newAllowance, 18)}`);

    // 检查 L Token 余额（需要获取 tokenId）
    try {
      const userTokenInfo = await custodianFixed.getAllLeverageTokenInfo(minter.address);
      if (userTokenInfo[0].length > 0) {
        console.log("\n🎯 L Token 持仓:");
        for (let i = 0; i < userTokenInfo[0].length; i++) {
          const tokenId = userTokenInfo[0][i];
          const balance = userTokenInfo[1][i];
          const leverage = userTokenInfo[2][i];
          const mintPrice = userTokenInfo[3][i];
          const accruedInterest = userTokenInfo[4][i];
          
          console.log(`   - Token ID ${tokenId.toString()}: ${ethers.formatUnits(balance, 18)} 个`);
          console.log(`     杠杆: ${getLeverageDescription(Number(leverage))}`);
          console.log(`     铸币价格: $${ethers.formatUnits(mintPrice, 18)}`);
          console.log(`     累积利息: ${ethers.formatUnits(accruedInterest, 18)}`);
        }
      }
    } catch (tokenError: any) {
      console.log("⚠️ 获取 L Token 信息失败:", tokenError.message);
    }

    // ============= 第八步：计算净值信息 =============
    console.log("\n📈 计算当前净值信息...");
    
    try {
      const userTokenInfo = await custodianFixed.getAllLeverageTokenInfo(minter.address);
      if (userTokenInfo[0].length > 0) {
        const tokenId = userTokenInfo[0][userTokenInfo[0].length - 1]; // 获取最新的 token
        
        const navInfo = await custodianFixed.getSingleLeverageTokenNav(
          minter.address,
          tokenId,
          currentPriceForCalculation
        );
        
        console.log(`🎯 Token ID ${tokenId.toString()} 净值信息:`);
        console.log(`   - 持有数量: ${ethers.formatUnits(navInfo[0], 18)}`);
        console.log(`   - 总净值: ${ethers.formatUnits(navInfo[1], 18)}`);
        console.log(`   - 除息净值: ${ethers.formatUnits(navInfo[2], 18)}`);
        console.log(`   - 总价值: ${ethers.formatUnits(navInfo[3], 18)}`);
        console.log(`   - 净价值: ${ethers.formatUnits(navInfo[4], 18)}`);
        console.log(`   - 累积利息: ${ethers.formatUnits(navInfo[5], 18)}`);
        
      }
    } catch (navError: any) {
      console.log("⚠️ 获取净值信息失败:", navError.message);
    }

    // ============= 成功总结 =============
    console.log("\n🎉 =============== 铸币成功 ===============");
    console.log(`✅ 成功投入 ${ethers.formatUnits(UNDERLYING_AMOUNT, 18)} WLTC`);
    console.log(`💰 获得 S Token 和 L Token`);
    console.log(`🎯 杠杆级别: ${getLeverageDescription(LEVERAGE_LEVEL)}`);
    console.log(`🔗 交易哈希: ${mintTx.hash}`);
    console.log(`🌐 Etherscan: https://sepolia.etherscan.io/tx/${mintTx.hash}`);
    console.log("========================================");

  } catch (error: any) {
    console.error("\n❌ 铸币失败:");
    console.error("错误信息:", error.message);
    
    // 🔧 增强错误分析
    if (error.message.includes("insufficient funds")) {
      console.log("\n💡 解决建议:");
      console.log("   - 账户 ETH 余额不足支付 Gas");
      console.log("   - 获取测试 ETH: https://sepoliafaucet.com/");
    }
    
    if (error.message.includes("ERC20: insufficient allowance") || 
        error.message.includes("Underlying token transfer failed")) {
      console.log("\n💡 授权/转账问题:");
      console.log("   - WLTC 授权额度不足或转账失败");
      console.log("   - 检查 WLTC 余额和授权状态");
      console.log("   - 重新运行脚本会自动处理授权");
    }
    
    if (error.message.includes("Invalid state")) {
      console.log("\n💡 合约状态问题:");
      console.log("   - CustodianFixed 可能未激活或不在 Trading 状态");
      console.log("   - 检查系统是否正确初始化");
    }

    if (error.message.includes("Invalid leverage level")) {
      console.log("\n💡 杠杆级别问题:");
      console.log("   - 杠杆级别值无效");
      console.log(`   - 当前设置: ${LEVERAGE_LEVEL}`);
      console.log("   - 有效值: 0=CONSERVATIVE, 1=MODERATE, 2=AGGRESSIVE");
    }

    if (error.message.includes("PriceFeed not initialized") || 
        error.message.includes("Chainlink")) {
      console.log("\n💡 价格预言机问题:");
      console.log("   - 价格预言机未初始化或数据无效");
      console.log("   - 检查 Chainlink 价格数据是否正常");
    }

    if (error.message.includes("execution reverted")) {
      console.log("\n💡 合约执行失败:");
      console.log("   - 可能的原因：合约逻辑错误、参数无效、状态不匹配");
      console.log("   - 建议检查所有参数和合约状态");
    }
    
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log("\n🎊 铸币脚本执行完成!");
    process.exit(0);
  })
  .catch((error: Error) => {
    console.error("\n💥 脚本执行失败:", error);
    process.exit(1);
  });
