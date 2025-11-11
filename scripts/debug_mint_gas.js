import { network } from "hardhat";




async function main() {
  console.log("🚀 开始部署完整稳定币系统...");

  // 连接到网络
  const { ethers } = await network.connect();

  // 获取部署者账户
  const [deployer] = await ethers.getSigners();
  console.log(`📝 部署者地址: ${deployer.address}`);

  const stableToken = await ethers.getContractAt("StableToken", "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
  const leverageToken = await ethers.getContractAt("MultiLeverageToken", "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0");
  const custodian = await ethers.getContractAt("CustodianFixed_1", "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707");


    // ============= 杠杆级别定义 =============
  const LeverageType = {
    CONSERVATIVE: 0, // 1:8 比例，低杠杆
    MODERATE: 1,     // 1:4 比例，中等杠杆
    AGGRESSIVE: 2    // 1:1 比例，高杠杆
  };

  // ============= 铸币参数设置 =============
  const UNDERLYING_AMOUNT = ethers.parseUnits("1.0", 18); // 投入 1 个 WLTC
  const MINT_PRICE = ethers.parseUnits("100", 18);        // 铸币价格 $120
  const LEVERAGE_LEVEL = LeverageType.MODERATE;            // 使用枚举类型

  // ==================== 第八步：初始化系统 ====================
  console.log("\n📦 第八步：初始化系统...");

  // // 设置代币的托管合约
  // console.log("  设置代币的托管合约...");
  // await stableToken.setCustodian("0x97156c9E47761FDb4E41244AEc7596e6DFD40611");
  // await leverageToken.setCustodian("0x97156c9E47761FDb4E41244AEc7596e6DFD40611");
  // console.log("  ✅ 代币托管合约设置完成");
  const state = await custodian.state();
  const custodianAddrL = await leverageToken.custodian();
  const ustodianAddrS = await stableToken.custodian();
  const underlyingTokenAddr = await custodian.underlyingToken();

  const wltc = await ethers.getContractAt("WLTCMock", underlyingTokenAddr);
  console.log(`    Custodian 状态: ${state} (类型: ${typeof state})`);
  console.log(`    custodianAddrL 地址: ${custodianAddrL}`);
  console.log(`    ustodianAddrS 地址: ${ustodianAddrS}`);

    console.log("\n💳 检查账户余额和授权...");
    const wltcAmount = ethers.parseEther("100"); // 100 WLTC
    await wltc.mint(deployer.address, wltcAmount);
    await wltc.approve('0x5FC8d32690cc91D4c39d9d3abcBD16989F875707', wltcAmount);

    const wltcBalance = await wltc.balanceOf(deployer.address);
    const allowance = await wltc.allowance(deployer.address, '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707');
    console.log(`📋 WLTC 余额: ${ethers.formatUnits(wltcBalance, 18)}`);
    console.log(`📋 已授权额度: ${ethers.formatUnits(allowance, 18)}`);
        // 执行铸币交易
    const mintTx = await custodian.connect(deployer).mint(
      UNDERLYING_AMOUNT, // underlyingAmountInWei - 投入的 WLTC 数量
      MINT_PRICE,        // mintPriceInWei - 铸币价格
      LEVERAGE_LEVEL,    // leverageLevel - 杠杆级别 (枚举类型)
      {
        gasLimit: 800000 // 🔧 增加 gas limit，确保交易成功
      }
    );

    const receipt = await mintTx.wait();
    console.log("✅ 铸币交易确认成功!");
  // // 初始化托管系统
  // console.log("  初始化 CustodianFixed 系统...");
  // const initializeTx = await custodian.initializeSystem(
  //   "0x425978EfbF0310Ac5CA48C9FD67742fA421cAd78", // interestManagerAddr
  //   "0xc0521C9730e991209667288aa028d5D13Fa3345A",     // priceFeedAddr
  //   deployer.address         // feeCollectorAddr
  // );
  // await initializeTx.wait();
  // console.log("  ✅ CustodianFixed 系统初始化完成");
  // console.log(`\n💾 部署信息汇总完成`);
  
}


main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ 测试失败:", error);
    process.exit(1);
  });
