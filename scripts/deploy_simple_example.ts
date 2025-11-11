import hre from "hardhat";

/**
 * 使用 Hardhat Runtime Environment (hre) 部署合约的简单示例
 * 
 * 这个示例展示了如何使用 hre 来：
 * 1. 获取网络信息
 * 2. 获取部署账户
 * 3. 部署合约
 * 4. 与合约交互
 */

async function main(): Promise<void> {
  // 获取 ethers 实例
  const ethers = hre.ethers;

  console.log("🚀 开始部署合约...");
  
  // 1. 查询当前网络信息
  console.log("📡 当前网络:", hre.network.name);
  
  const network = await ethers.provider.getNetwork();
  console.log("🔗 链ID:", network.chainId);
  console.log("🌐 网络名称:", network.name);

  // 2. 获取部署账户
  const [deployer] = await ethers.getSigners();
  console.log("👤 部署账户:", deployer.address);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 账户余额:", ethers.formatEther(balance), "ETH");

  try {
    // 3. 部署一个简单的合约
    console.log("\n📄 部署 SimpleStorage 合约...");
    
    // 获取合约工厂
    const SimpleStorageFactory = await ethers.getContractFactory("SimpleStorage");
    
    // 部署合约（可以传递构造函数参数）
    const simpleStorage = await SimpleStorageFactory.deploy();
    
    // 等待部署完成
    await simpleStorage.waitForDeployment();
    
    // 获取合约地址
    const contractAddress = await simpleStorage.getAddress();
    console.log("✅ 合约部署成功!");
    console.log("📄 合约地址:", contractAddress);

    // 4. 与合约交互
    console.log("\n🧪 测试合约功能...");
    
    // 设置一个值
    const setTx = await simpleStorage.set(42);
    await setTx.wait();
    console.log("✅ 设置值: 42");
    
    // 读取值
    const value = await simpleStorage.get();
    console.log("📊 读取值:", value.toString());

    // 5. 获取交易信息
    console.log("\n📋 部署交易信息:");
    const deploymentTx = simpleStorage.deploymentTransaction();
    if (deploymentTx) {
      console.log("🔗 交易哈希:", deploymentTx.hash);
      console.log("⛽ Gas 价格:", ethers.formatUnits(deploymentTx.gasPrice || 0, "gwei"), "gwei");
    }

    // 6. 验证合约代码
    console.log("\n🔍 验证合约代码...");
    const code = await ethers.provider.getCode(contractAddress);
    if (code !== "0x") {
      console.log("✅ 合约代码已部署");
    } else {
      console.log("❌ 合约代码未找到");
    }

    // 7. 输出部署摘要
    console.log("\n📋 =============== 部署摘要 ===============");
    console.log("✅ 合约部署成功!");
    console.log("📄 合约名称: SimpleStorage");
    console.log("📍 合约地址:", contractAddress);
    console.log("👤 部署账户:", deployer.address);
    console.log("🌐 网络:", hre.network.name);
    console.log("🔗 链ID:", network.chainId);
    console.log("========================================");

  } catch (error: any) {
    console.error("\n❌ 部署失败:", error.message);
    
    // 错误处理
    if (error.message.includes("insufficient funds")) {
      console.log("💡 账户余额不足，请充值 ETH");
    }
    
    if (error.message.includes("nonce")) {
      console.log("💡 交易 nonce 问题，请稍后重试");
    }
    
    process.exit(1);
  }
}

// 运行部署脚本
main()
  .then(() => {
    console.log("\n🎉 部署脚本执行完成!");
    process.exit(0);
  })
  .catch((error: Error) => {
    console.error("\n💥 脚本执行失败:", error);
    process.exit(1);
  });

/**
 * 使用说明:
 * 
 * 1. 确保有 SimpleStorage.sol 合约文件
 * 2. 运行命令: npx hardhat run scripts/deploy_simple_example.ts --network <network-name>
 * 
 * 示例:
 * - npx hardhat run scripts/deploy_simple_example.ts --network hardhat
 * - npx hardhat run scripts/deploy_simple_example.ts --network sepolia
 * 
 * 如果需要部署到其他网络，请先在 hardhat.config.ts 中配置网络
 */
