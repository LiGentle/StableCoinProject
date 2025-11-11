import { network } from "hardhat";

async function main() {
  console.log("🔍 简单 gas 测试...");

  // 连接到网络
  const { ethers } = await network.connect();

  // 获取账户
  const [deployer,  user1] = await ethers.getSigners();
  console.log(`📝 部署者: ${deployer.address}`);

  // 合约地址
  const leverageTokenAddr = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";

  // 获取合约实例
  const leverageToken = await ethers.getContractAt("MultiLeverageToken", leverageTokenAddr);

  console.log("✅ 合约实例化完成");

  try {
    // 1. 测试简单的 view 函数
    console.log("1. 测试 balanceOfInWei...");
    const balance = await leverageToken.balanceOfInWei(deployer.address, 0);
    console.log(`   ✅ balanceOfInWei 成功: ${ethers.formatEther(balance)}`);

    // 2. 测试 gas 估算
    console.log("2. 测试 gas 估算...");
    const estimatedGas = await leverageToken.balanceOfInWei.estimateGas(user1.address, 0);
    console.log(`   ✅ gas 估算成功: ${estimatedGas}`);

    console.log("🎉 所有测试通过！localhost 网络正常");

  } catch (error) {
    console.log(`❌ 测试失败: ${error.message}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 脚本执行失败:", error);
    process.exit(1);
  });
