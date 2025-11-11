import { network } from "hardhat";

async function main() {
  console.log("🔍 详细权限调试...");

  // 连接到网络
  const { ethers } = await network.connect();

  // 获取部署者账户
  const [deployer] = await ethers.getSigners();
  console.log(`📝 部署者地址: ${deployer.address}`);

  // 获取已部署的合约实例
  console.log("\n📦 获取已部署合约...");
  
  const custodianAddress = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";
  const auctionManagerAddress = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";
  const liquidationManagerAddress = "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318";

  const CustodianFixed = await ethers.getContractFactory("CustodianFixed");
  const custodian = CustodianFixed.attach(custodianAddress);

  const AuctionManager = await ethers.getContractFactory("DuchAuction");
  const auctionManager = AuctionManager.attach(auctionManagerAddress);

  const LiquidationManager = await ethers.getContractFactory("Liquidation");
  const liquidationManager = LiquidationManager.attach(liquidationManagerAddress);

  console.log(`  ✅ CustodianFixed: ${custodianAddress}`);
  console.log(`  ✅ AuctionManager: ${auctionManagerAddress}`);
  console.log(`  ✅ LiquidationManager: ${liquidationManagerAddress}`);

  // 详细权限检查
  console.log("\n🔍 详细权限检查...");
  
  // 检查 CustodianFixed 权限
  const custodianAdminRole = await custodian.ADMIN_ROLE();
  const custodianHasAdminRole = await custodian.hasRole(custodianAdminRole, deployer.address);
  console.log(`  Custodian - 部署者是否有 ADMIN_ROLE: ${custodianHasAdminRole ? "✅ 是" : "❌ 否"}`);
  
  const custodianDefaultAdminRole = await custodian.DEFAULT_ADMIN_ROLE();
  const custodianHasDefaultAdminRole = await custodian.hasRole(custodianDefaultAdminRole, deployer.address);
  console.log(`  Custodian - 部署者是否有 DEFAULT_ADMIN_ROLE: ${custodianHasDefaultAdminRole ? "✅ 是" : "❌ 否"}`);

  // 检查 AuctionManager 权限
  const auctionAdminRole = await auctionManager.ADMIN_ROLE();
  const auctionHasAdminRole = await auctionManager.hasRole(auctionAdminRole, deployer.address);
  console.log(`  AuctionManager - 部署者是否有 ADMIN_ROLE: ${auctionHasAdminRole ? "✅ 是" : "❌ 否"}`);

  // 检查 LiquidationManager 权限
  const liquidationAdminRole = await liquidationManager.ADMIN_ROLE();
  const liquidationHasAdminRole = await liquidationManager.hasRole(liquidationAdminRole, deployer.address);
  console.log(`  LiquidationManager - 部署者是否有 ADMIN_ROLE: ${liquidationHasAdminRole ? "✅ 是" : "❌ 否"}`);

  // 尝试调用权限函数
  console.log("\n🔍 尝试调用权限函数...");
  
  try {
    console.log("  尝试调用 custodian.grantLiquidationRole...");
    const tx = await custodian.grantLiquidationRole(liquidationManagerAddress);
    await tx.wait();
    console.log("  ✅ custodian.grantLiquidationRole 调用成功");
  } catch (error) {
    console.log(`  ❌ custodian.grantLiquidationRole 调用失败: ${error.message}`);
    console.log(`     错误详情: ${error.reason || error}`);
  }

  try {
    console.log("  尝试调用 auctionManager.grantCallerRole...");
    const tx = await auctionManager.grantCallerRole(liquidationManagerAddress);
    await tx.wait();
    console.log("  ✅ auctionManager.grantCallerRole 调用成功");
  } catch (error) {
    console.log(`  ❌ auctionManager.grantCallerRole 调用失败: ${error.message}`);
    console.log(`     错误详情: ${error.reason || error}`);
  }

  try {
    console.log("  尝试调用 liquidationManager.grantAuctionRole...");
    const tx = await liquidationManager.grantAuctionRole(auctionManagerAddress);
    await tx.wait();
    console.log("  ✅ liquidationManager.grantAuctionRole 调用成功");
  } catch (error) {
    console.log(`  ❌ liquidationManager.grantAuctionRole 调用失败: ${error.message}`);
    console.log(`     错误详情: ${error.reason || error}`);
  }

  console.log("\n📋 权限调试完成");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 调试失败:", error);
    process.exit(1);
  });
