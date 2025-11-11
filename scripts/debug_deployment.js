import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// 获取当前文件的目录路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== 系统参数配置 ====================
// 使用命名常量替代硬编码数值，提高代码可读性和可维护性



async function main() {
  console.log("🚀 开始部署完整稳定币系统...");

  // 连接到网络
  const { ethers } = await network.connect();

  // 获取部署者账户
  const [deployer] = await ethers.getSigners();
  console.log(`📝 部署者地址: ${deployer.address}`);

  // ==================== 第一步：部署基础代币合约 ====================
  console.log("\n📦 第一步：部署基础代币合约...");

  // 部署底层资产代币 (WLTC Mock)
  console.log("  部署 WLTC Mock...");
  const WLTCMock = await ethers.getContractFactory("WLTCMock");
  const wltc = await WLTCMock.deploy();
  await wltc.waitForDeployment();
  const wltcAddress = await wltc.getAddress();
  console.log(`  ✅ WLTC Mock 部署完成: ${wltcAddress}`);

  // 部署稳定币 (StableToken)
  console.log("  部署 StableToken...");
  const StableToken = await ethers.getContractFactory("StableToken");
  const stableToken = await StableToken.deploy();
  await stableToken.waitForDeployment();
  const stableTokenAddress = await stableToken.getAddress();
  console.log(`  ✅ StableToken 部署完成: ${stableTokenAddress}`);

  // 部署杠杆代币 (MultiLeverageToken)
  console.log("  部署 MultiLeverageToken...");
  const MultiLeverageToken = await ethers.getContractFactory("MultiLeverageToken");
  const leverageToken = await MultiLeverageToken.deploy("https://api.example.com/metadata/");
  await leverageToken.waitForDeployment();
  const leverageTokenAddress = await leverageToken.getAddress();
  console.log(`  ✅ MultiLeverageToken 部署完成: ${leverageTokenAddress}`);

  // ==================== 第二步：部署业务合约 ====================
  console.log("\n📦 第二步：部署业务合约...");

  // 部署利息管理器
  console.log("  部署 InterestManager...");
  const InterestManager = await ethers.getContractFactory("InterestManager");
  const interestManager = await InterestManager.deploy(wltcAddress, 300); // 300 = 3% 年化利率
  await interestManager.waitForDeployment();
  const interestManagerAddress = await interestManager.getAddress();
  console.log(`  ✅ InterestManager 部署完成: ${interestManagerAddress}`);

  // 部署价格预言机 (LTCPriceOracle)
  console.log("  部署 LTCPriceOracle...");
  const LTCPriceOracle = await ethers.getContractFactory("LTCPriceOracle");
  const priceOracle = await LTCPriceOracle.deploy(
    75000000000000000000n, // 初始价格：$75.00 (75 * 10^18)
    [deployer.address]     // 初始价格提供者：部署者地址
  );
  await priceOracle.waitForDeployment();
  const priceOracleAddress = await priceOracle.getAddress();
  console.log(`  ✅ LTCPriceOracle 部署完成: ${priceOracleAddress}`);

  // ==================== 第三步：部署核心托管合约 ====================
  console.log("\n📦 第三步：部署核心托管合约...");

  console.log("  部署 CustodianFixed...");
  const CustodianFixed = await ethers.getContractFactory("CustodianFixed_1");
  const custodian = await CustodianFixed.deploy(
    wltcAddress,        // underlyingTokenAddr
    stableTokenAddress,  // stableTokenAddr
    leverageTokenAddress, // leverageTokenAddr
  );
  await custodian.waitForDeployment();
  const custodianAddress = await custodian.getAddress();
  console.log(`  ✅ CustodianFixed 部署完成: ${custodianAddress}`);

 
  // ==================== 第八步：初始化系统 ====================
  console.log("\n📦 第八步：初始化系统...");

  // 初始化InterestManager
  console.log("  初始化 InterestManager...");
  await interestManager.initialize(leverageTokenAddress,custodianAddress);
  console.log(" InterestManager 初始化成功");
  
  // 设置代币的托管合约
  console.log("  设置代币的托管合约...");
  await stableToken.setCustodian(custodianAddress);
  await leverageToken.setCustodian(custodianAddress);
  console.log("  ✅ 代币托管合约设置完成");

  // 初始化托管系统
  console.log("  初始化 CustodianFixed 系统...");
  const initializeTx = await custodian.initializeSystem(
    interestManagerAddress, // interestManagerAddr
    priceOracleAddress,     // priceFeedAddr
    deployer.address         // feeCollectorAddr
  );
  await initializeTx.wait();
  console.log("  ✅ CustodianFixed 系统初始化完成");

  // 验证系统初始化状态
  console.log("  验证系统初始化状态...");
  const state = await custodian.state();
  const priceFeedAddr = await custodian.priceFeed();
  const interestManagerAddr = await custodian.interestManager();
  
  console.log(`    Custodian 状态: ${state} (类型: ${typeof state})`);
  console.log(`    PriceFeed 地址: ${priceFeedAddr}`);
  console.log(`    InterestManager 地址: ${interestManagerAddr}`);
  
  // 修复验证逻辑：BigInt 比较
  const isStateValid = state === 1n || state === 1;
  const isPriceFeedValid = priceFeedAddr !== ethers.ZeroAddress;
  const isInterestManagerValid = interestManagerAddr !== ethers.ZeroAddress;
  
  console.log(`    状态验证: ${isStateValid ? "✅" : "❌"} (${state} === 1)`);
  console.log(`    PriceFeed 验证: ${isPriceFeedValid ? "✅" : "❌"}`);
  console.log(`    InterestManager 验证: ${isInterestManagerValid ? "✅" : "❌"}`);
  
  if (isStateValid && isPriceFeedValid && isInterestManagerValid) {
    console.log("  ✅ 系统初始化验证通过");
  } else {
    console.log("  ❌ 系统初始化验证失败");
    throw new Error("Custodian 系统初始化失败");
  }

// 铸币
    // ============= 杠杆级别定义 =============
  const LeverageType = {
    CONSERVATIVE: 0, // 1:8 比例，低杠杆
    MODERATE: 1,     // 1:4 比例，中等杠杆
    AGGRESSIVE: 2    // 1:1 比例，高杠杆
  };

  // ============= 铸币参数设置 =============
  const UNDERLYING_AMOUNT = ethers.parseUnits("1.0", 18); // 投入 1 个 WLTC
  const MINT_PRICE = ethers.parseUnits("100", 18);        // 铸币价格 $100
  const LEVERAGE_LEVEL = LeverageType.MODERATE;            // 使用枚举类型

  console.log("\n💳 检查账户余额和授权...");
  const wltcAmount = ethers.parseEther("100"); // 100 WLTC
  await wltc.mint(deployer.address, wltcAmount);
  await wltc.approve(custodianAddress, wltcAmount);
    
  const wltcBalance = await wltc.balanceOf(deployer.address);
  const allowance = await wltc.allowance(deployer.address, custodianAddress);
  console.log(`📋 WLTC 余额: ${ethers.formatUnits(wltcBalance, 18)}`);
  console.log(`📋 已授权额度: ${ethers.formatUnits(allowance, 18)}`);

    console.log("\n🪙 执行铸币操作...");
    console.log("📝 铸币参数确认:");
    console.log(`   - underlyingAmount: ${ethers.formatUnits(UNDERLYING_AMOUNT, 18)}`);
    console.log(`   - mintPrice: ${ethers.formatUnits(MINT_PRICE, 18)}`);

    // 估算 gas
    try {
      const estimatedGas = await custodian.mint.estimateGas(
        UNDERLYING_AMOUNT, // underlyingAmountInWei - 投入的 WLTC 数量
        MINT_PRICE,        // mintPriceInWei - 铸币价格
        LEVERAGE_LEVEL,    // leverageLevel - 杠杆级别 (枚举类型)
      );
      console.log(`⛽ 估算 Gas: ${estimatedGas.toString()}`);
    } catch (gasError) {
      console.log("⚠️ Gas 估算失败:", gasError.message);
    }

    // 执行铸币交易
    const mintTx = await custodian.mint(
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



  // 保存部署信息
  const deploymentInfo = {
    network: (await ethers.provider.getNetwork()).name,
    deployer: deployer.address,
    contracts: {
      wltc: wltcAddress,
      stableToken: stableTokenAddress,
      leverageToken: leverageTokenAddress,
      interestManager: interestManagerAddress,
      priceOracle: priceOracleAddress,
      custodian: custodianAddress,
    },
    timestamp: new Date().toISOString()
  };

  console.log(`\n💾 部署信息汇总完成`);
  
  return deploymentInfo;
}

// 保存部署信息到 JSON 文件
function saveDeploymentInfo(deploymentInfo) {
  try {
    // 创建 deployments 目录
    const deploymentsDir = path.join(__dirname, 'deployments');
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }

    // 生成文件名（包含网络和时间戳）
    const networkName = deploymentInfo.network || 'unknown';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `deployment-${networkName}-${timestamp}.json`;
    const filePath = path.join(deploymentsDir, filename);

    // 写入 JSON 文件
    fs.writeFileSync(filePath, JSON.stringify(deploymentInfo, null, 2));
    
    console.log(`\n💾 部署信息已保存到: ${filePath}`);
    
    // 同时创建一个最新的部署文件
    const latestFilePath = path.join(deploymentsDir, 'deployment-latest.json');
    fs.writeFileSync(latestFilePath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`📄 最新部署信息已保存到: ${latestFilePath}`);

    return filePath;
  } catch (error) {
    console.error('❌ 保存部署信息失败:', error);
    return null;
  }
}

// 执行部署
main()
  .then((deploymentInfo) => {
    console.log("\n🎊 完整系统部署成功！");
    
    // 保存部署信息到 JSON 文件
    const savedFilePath = saveDeploymentInfo(deploymentInfo);
    if (savedFilePath) {
      console.log(`\n📋 部署信息已成功保存到 JSON 文件`);
      console.log(`   文件位置: ${savedFilePath}`);
    }
    
    
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ 部署失败:", error);
    process.exit(1);
  });
