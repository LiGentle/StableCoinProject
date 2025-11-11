import hre from "hardhat";

async function publishCustodianFixed(): Promise<void> {
  const ethers = (hre as any).ethers;
  const [owner] = await ethers.getSigners();

  console.log("🔍 开始验证 CustodianFixed 合约...");
  console.log("👤 验证者:", owner.address);
  console.log("🌐 网络:", hre.network.name);
  console.log("=" .repeat(60));

  // 🔧 合约地址
  const CUSTODIAN_ADDRESS = "0x9Fb49EfD7dC50068eb19Cc7E4ac9cA77bCe9114A";
  
  // 📋 构造函数参数 - 必须与部署时完全相同！
  const STABLE_TOKEN_ADDRESS = "0xc737f2b19790120032327F7c6fCF886DA9ed672f";    // S Token
  const LEVERAGE_TOKEN_ADDRESS = "0x89106De21Be816F3823b7011C91569C27Cf8C18a";  // L Token  
  const UNDERLYING_TOKEN_ADDRESS = "0x9DFF6745444c05bbEc03bF59C0910731C02950dd";  // ❗ 需要更新为实际地址
  const ORACLE_ADDRESS = "0x0A0a35875bd2A7087D50c56A83D2571A50224eE5";         // LTC Oracle

  try {
    console.log("📄 验证合约地址:", CUSTODIAN_ADDRESS);
    console.log("📋 构造函数参数:");
    console.log("   Stable Token:", STABLE_TOKEN_ADDRESS);
    console.log("   Leverage Token:", LEVERAGE_TOKEN_ADDRESS);
    console.log("   Underlying Token:", UNDERLYING_TOKEN_ADDRESS);
    console.log("   Oracle:", ORACLE_ADDRESS);
    
    // 🔍 验证部署参数
    console.log("\n🧪 验证部署参数...");
    try {
      const custodian = await ethers.getContractAt("CustodianFixed", CUSTODIAN_ADDRESS);
      
      // 检查基本信息
      const contractOwner = await custodian.owner();
      const currentState = await custodian.currentState();
      
      console.log("✅ 合约基本信息:");
      console.log(`   Owner: ${contractOwner}`);
      console.log(`   当前状态: ${currentState}`);
      
      // 检查关联合约地址
      const stableTokenAddr = await custodian.stableToken();
      const leverageTokenAddr = await custodian.leverageToken();
      const underlyingTokenAddr = await custodian.underlyingToken();
      const oracleAddr = await custodian.ltcPriceOracle();
      
      console.log("🔗 关联合约地址验证:");
      console.log(`   Stable Token: ${stableTokenAddr}`);
      console.log(`   Leverage Token: ${leverageTokenAddr}`);
      console.log(`   Underlying Token: ${underlyingTokenAddr}`);
      console.log(`   Oracle: ${oracleAddr}`);
      
      // 验证地址是否匹配
      const addressesMatch = 
        stableTokenAddr.toLowerCase() === STABLE_TOKEN_ADDRESS.toLowerCase() &&
        leverageTokenAddr.toLowerCase() === LEVERAGE_TOKEN_ADDRESS.toLowerCase() &&
        underlyingTokenAddr.toLowerCase() === UNDERLYING_TOKEN_ADDRESS.toLowerCase() &&
        oracleAddr.toLowerCase() === ORACLE_ADDRESS.toLowerCase();
      
      if (addressesMatch) {
        console.log("✅ 所有地址匹配，参数正确");
      } else {
        console.log("❌ 地址不匹配，请检查构造函数参数");
        console.log("期望的地址:");
        console.log(`   Stable Token: ${STABLE_TOKEN_ADDRESS}`);
        console.log(`   Leverage Token: ${LEVERAGE_TOKEN_ADDRESS}`);
        console.log(`   Underlying Token: ${UNDERLYING_TOKEN_ADDRESS}`);
        console.log(`   Oracle: ${ORACLE_ADDRESS}`);
      }
      
    } catch (error: any) {
      console.log("⚠️ 无法查询合约状态，继续验证...");
      console.log("错误:", error.message);
    }

    console.log("\n🔄 开始 Etherscan 验证...");

    await hre.run("verify:verify", {
      address: CUSTODIAN_ADDRESS,
      constructorArguments: [
        UNDERLYING_TOKEN_ADDRESS,
        STABLE_TOKEN_ADDRESS,
        LEVERAGE_TOKEN_ADDRESS
      ],
      contract: "contracts/CustodianFixed.sol:CustodianFixed"
    });

    console.log("✅ CustodianFixed 合约验证成功！");
    console.log("🌐 查看验证结果:");
    console.log(`   https://sepolia.etherscan.io/address/${CUSTODIAN_ADDRESS}#code`);

    // 📊 显示合约功能概览
    console.log("\n📋 合约功能概览:");
    console.log("   🔸 铸造代币: mint()");
    console.log("   🔸 燃烧代币: burn()");
    console.log("   🔸 价格查询: getLatestPrice()");
    console.log("   🔸 净值查询: getSingleLeverageTokenNav()");
    console.log("   🔸 净值查询V2: getSingleLeverageTokenNavV2()");
    console.log("   🔸 状态管理: setState()");
    console.log("   🔸 利息管理: InterestManager 集成");

    // 📝 使用示例
    console.log("\n📖 基本使用示例:");
    console.log("// 连接合约");
    console.log(`const custodian = await ethers.getContractAt("CustodianFixed", "${CUSTODIAN_ADDRESS}");`);
    console.log("");
    console.log("// 铸造代币");
    console.log(`await custodian.mint(`);
    console.log(`  ethers.parseUnits("1000", 18), // 1000 USDC`);
    console.log(`  ethers.parseUnits("120", 18),  // $120`);
    console.log(`  2 // AGGRESSIVE`);
    console.log(`);`);
    console.log("");
    console.log("// 查询净值 (自动获取价格)");
    console.log(`const navInfo = await custodian.getSingleLeverageTokenNavV2(userAddress, tokenId);`);

  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("✅ 合约已经验证过了！");
      console.log("🌐 查看验证结果:");
      console.log(`   https://sepolia.etherscan.io/address/${CUSTODIAN_ADDRESS}#code`);
    } else {
      console.error("❌ 验证失败:", error.message);
      
      if (error.message.includes("constructor arguments")) {
        console.log("\n🚨 构造函数参数不匹配！");
        console.log("📋 请检查部署时使用的参数:");
        console.log("   1. Stable Token 地址是否正确?");
        console.log("   2. Leverage Token 地址是否正确?");
        console.log("   3. Underlying Token 地址是否正确?");
        console.log("   4. Oracle 地址是否正确?");
        console.log("   5. 参数顺序是否与构造函数一致?");
        
        console.log("\n🔧 调试建议:");
        console.log("   运行合约查询来确认参数:");
        console.log(`   const custodian = await ethers.getContractAt("CustodianFixed", "${CUSTODIAN_ADDRESS}");`);
        console.log(`   await custodian.stableToken();`);
        console.log(`   await custodian.leverageToken();`);
        console.log(`   await custodian.underlyingToken();`);
        console.log(`   await custodian.ltcPriceOracle();`);
      }
      
      // 提供故障排除建议
      console.log("\n🔧 其他故障排除建议:");
      console.log("   1. 检查合约地址是否正确");
      console.log("   2. 确认构造函数参数匹配");
      console.log("   3. 验证网络配置正确");
      console.log("   4. 检查 Etherscan API Key 配置");
      console.log("   5. 确保使用相同的 Solidity 版本 (0.8.28)");
    }
  }
}

publishCustodianFixed()
  .then(() => {
    console.log("\n🎉 CustodianFixed 验证脚本完成!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 脚本执行失败:", error);
    process.exit(1);
  });