import hre from "hardhat";

/*
运行命令：
npx hardhat run scripts/deploy/deploy_LTCOracle.ts --network sepolia

📄 部署 LTCPriceOracle 合约...
⏳ 等待部署确认...
✅ LTCPriceOracle 部署成功!
📄 合约地址: 0x0A0a35875bd2A7087D50c56A83D2571A50224eE5
*/

async function main(): Promise<void> {
  const ethers = (hre as any).ethers;

  console.log("🚀 部署 LTC 价格预言机合约（18位精度）...");
  console.log("📡 当前网络:", hre.network.name);

  const [deployer] = await ethers.getSigners();
  console.log("👤 部署账户:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 账户余额:", ethers.formatEther(balance), "ETH");

  try {
    // ============= 部署参数配置 =============
    console.log("\n📋 配置部署参数...");

    // LTC 初始价格：$120.00 (18位精度)
    const INITIAL_LTC_PRICE = ethers.parseUnits("120.00", 18); // $120.00 * 10^18
    console.log("💰 LTC 初始价格: $120.00");
    console.log("🔢 18位精度格式:", INITIAL_LTC_PRICE.toString());

    // 初始价格提供者列表
    const INITIAL_PRICE_FEEDERS = [
      deployer.address,           // 部署者
      "0x6bCf5fbb6569921c508eeA15fF16b92426F99218",         // zhou jingqi
      "0x0f4d9b55A1bBD0aA8e9c55eA1442DCE69b1E226B",         // wang xin
      "0xA4b399a194e2DD9b84357E92474D0c32e3359A74"          // lijing tao
    ];

    console.log("🔑 初始价格提供者:");
    INITIAL_PRICE_FEEDERS.forEach((feeder, index) => {
      console.log(`   ${index + 1}. ${feeder}`);
    });

    // ============= 部署合约 =============
    console.log("\n📄 部署 LTCPriceOracle 合约...");

    const LTCPriceOracleFactory = await ethers.getContractFactory("LTCPriceOracle");
    
    const ltcOracle = await LTCPriceOracleFactory.deploy(
      INITIAL_LTC_PRICE,
      INITIAL_PRICE_FEEDERS
    );

    console.log("⏳ 等待部署确认...");
    await ltcOracle.waitForDeployment();
    
    const oracleAddress = await ltcOracle.getAddress();
    console.log("✅ LTCPriceOracle 部署成功!");
    console.log("📄 合约地址:", oracleAddress);

    // ============= 验证部署结果 =============
    console.log("\n🔍 验证部署结果...");

    // 获取基本信息
    const decimals = await ltcOracle.decimals();
    const currentRoundId = await ltcOracle.currentRoundId();
    const emergencyMode = await ltcOracle.emergencyMode();
    const owner = await ltcOracle.owner();

    console.log("📋 合约基本信息:");
    console.log(`   - 价格精度: ${decimals} 位小数`);
    console.log(`   - 当前轮次: ${currentRoundId}`);
    console.log(`   - 紧急模式: ${emergencyMode ? "开启" : "关闭"}`);
    console.log(`   - 合约Owner: ${owner}`);

    // 验证初始价格数据
    const latestRoundData = await ltcOracle.latestRoundData();
    const priceInUSD = ethers.formatUnits(latestRoundData[1], 18); // 18位精度转换

    console.log("💰 最新价格信息:");
    console.log(`   - 轮次ID: ${latestRoundData[0]}`);
    console.log(`   - 价格: $${priceInUSD}`);
    console.log(`   - 原始价格: ${latestRoundData[1]}`);
    console.log(`   - 更新时间: ${new Date(Number(latestRoundData[3]) * 1000).toLocaleString()}`);

    // 验证价格提供者权限
    console.log("\n🔑 验证价格提供者权限:");
    for (let i = 0; i < INITIAL_PRICE_FEEDERS.length; i++) {
      const feeder = INITIAL_PRICE_FEEDERS[i];
      const isFeeder = await ltcOracle.priceFeeder(feeder);
      console.log(`   - ${feeder}: ${isFeeder ? "✅ 已授权" : "❌ 未授权"}`);
    }

    // 获取价格状态
    const priceStatus = await ltcOracle.getPriceStatus();
    console.log("\n📊 价格状态详情:");
    console.log(`   - 当前价格: $${ethers.formatUnits(priceStatus[0], 18)}`);
    console.log(`   - 最后更新: ${new Date(Number(priceStatus[1]) * 1000).toLocaleString()}`);
    console.log(`   - 价格年龄: ${priceStatus[2]} 秒`);
    console.log(`   - 数据有效: ${priceStatus[3] ? "✅" : "❌"}`);
    console.log(`   - 紧急模式: ${priceStatus[4] ? "🚨 开启" : "✅ 关闭"}`);
    console.log(`   - 总轮次: ${priceStatus[5]}`);

    // ============= 测试价格更新功能 =============
    console.log("\n🧪 测试价格更新功能...");

    // 更新到新价格：$120.25
    const newPrice = ethers.parseUnits("120.25", 18); // $120.25 * 10^18
    console.log("🔄 更新价格到 $120.25...");
    console.log("🔢 18位精度格式:", newPrice.toString());

    const updateTx = await ltcOracle.updatePrice(newPrice);
    await updateTx.wait();
    console.log("✅ 价格更新成功");

    // 验证更新结果
    const updatedRoundData = await ltcOracle.latestRoundData();
    const updatedPrice = ethers.formatUnits(updatedRoundData[1], 18);
    const newRoundId = await ltcOracle.currentRoundId();

    console.log("📈 价格更新结果:");
    console.log(`   - 新轮次ID: ${newRoundId}`);
    console.log(`   - 新价格: $${updatedPrice}`);
    console.log(`   - 原始格式: ${updatedRoundData[1]}`);
    console.log(`   - 更新时间: ${new Date(Number(updatedRoundData[3]) * 1000).toLocaleString()}`);

    // ============= 测试精度转换函数 =============
    console.log("\n🔧 测试精度转换函数...");

    // 测试 dollarToWei 函数 - 使用与当前价格相关的值
    const testDollarToWei = await ltcOracle.dollarToWei(121, 50); // $121.50
    console.log(`dollarToWei(121, 50): ${testDollarToWei.toString()}`);
    console.log(`应该等于: ${ethers.parseUnits("121.50", 18)}`);

    // 测试 weiToDollar 函数
    const testWeiToDollar = await ltcOracle.weiToDollar(testDollarToWei);
    console.log(`weiToDollar结果: $${testWeiToDollar[0]}.${testWeiToDollar[1].toString().padStart(2, '0')}`);

    // ============= 测试查询功能 =============
    console.log("\n📚 测试价格历史查询...");

    const priceHistory = await ltcOracle.getPriceHistory(5);
    console.log(`📊 最近 ${priceHistory.length} 次价格记录:`);
    
    for (let i = 0; i < priceHistory.length; i++) {
      const round = priceHistory[i];
      const price = ethers.formatUnits(round.answer, 18);
      const updateTime = new Date(Number(round.updatedAt) * 1000).toLocaleString();
      
      console.log(`   ${i + 1}. 轮次 ${round.roundId}: $${price} (${updateTime})`);
    }

    // ============= 输出集成指导 =============
    console.log("\n📋 =============== 部署摘要 ===============");
    console.log("✅ LTC 价格预言机部署成功!");
    console.log("");
    console.log("📄 合约信息:");
    console.log(`   - 地址: ${oracleAddress}`);
    console.log(`   - 网络: ${hre.network.name}`);
    console.log(`   - Owner: ${owner}`);
    console.log(`   - 精度: ${decimals} 位 (18位小数)`);
    console.log(`   - 当前价格: $${updatedPrice}`);
    console.log("");
    console.log("🔍 Etherscan 验证:");
    console.log(`   - 合约: https://sepolia.etherscan.io/address/${oracleAddress}`);
    console.log("");
    console.log("🛠️ 集成使用:");
    console.log("   1. 其他合约可以通过 IChainlinkV3 接口调用");
    console.log("   2. 主要函数: latestRoundData()");
    console.log("   3. 价格格式: 18位小数 (标准 ERC20 精度)");
    console.log(`   4. 示例: ${newPrice} = $${updatedPrice}`);
    console.log("");
    console.log("🔧 价格转换:");
    console.log("   - dollarToWei(dollars, cents): 美元转18位精度");
    console.log("   - weiToDollar(weiPrice): 18位精度转美元");
    console.log("   - ethers.parseUnits(\"120.25\", 18): 前端转换");
    console.log("   - ethers.formatUnits(price, 18): 前端显示");
    console.log("");
    console.log("🔑 管理功能:");
    console.log("   - updatePrice(price): 更新价格 (18位精度格式)");
    console.log("   - addPriceFeeder(): 添加价格提供者 (Owner)");
    console.log("   - activateEmergencyMode(): 紧急模式 (Owner)");
    console.log("");
    console.log("⚠️ 注意事项:");
    console.log("   - 价格最大有效期: 1小时");
    console.log("   - 价格变动阈值: 10%");
    console.log("   - 价格范围: $10 - $100,000");
    console.log("   - 精度: 18位小数 (与以太坊标准一致)");
    console.log("========================================");

    // ============= 保存部署信息 =============
    const deploymentInfo = {
      network: hre.network.name,
      deployer: deployer.address,
      timestamp: new Date().toISOString(),
      contract: {
        name: "LTCPriceOracle",
        address: oracleAddress,
        owner: owner,
        decimals: Number(decimals),
        currentPrice: updatedPrice,
        currentPriceRaw: updatedRoundData[1].toString(),
        currentRoundId: Number(newRoundId),
        emergencyMode: emergencyMode
      },
      initialConfig: {
        initialPrice: ethers.formatUnits(INITIAL_LTC_PRICE, 18),
        initialPriceRaw: INITIAL_LTC_PRICE.toString(),
        priceFeeders: INITIAL_PRICE_FEEDERS
      },
      constants: {
        decimals: 18,
        maxPriceAge: 3600,
        minPrice: "10000000000000000000", // $10
        maxPrice: "100000000000000000000000", // $100,000
        priceChangeThreshold: 1000 // 10%
      },
      usage: {
        priceConversion: {
          parseUnits: "ethers.parseUnits(\"120.25\", 18)",
          formatUnits: "ethers.formatUnits(price, 18)",
          dollarToWei: "await oracle.dollarToWei(120, 25)",
          weiToDollar: "await oracle.weiToDollar(price)"
        }
      }
    };

    console.log("\n💾 部署信息 (JSON):");
    console.log(JSON.stringify(deploymentInfo, null, 2));

    // ============= 后续步骤提示 =============
    console.log("\n🎯 后续步骤:");
    console.log("1. 🔍 在 Etherscan 上验证合约源码");
    console.log("2. 🔑 如需要，添加更多价格提供者地址");
    console.log("3. ⏰ 设置定时任务更新LTC价格");
    console.log("4. 🔗 将预言机地址集成到其他合约中");
    console.log("5. 📊 监控价格更新和数据有效性");

  } catch (error: any) {
    console.error("\n❌ 部署失败:");
    console.error("错误信息:", error.message);
    
    if (error.message.includes("insufficient funds")) {
      console.log("\n💡 解决建议:");
      console.log("   - 账户ETH余额不足");
      console.log("   - 获取测试ETH: https://sepoliafaucet.com/");
    }
    
    if (error.message.includes("invalid price")) {
      console.log("\n💡 价格参数问题:");
      console.log("   - 检查初始价格是否在有效范围内");
      console.log("   - 价格范围: $10 - $100,000");
      console.log("   - 18位精度格式: price * 10^18");
    }
    
    if (error.reason) {
      console.error("失败原因:", error.reason);
    }

    process.exit(1);
  }
}

main()
  .then(() => {
    console.log("\n🎉 LTC预言机部署完成!");
    process.exit(0);
  })
  .catch((error: Error) => {
    console.error("\n💥 脚本执行失败:", error);
    process.exit(1);
  });