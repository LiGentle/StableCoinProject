import hre from "hardhat";

async function publishMultiLeverageToken(): Promise<void> {
  console.log("🔍 开始验证 MultiLeverageToken 合约...");

  const LEVERAGE_TOKEN_ADDRESS = "0x89106De21Be816F3823b7011C91569C27Cf8C18a";
  const IPFS_BASE_URI = "ipfs://bafybeib5e4rylv4rfvy7afaoevomygulwp7oxgp4rzcjexcgnrbw34cgfm/";

  try {
    console.log("📄 验证合约地址:", LEVERAGE_TOKEN_ADDRESS);
    console.log("📋 构造函数参数:", IPFS_BASE_URI);

    await hre.run("verify:verify", {
      address: LEVERAGE_TOKEN_ADDRESS,
      constructorArguments: [
        IPFS_BASE_URI
      ],
    });

    console.log("✅ MultiLeverageToken 合约验证成功！");
    console.log("🌐 查看验证结果:");
    console.log(`   https://sepolia.etherscan.io/address/${LEVERAGE_TOKEN_ADDRESS}#code`);

  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("✅ 合约已经验证过了！");
    } else {
      console.error("❌ 验证失败:", error.message);
    }
  }
}

verifyMultiLeverageToken()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });