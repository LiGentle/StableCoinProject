import hre from "hardhat";

async function main(): Promise<void> {
  const ethers = (hre as any).ethers;

  // 你部署的预言机地址（从部署脚本输出中获取并替换）
  const ORACLE_ADDRESS = "0x..."; // 🚨 替换为实际地址

  const [manager] = await ethers.getSigners();
  console.log("🔧 LTC预言机管理工具");
  console.log("📡 网络:", hre.network.name);
  console.log("👤 管理账户:", manager.address);

  const ltcOracle = await ethers.getContractAt("LTCPriceOracle", ORACLE_ADDRESS);

  try {
    // 查看当前状态
    console.log("\n📊 当前价格状态:");
    const priceStatus = await ltcOracle.getPriceStatus();
    const currentPrice = ethers.formatUnits(priceStatus[0], 18);
    
    console.log(`💰 LTC价格: $${currentPrice}`);
    console.log(`📅 最后更新: ${new Date(Number(priceStatus[1]) * 1000).toLocaleString()}`);
    console.log(`⏰ 数据年龄: ${Math.floor(Number(priceStatus[2]) / 60)} 分钟`);
    console.log(`✅ 数据有效: ${priceStatus[3] ? "是" : "否"}`);
    console.log(`🚨 紧急模式: ${priceStatus[4] ? "开启" : "关闭"}`);

    // 更新价格示例（根据需要修改价格）
    const newPrice = ethers.parseUnits("122.75", 18); // $122.75
    console.log(`\n🔄 更新价格到 $${ethers.formatUnits(newPrice, 18)}...`);
    
    const updateTx = await ltcOracle.updatePrice(newPrice);
    await updateTx.wait();
    console.log("✅ 价格更新成功");

    // 验证更新
    const newPriceData = await ltcOracle.latestRoundData();
    const updatedPrice = ethers.formatUnits(newPriceData[1], 18);
    console.log(`💰 新价格: $${updatedPrice}`);

    // 查看价格历史
    console.log("\n📚 最近价格历史:");
    const history = await ltcOracle.getPriceHistory(3);
    history.forEach((round, index) => {
      const price = ethers.formatUnits(round.answer, 18);
      const time = new Date(Number(round.updatedAt) * 1000).toLocaleString();
      console.log(`   ${index + 1}. 轮次 ${round.roundId}: $${price} (${time})`);
    });

  } catch (error: any) {
    console.error("❌ 操作失败:", error.message);
    
    if (error.message.includes("Not authorized price feeder")) {
      console.log("💡 权限不足：当前账户不是授权的价格提供者");
    }
    
    if (error.message.includes("Price change too large")) {
      console.log("💡 价格变动过大：需要Owner权限或调整价格");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error("脚本执行失败:", error);
    process.exit(1);
  });