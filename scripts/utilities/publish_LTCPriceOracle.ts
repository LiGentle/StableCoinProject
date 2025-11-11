import hre from "hardhat";

async function publishLTCPriceOracle(): Promise<void> {
  console.log("🔍 开始验证 LTCPriceOracle 合约...");

  // 🔧 配置信息 - 请根据实际部署情况修改
  const ORACLE_ADDRESS = "0x0A0a35875bd2A7087D50c56A83D2571A50224eE5"; // ❗ 需要更新为实际地址
  
  // 📋 构造函数参数
  const INITIAL_PRICE = "120000000000000000000"; // $120 (18位精度)
  const INITIAL_FEEDERS = [
    "0x4845d4db01b81A15559b8734D234e6202C556d32",        // ❗ 需要更新为实际地址
      "0x6bCf5fbb6569921c508eeA15fF16b92426F99218",         // zhou jingqi
      "0x0f4d9b55A1bBD0aA8e9c55eA1442DCE69b1E226B",         // wang xin
      "0xA4b399a194e2DD9b84357E92474D0c32e3359A74"          // lijing tao
  ];

  try {
    console.log("📄 验证合约地址:", ORACLE_ADDRESS);
    console.log("📋 构造函数参数:");
    console.log("   初始价格:", INITIAL_PRICE, "($120)");
    console.log("   授权地址:", INITIAL_FEEDERS);

    await hre.run("verify:verify", {
      address: ORACLE_ADDRESS,
      constructorArguments: [
        INITIAL_PRICE,
        INITIAL_FEEDERS
      ],
      contract: "contracts/oracles/LTCPriceOracle.sol:LTCPriceOracle"
    });

    console.log("✅ LTCPriceOracle 合约验证成功！");
    console.log("🌐 查看验证结果:");
    console.log(`   https://sepolia.etherscan.io/address/${ORACLE_ADDRESS}#code`);

    // 📊 显示合约功能
    console.log("\n📋 合约功能概览:");
    console.log("   🔸 价格更新: updatePrice()");
    console.log("   🔸 批量更新: batchUpdatePrices()"); 
    console.log("   🔸 紧急模式: activateEmergencyMode()");
    console.log("   🔸 价格查询: latestRoundData()");
    console.log("   🔸 历史记录: getPriceHistory()");

  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("✅ 合约已经验证过了！");
      console.log("🌐 查看验证结果:");
      console.log(`   https://sepolia.etherscan.io/address/${ORACLE_ADDRESS}#code`);
    } else {
      console.error("❌ 验证失败:", error.message);
      
      // 提供故障排除建议
      console.log("\n🔧 故障排除建议:");
      console.log("   1. 检查合约地址是否正确");
      console.log("   2. 确认构造函数参数匹配");
      console.log("   3. 验证网络配置正确");
      console.log("   4. 检查 Etherscan API Key 配置");
    }
  }
}

publishLTCPriceOracle()
  .then(() => {
    console.log("\n🎉 LTCPriceOracle 验证脚本完成!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 脚本执行失败:", error);
    process.exit(1);
  });