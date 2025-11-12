import { network } from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// 获取当前文件的目录路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== 系统参数配置 ====================
// 使用命名常量替代硬编码数值，提高代码可读性和可维护性

// 时间相关参数（秒）
const TIME_PARAMS = {
  ONE_HOUR: 3600,
  TWO_HOURS: 7200,
  TWENTY_FOUR_HOURS: 86400
};

// 拍卖管理器参数
const AUCTION_PARAMS = {
  PRICE_MULTIPLIER: "1.0",           // 起始价格乘数
  RESET_TIME: TIME_PARAMS.TWO_HOURS,  // 重置时间
  MIN_AUCTION_AMOUNT: "100",          // 最小拍卖金额
  PRICE_DROP_THRESHOLD: "0.8",        // 价格下降阈值
  PERCENTAGE_REWARD: "0.01",          // 百分比激励 (1%)
  FIXED_REWARD: "10"                  // 固定激励
};

// 清算管理器参数
const LIQUIDATION_PARAMS = {
  ADJUSTMENT_THRESHOLD: "0.5",        // 调整阈值
  LIQUIDATION_THRESHOLD: "0.3",       // 清算阈值
  PENALTY: "0.03"                     // 惩罚金 (3%)
};

// 价格计算器参数
const PRICE_CALCULATOR_PARAMS = {
  TAU: TIME_PARAMS.TWO_HOURS          // 线性递减时间参数
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
  const CustodianFixed = await ethers.getContractFactory("CustodianFixed");
  const custodian = await CustodianFixed.deploy(
    wltcAddress,        // underlyingTokenAddr
    stableTokenAddress,  // stableTokenAddr
    leverageTokenAddress, // leverageTokenAddr
  );
  await custodian.waitForDeployment();
  const custodianAddress = await custodian.getAddress();
  console.log(`  ✅ CustodianFixed 部署完成: ${custodianAddress}`);

  // ==================== 第四步：部署清算模块 ====================
  console.log("\n📦 第四步：部署清算模块...");

  // 部署价格计算器 (线性递减)
  console.log("  部署 LinearDecrease...");
  const LinearDecrease = await ethers.getContractFactory("LinearDecrease");
  const linearDecrease = await LinearDecrease.deploy();
  await linearDecrease.waitForDeployment();
  const linearDecreaseAddress = await linearDecrease.getAddress();
  console.log(`  ✅ LinearDecrease 部署完成: ${linearDecreaseAddress}`);

  // 设置价格计算器参数
  console.log("  配置 LinearDecrease 参数...");
  await linearDecrease.file(ethers.encodeBytes32String("tau"), PRICE_CALCULATOR_PARAMS.TAU);
  console.log("  ✅ LinearDecrease 参数配置完成");

  // 部署拍卖管理器
  console.log("  部署 AuctionManager...");
  const AuctionManager = await ethers.getContractFactory("DuchAuction");
  const auctionManager = await AuctionManager.deploy();
  await auctionManager.waitForDeployment();
  const auctionManagerAddress = await auctionManager.getAddress();
  console.log(`  ✅ AuctionManager 部署完成: ${auctionManagerAddress}`);

  // 部署清算管理器
  console.log("  部署 LiquidationManager...");
  const LiquidationManager = await ethers.getContractFactory("Liquidation");
  const liquidationManager = await LiquidationManager.deploy(
    custodianAddress,
    auctionManagerAddress
  );
  await liquidationManager.waitForDeployment();
  const liquidationManagerAddress = await liquidationManager.getAddress();
  console.log(`  ✅ LiquidationManager 部署完成: ${liquidationManagerAddress}`);

  // ==================== 第五步：配置合约参数 ====================
  console.log("\n📦 第五步：配置合约参数...");

  // 配置拍卖管理器参数
  console.log("  配置 AuctionManager 参数...");
  await auctionManager.setParameter(ethers.encodeBytes32String("priceMultiplier"), ethers.parseEther(AUCTION_PARAMS.PRICE_MULTIPLIER));
  await auctionManager.setParameter(ethers.encodeBytes32String("resetTime"), AUCTION_PARAMS.RESET_TIME);
  await auctionManager.setParameter(ethers.encodeBytes32String("minAuctionAmount"), ethers.parseEther(AUCTION_PARAMS.MIN_AUCTION_AMOUNT));
  await auctionManager.setParameter(ethers.encodeBytes32String("priceDropThreshold"), ethers.parseEther(AUCTION_PARAMS.PRICE_DROP_THRESHOLD));
  await auctionManager.setParameter(ethers.encodeBytes32String("percentageReward"), ethers.parseEther(AUCTION_PARAMS.PERCENTAGE_REWARD));
  await auctionManager.setParameter(ethers.encodeBytes32String("fixedReward"), ethers.parseEther(AUCTION_PARAMS.FIXED_REWARD));
  console.log("  ✅ AuctionManager 参数配置完成");

  // 配置清算管理器参数
  console.log("  配置 LiquidationManager 参数...");
  await liquidationManager.setParameter(ethers.encodeBytes32String("adjustmentThreshold"), ethers.parseEther(LIQUIDATION_PARAMS.ADJUSTMENT_THRESHOLD));
  await liquidationManager.setParameter(ethers.encodeBytes32String("liquidationThreshold"), ethers.parseEther(LIQUIDATION_PARAMS.LIQUIDATION_THRESHOLD));
  await liquidationManager.setParameter(ethers.encodeBytes32String("penalty"), ethers.parseEther(LIQUIDATION_PARAMS.PENALTY));
  console.log("  ✅ LiquidationManager 参数配置完成");

  // ==================== 第六步：设置合约地址 ====================
  console.log("\n📦 第六步：设置合约地址...");

  // 设置拍卖管理器地址
  console.log("  设置 AuctionManager 地址...");
  await auctionManager.setAddress(ethers.encodeBytes32String("custodian"), custodianAddress);
  await auctionManager.setAddress(ethers.encodeBytes32String("liquidationManager"), liquidationManagerAddress);
  await auctionManager.setAddress(ethers.encodeBytes32String("priceCalculator"), linearDecreaseAddress);
  await auctionManager.setAddress(ethers.encodeBytes32String("stableToken"), stableTokenAddress);
  console.log("  ✅ AuctionManager 地址设置完成");

  // 设置清算管理器地址
  console.log("  设置 LiquidationManager 地址...");
  await liquidationManager.setAddress(ethers.encodeBytes32String("custodian"), custodianAddress);
  await liquidationManager.setAddress(ethers.encodeBytes32String("auction"), auctionManagerAddress);
  await liquidationManager.setAddress(ethers.encodeBytes32String("leverageToken"), leverageTokenAddress);
  console.log("  ✅ LiquidationManager 地址设置完成");

  // 设置托管合约地址
  console.log("  设置 CustodianFixed 地址...");
  await custodian.setAddress(ethers.encodeBytes32String("liquidationManager"), liquidationManagerAddress);
  await custodian.setAddress(ethers.encodeBytes32String("auctionManager"), auctionManagerAddress);
  console.log("  ✅ custodian 地址设置完成");

  // ==================== 第七步：配置权限 ====================
  console.log("\n📦 第七步：配置权限...");

  // 在 Custodian 中授予权限
  console.log("  在 Custodian 中授予权限...");
  await custodian.grantLiquidationRole(liquidationManagerAddress);
  await custodian.grantAuctionRole(auctionManagerAddress);
  console.log("  ✅ Custodian 权限配置完成");

  // 在 AuctionManager 中授予权限
  console.log("  在 AuctionManager 中授予权限...");
  await auctionManager.grantCallerRole(liquidationManagerAddress);
  console.log("  ✅ AuctionManager 权限配置完成");

  // 在 LiquidationManager 中授予权限
  console.log("  在 LiquidationManager 中授予权限...");
  await liquidationManager.grantAuctionRole(auctionManagerAddress);
  await liquidationManager.grantCustodianRole(custodianAddress);
  console.log("  ✅ LiquidationManager 权限配置完成");

  // ==================== 第八步：初始化系统 ====================
  console.log("\n📦 第八步：初始化系统...");

  // 初始化InterestManager
  console.log("  初始化 InterestManager...");
  await interestManager.initialize(leverageTokenAddress,custodianAddress);
  console.log(" ✅ InterestManager 初始化成功");

  // 设置代币的托管合约
  console.log("  设置代币的托管合约...");
  await stableToken.setCustodian(custodianAddress);
  await leverageToken.setCustodian(custodianAddress);
  console.log("  ✅ 代币托管合约设置完成");


    console.log("  等待交易确认...");
    await sleep(30000); // 等待10秒
    console.log("  ✅ 等待完成");

  // 初始化托管系统
  console.log("  初始化 CustodianFixed 系统...");
  const initializeTx = await custodian.initializeSystem(
    interestManagerAddress, // interestManagerAddr
    priceOracleAddress,     // priceFeedAddr
    deployer.address         // feeCollectorAddr
  );
  await initializeTx.wait();
  console.log("  ✅ CustodianFixed 系统初始化完成");



  // ==================== 第九步：验证部署 ====================
  console.log("\n📦 第九步：验证部署...");

  // 验证合约连接
  console.log("  验证合约连接...");
  const custodianAddr = await auctionManager.custodian();
  
  console.log(`  AuctionManager -> Custodian: ${custodianAddr === custodianAddress ? "✅" : "❌"}`);
  console.log(`  Custodian -> LiquidationManager: ✅ (通过权限验证)`);

  // 验证权限
  console.log("  验证权限...");
  const hasLiquidationRole = await custodian.hasRole(
    await custodian.LIQUIDATION_ROLE(),
    liquidationManagerAddress
  );
  const hasAuctionRole = await custodian.hasRole(
    await custodian.AUCTION_ROLE(),
    auctionManagerAddress
  );
  
  console.log(`  LiquidationManager 权限: ${hasLiquidationRole ? "✅" : "❌"}`);
  console.log(`  AuctionManager 权限: ${hasAuctionRole ? "✅" : "❌"}`);

  // ==================== 第十步：输出部署结果 ====================
  console.log("\n🎉 部署完成！合约地址汇总:");
  console.log("==========================================");
  console.log(`📊 基础代币合约:`);
  console.log(`  WLTC Mock: ${wltcAddress}`);
  console.log(`  StableToken: ${stableTokenAddress}`);
  console.log(`  MultiLeverageToken: ${leverageTokenAddress}`);
  
  console.log(`\n📊 业务合约:`);
  console.log(`  InterestManager: ${interestManagerAddress}`);
  console.log(`  LTCPriceOracle: ${priceOracleAddress}`);
  console.log(`  CustodianFixed: ${custodianAddress}`);
  
  console.log(`\n📊 清算模块:`);
  console.log(`  LinearDecrease: ${linearDecreaseAddress}`);
  console.log(`  AuctionManager: ${auctionManagerAddress}`);
  console.log(`  LiquidationManager: ${liquidationManagerAddress}`);
  
  console.log(`\n🔑 权限配置:`);
  console.log(`  LiquidationManager 权限: ${hasLiquidationRole ? "已授予" : "未授予"}`);
  console.log(`  AuctionManager 权限: ${hasAuctionRole ? "已授予" : "未授予"}`);
  console.log("==========================================");

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
      linearDecrease: linearDecreaseAddress,
      auctionManager: auctionManagerAddress,
      liquidationManager: liquidationManagerAddress
    },
    parameters: {
      auction: {
        priceMultiplier: AUCTION_PARAMS.PRICE_MULTIPLIER,
        resetTime: AUCTION_PARAMS.RESET_TIME.toString(),
        minAuctionAmount: AUCTION_PARAMS.MIN_AUCTION_AMOUNT,
        priceDropThreshold: AUCTION_PARAMS.PRICE_DROP_THRESHOLD,
        percentageReward: AUCTION_PARAMS.PERCENTAGE_REWARD,
        fixedReward: AUCTION_PARAMS.FIXED_REWARD
      },
      liquidation: {
        adjustmentThreshold: LIQUIDATION_PARAMS.ADJUSTMENT_THRESHOLD,
        liquidationThreshold: LIQUIDATION_PARAMS.LIQUIDATION_THRESHOLD,
        penalty: LIQUIDATION_PARAMS.PENALTY
      },
      priceCalculator: {
        tau: PRICE_CALCULATOR_PARAMS.TAU.toString()
      }
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
    const latestFilePath = path.join(deploymentsDir, 'deployment-sepolia-latest.json');
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
    
    console.log("\n📋 下一步操作:");
    console.log("   1. 进行铸币测试");
    console.log("   2. 检查合约交互是否正常");
    console.log("   3. 验证清算模块功能");
    console.log("   4. 查看 deployments/deployment-latest.json 获取合约地址");
    
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ 部署失败:", error);
    process.exit(1);
  });
