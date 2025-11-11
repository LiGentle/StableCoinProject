import hre from "hardhat";

async function main(): Promise<void> {
  const ethers = (hre as any).ethers;

  console.log("📊 Oracle 价格更新器 & 净值计算器");
  console.log("📡 当前网络:", hre.network.name);

  const [operator] = await ethers.getSigners();
  console.log("👤 操作账户:", operator.address);

  // ============= 合约地址配置 =============
  const CUSTODIAN_FIXED_ADDRESS = "0x2e3E65a236c563a18d471278817722fE3fECd15e";
  const LTC_ORACLE_ADDRESS = "0x388Cb23D76465E8B0BE0004aE329BF0b63f671c8";
  const TEST_USER_ADDRESS = operator.address; // 测试用户地址（可修改为其他地址）

  // ============= 杠杆级别枚举 =============
  enum LeverageType {
    CONSERVATIVE = 0, // 1:8 比例，低杠杆
    MODERATE = 1,     // 1:4 比例，中等杠杆
    AGGRESSIVE = 2    // 1:1 比例，高杠杆
  }

  // ============= 测试价格序列 =============
  const TEST_PRICES = [
    { price: "100.00", description: "较低价格 $100" },
    { price: "110.00", description: "略低价格 $110" },
    { price: "120.00", description: "基准价格 $120" },
    { price: "130.00", description: "略高价格 $130" },
    { price: "140.00", description: "较高价格 $140" },
    { price: "150.00", description: "高价格 $150" },
    { price: "80.00", description: "低价格 $80 (测试负净值)" },
    { price: "200.00", description: "极高价格 $200" }
  ];

  try {
    // ============= 连接合约 =============
    console.log("\n🔗 连接合约...");
    
    const custodianFixed = await ethers.getContractAt("CustodianFixed", CUSTODIAN_FIXED_ADDRESS);
    const ltcOracle = await ethers.getContractAt("LTCPriceOracle", LTC_ORACLE_ADDRESS);

    console.log("✅ 合约连接成功");

    // ============= 获取用户当前持仓信息 =============
    console.log("\n👤 获取用户持仓信息...");
    
    let userTokenInfo;
    try {
      userTokenInfo = await custodianFixed.getAllLeverageTokenInfo(TEST_USER_ADDRESS);
      
      if (userTokenInfo[0].length === 0) {
        console.log("⚠️ 用户暂无 L Token 持仓");
        console.log("💡 请先运行铸币脚本创建持仓");
        console.log("   npx hardhat run scripts/utilities/mint_SLtoken.ts --network sepolia");
        
        // 显示模拟计算，假设有持仓
        console.log("\n🧮 将进行模拟净值计算（假设持仓数据）");
        userTokenInfo = [
          [ethers.getBigInt("1")], // tokenIds - 假设 tokenId 为 1
          [ethers.parseUnits("100", 18)], // balances - 假设持有 100 个 L token
          [LeverageType.MODERATE], // leverages - 假设中等杠杆
          [ethers.parseUnits("120", 18)], // mintPrices - 假设铸币价格 $120
          [ethers.parseUnits("5", 18)] // accruedInterests - 假设累积利息 5
        ];
        console.log("📊 模拟持仓数据:");
        console.log(`   - Token ID: 1`);
        console.log(`   - 持仓数量: 100 L Token`);
        console.log(`   - 杠杆类型: MODERATE (1:4)`);
        console.log(`   - 铸币价格: $120`);
        console.log(`   - 累积利息: 5`);
      } else {
        console.log("✅ 用户持仓信息:");
        for (let i = 0; i < userTokenInfo[0].length; i++) {
          const tokenId = userTokenInfo[0][i];
          const balance = userTokenInfo[1][i];
          const leverage = userTokenInfo[2][i];
          const mintPrice = userTokenInfo[3][i];
          const accruedInterest = userTokenInfo[4][i];
          
          console.log(`   📋 Token ID ${tokenId.toString()}:`);
          console.log(`      - 持仓数量: ${ethers.formatUnits(balance, 18)}`);
          console.log(`      - 杠杆类型: ${getLeverageDescription(Number(leverage))}`);
          console.log(`      - 铸币价格: $${ethers.formatUnits(mintPrice, 18)}`);
          console.log(`      - 累积利息: ${ethers.formatUnits(accruedInterest, 18)}`);
        }
      }
    } catch (tokenError: any) {
      console.log("⚠️ 获取用户持仓失败:", tokenError.message);
      return;
    }

    // ============= 获取当前 Oracle 价格 =============
    console.log("\n📈 获取当前 Oracle 价格...");
    
      try {
        const currentPriceResult = await custodianFixed.getLatestPriceView();
        const currentPrice = currentPriceResult[0];
        const timestamp = currentPriceResult[1];
        const isValid = currentPriceResult[2];

        if (isValid && currentPrice > 0) {
          console.log(`📊 当前 Oracle 价格: $${ethers.formatUnits(currentPrice, 18)}`);
          console.log(`⏰ 更新时间: ${new Date(Number(timestamp) * 1000).toLocaleString()}`);
        } else {
          console.log("⚠️ 当前 Oracle 价格无效");
        }
      } catch (priceError: any) {
        console.log("⚠️ 获取当前价格失败:", priceError.message);
      }

    // ============= 批量测试不同价格下的净值 =============
    console.log("\n🔄 开始批量测试不同价格下的净值变化...");
    console.log("=" .repeat(80));

    const results: any[] = [];

    for (let priceIndex = 0; priceIndex < TEST_PRICES.length; priceIndex++) {
      const testPrice = TEST_PRICES[priceIndex];
      const priceInWei = ethers.parseUnits(testPrice.price, 18);

      console.log(`\n📊 测试 ${priceIndex + 1}/${TEST_PRICES.length}: ${testPrice.description}`);
      console.log("-".repeat(50));

      try {
        // 🔧 更新 Oracle 价格
        console.log("🔄 更新 Oracle 价格...");
        const updateTx = await ltcOracle.updatePrice(priceInWei);
        await updateTx.wait();
        console.log(`✅ Oracle 价格已更新为 $${testPrice.price}`);

        // 等待一小段时间确保价格更新
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 🧮 计算各种杠杆级别下的净值
        const leverageResults = [];

        // 遍历用户所有持仓
        for (let i = 0; i < userTokenInfo[0].length; i++) {
          const tokenId = userTokenInfo[0][i];
          const balance = userTokenInfo[1][i];
          const leverage = userTokenInfo[2][i];
          const mintPrice = userTokenInfo[3][i];
          const accruedInterest = userTokenInfo[4][i];

          try {
            // 计算净值信息
            const navResult = await calculateNetValue(
              custodianFixed,
              TEST_USER_ADDRESS,
              tokenId,
              priceInWei,
              balance,
              leverage,
              mintPrice,
              accruedInterest
            );

            leverageResults.push({
              tokenId: tokenId.toString(),
              leverage: getLeverageDescription(Number(leverage)),
              mintPrice: ethers.formatUnits(mintPrice, 18),
              balance: ethers.formatUnits(balance, 18),
              ...navResult
            });

            console.log(`   🎯 Token ID ${tokenId.toString()} (${getLeverageDescription(Number(leverage))}):`);
            console.log(`      - 铸币价格: $${ethers.formatUnits(mintPrice, 18)}`);
            console.log(`      - 持仓数量: ${ethers.formatUnits(balance, 18)}`);
            console.log(`      - 总净值: ${navResult.grossNav}`);
            console.log(`      - 除息净值: ${navResult.netNav}`);
            console.log(`      - 总价值: $${navResult.totalValue}`);
            console.log(`      - 净价值: $${navResult.netValue}`);
            console.log(`      - 盈亏: ${navResult.pnlPercent}%`);
            console.log(`      - 累积利息: ${navResult.accruedInterest}`);

          } catch (navError: any) {
            console.log(`   ❌ Token ID ${tokenId.toString()} 净值计算失败: ${navError.message}`);
            leverageResults.push({
              tokenId: tokenId.toString(),
              leverage: getLeverageDescription(Number(leverage)),
              error: navError.message
            });
          }
        }

        // 🧮 也计算各种杠杆级别的理论净值（用于比较）
        console.log(`   📈 理论净值计算 (铸币价格 $120):`);
        const theoreticalResults = [];

        for (const leverageType of [LeverageType.CONSERVATIVE, LeverageType.MODERATE, LeverageType.AGGRESSIVE]) {
          const theoreticalNav = calculateTheoreticalNav(
            leverageType,
            ethers.parseUnits("120", 18), // 假设铸币价格 $120
            priceInWei
          );

          theoreticalResults.push({
            leverage: getLeverageDescription(leverageType),
            nav: ethers.formatUnits(theoreticalNav, 18)
          });

          console.log(`      - ${getLeverageDescription(leverageType)}: ${ethers.formatUnits(theoreticalNav, 18)}`);
        }

        results.push({
          price: testPrice.price,
          description: testPrice.description,
          userPositions: leverageResults,
          theoretical: theoreticalResults
        });

      } catch (updateError: any) {
        console.log(`❌ 价格更新失败: ${updateError.message}`);
        results.push({
          price: testPrice.price,
          description: testPrice.description,
          error: updateError.message
        });
      }
    }

    // ============= 生成汇总报告 =============
    console.log("\n📊 =============== 汇总报告 ===============");
    console.log("🎯 不同价格下的净值变化趋势:");
    console.log("-".repeat(80));

    // 生成表格形式的报告
    console.log("价格\t\t保守杠杆\t中等杠杆\t激进杠杆");
    console.log("-".repeat(60));

    for (const result of results) {
      if (!result.error && result.theoretical) {
        const price = `$${result.price}`;
        const conservative = result.theoretical.find((t: any) => t.leverage.includes("CONSERVATIVE"))?.nav || "N/A";
        const moderate = result.theoretical.find((t: any) => t.leverage.includes("MODERATE"))?.nav || "N/A";
        const aggressive = result.theoretical.find((t: any) => t.leverage.includes("AGGRESSIVE"))?.nav || "N/A";
        
        console.log(`${price.padEnd(10)}\t${conservative.padEnd(10)}\t${moderate.padEnd(10)}\t${aggressive}`);
      }
    }

    // ============= 风险分析 =============
    console.log("\n⚠️ 风险分析:");
    console.log("📈 净值计算公式:");
    console.log("   - CONSERVATIVE: (9×当前价格 - 铸币价格) / (8×铸币价格)");
    console.log("   - MODERATE: (5×当前价格 - 铸币价格) / (4×铸币价格)");
    console.log("   - AGGRESSIVE: (2×当前价格 - 铸币价格) / (1×铸币价格)");
    console.log("\n📊 观察要点:");
    console.log("   1. 杠杆越高，价格敏感性越强");
    console.log("   2. 当价格低于铸币价格时，净值可能为负");
    console.log("   3. 除息净值 = (总价值 - 累积利息) / 持仓数量");
    console.log("   4. 累积利息会随时间增长，影响实际收益");

    // ============= 保存结果到文件 =============
    const reportData = {
      timestamp: new Date().toISOString(),
      network: hre.network.name,
      testUser: TEST_USER_ADDRESS,
      userPositions: userTokenInfo[0].length,
      results: results,
      summary: {
        totalTests: TEST_PRICES.length,
        successfulTests: results.filter(r => !r.error).length,
        failedTests: results.filter(r => r.error).length
      }
    };

    console.log("\n💾 测试结果摘要:");
    console.log(`   - 总测试数: ${reportData.summary.totalTests}`);
    console.log(`   - 成功测试: ${reportData.summary.successfulTests}`);
    console.log(`   - 失败测试: ${reportData.summary.failedTests}`);
    console.log(`   - 用户持仓数: ${reportData.userPositions}`);

    console.log("\n📄 详细结果 (JSON):");
    console.log(JSON.stringify(reportData, null, 2));

  } catch (error: any) {
    console.error("\n❌ 脚本执行失败:");
    console.error("错误信息:", error.message);
    
    if (error.message.includes("caller is not the owner")) {
      console.log("\n💡 权限问题:");
      console.log("   - 只有 Oracle 的 owner 可以更新价格");
      console.log("   - 检查当前账户是否为 LTCOracle 的 owner");
    }
    
    if (error.message.includes("PriceFeed not initialized")) {
      console.log("\n💡 价格预言机问题:");
      console.log("   - 价格预言机未正确初始化");
      console.log("   - 检查 CustodianFixed 的初始化状态");
    }

    if (error.message.includes("User does not hold this token")) {
      console.log("\n💡 持仓问题:");
      console.log("   - 用户没有对应的 L Token 持仓");
      console.log("   - 先运行铸币脚本创建持仓");
    }
    
    process.exit(1);
  }
}

// ============= 辅助函数 =============

/**
 * 获取杠杆级别描述
 */
function getLeverageDescription(level: number): string {
  switch (level) {
    case 0: return "CONSERVATIVE (1:8)";
    case 1: return "MODERATE (1:4)";
    case 2: return "AGGRESSIVE (1:1)";
    default: return "UNKNOWN";
  }
}

/**
 * 计算理论净值
 */
function calculateTheoreticalNav(
  leverageType: number,
  mintPrice: bigint,
  currentPrice: bigint
): bigint {
  const ethers = (hre as any).ethers;
  const PRICE_PRECISION = ethers.parseUnits("1", 18);

  let numerator: bigint;
  let denominator: bigint;

  if (leverageType === 0) { // CONSERVATIVE
    numerator = 9n * currentPrice - mintPrice;
    denominator = 8n * mintPrice;
  } else if (leverageType === 1) { // MODERATE
    numerator = 5n * currentPrice - mintPrice;
    denominator = 4n * mintPrice;
  } else if (leverageType === 2) { // AGGRESSIVE
    numerator = 2n * currentPrice - mintPrice;
    denominator = mintPrice;
  } else {
    throw new Error("Invalid leverage type");
  }

  return numerator * PRICE_PRECISION / denominator;
}

/**
 * 计算净值信息
 */
async function calculateNetValue(
  custodianFixed: any,
  userAddress: string,
  tokenId: bigint,
  currentPrice: bigint,
  balance: bigint,
  leverage: bigint,
  mintPrice: bigint,
  accruedInterest: bigint
) {
  const ethers = (hre as any).ethers;

  try {
    // 使用合约的净值计算函数
    const navResult = await custodianFixed.getSingleLeverageTokenNav(
      userAddress,
      tokenId,
      currentPrice
    );

    const grossNav = ethers.formatUnits(navResult[1], 18);
    const netNav = ethers.formatUnits(navResult[2], 18);
    const totalValue = ethers.formatUnits(navResult[3], 18);
    const netValue = ethers.formatUnits(navResult[4], 18);
    const accruedInterestFormatted = ethers.formatUnits(navResult[5], 18);

    // 计算盈亏百分比（相对于净值 1.0）
    const navNumber = parseFloat(grossNav);
    const pnlPercent = ((navNumber - 1.0) * 100).toFixed(2);

    return {
      grossNav,
      netNav,
      totalValue,
      netValue,
      accruedInterest: accruedInterestFormatted,
      pnlPercent
    };

  } catch (error: any) {
    // 如果合约调用失败，使用理论计算
    const theoreticalNav = calculateTheoreticalNav(
      Number(leverage),
      mintPrice,
      currentPrice
    );

    const grossNav = ethers.formatUnits(theoreticalNav, 18);
    const totalValue = (parseFloat(ethers.formatUnits(balance, 18)) * parseFloat(grossNav)).toFixed(6);
    const accruedInterestFormatted = ethers.formatUnits(accruedInterest, 18);
    const netValue = (parseFloat(totalValue) - parseFloat(accruedInterestFormatted)).toFixed(6);
    const netNav = (parseFloat(netValue) / parseFloat(ethers.formatUnits(balance, 18))).toFixed(6);
    
    const navNumber = parseFloat(grossNav);
    const pnlPercent = ((navNumber - 1.0) * 100).toFixed(2);

    return {
      grossNav,
      netNav,
      totalValue,
      netValue,
      accruedInterest: accruedInterestFormatted,
      pnlPercent,
      note: "理论计算（合约调用失败）"
    };
  }
}

main()
  .then(() => {
    console.log("\n🎊 Oracle 价格更新和净值计算完成!");
    process.exit(0);
  })
  .catch((error: Error) => {
    console.error("\n💥 脚本执行失败:", error);
    process.exit(1);
  });