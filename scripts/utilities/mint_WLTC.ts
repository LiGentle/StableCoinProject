import hre from "hardhat";

async function mintWLTCForUsers(): Promise<void> {
  const ethers = (hre as any).ethers;
  const [owner] = await ethers.getSigners();

  console.log("🏦 开始为用户铸造 WLTC 代币...");
  console.log("👤 操作者:", owner.address);
  console.log("🌐 网络:", hre.network.name);
  console.log("=" .repeat(60));

  // 🔗 WLTC 合约地址 (需要先部署 WLTC 合约)
  const WLTC_CONTRACT_ADDRESS = "0x9DFF6745444c05bbEc03bF59C0910731C02950dd"; // ❗ 需要更新为实际地址

  // 👥 用户地址列表
  const USERS = [
    {
      address: "0x6bCf5fbb6569921c508eeA15fF16b92426F99218",
      name: "Zhou Jingqi"
    },
    {
      address: "0x0f4d9b55A1bBD0aA8e9c55eA1442DCE69b1E226B",
      name: "Wang Xin"
    },
    {
      address: "0xA4b399a194e2DD9b84357E92474D0c32e3359A74",
      name: "Lijing Tao"
    }
  ];

  // 💰 每个用户铸造 100,000 WLTC (18位精度)
  const MINT_AMOUNT = ethers.parseUnits("100000", 18);
  
  console.log("📋 铸造配置:");
  console.log(`   合约地址: ${WLTC_CONTRACT_ADDRESS}`);
  console.log(`   每人数量: ${ethers.formatUnits(MINT_AMOUNT, 18)} WLTC`);
  console.log(`   原始数值: ${MINT_AMOUNT.toString()}`);
  console.log(`   用户数量: ${USERS.length}`);

  try {
    // 📄 连接 WLTC 合约
    console.log("\n📄 连接 WLTC 合约...");
    const wltcContract = await ethers.getContractAt("WLTCMock", WLTC_CONTRACT_ADDRESS);
    
    // 验证合约信息
    const tokenName = await wltcContract.name();
    const tokenSymbol = await wltcContract.symbol();
    const decimals = await wltcContract.decimals();
    const contractOwner = await wltcContract.owner();
    
    console.log("✅ 合约信息验证:");
    console.log(`   名称: ${tokenName}`);
    console.log(`   符号: ${tokenSymbol}`);
    console.log(`   精度: ${decimals} 位小数`);
    console.log(`   Owner: ${contractOwner}`);
    
    // 验证操作权限
    if (contractOwner.toLowerCase() !== owner.address.toLowerCase()) {
      console.log("⚠️ 警告: 当前账户不是合约 Owner");
      console.log(`   合约 Owner: ${contractOwner}`);
      console.log(`   当前账户: ${owner.address}`);
      throw new Error("无铸币权限");
    }

    // 🔄 为每个用户铸造 WLTC
    console.log("\n🔄 开始铸造过程...");
    console.log("-" .repeat(40));

    for (let i = 0; i < USERS.length; i++) {
      const user = USERS[i];
      
      console.log(`\n👤 处理用户 ${i + 1}/${USERS.length}: ${user.name}`);
      console.log(`📍 地址: ${user.address}`);

      try {
        // 检查铸造前余额
        const balanceBefore = await wltcContract.balanceOf(user.address);
        console.log(`💰 铸造前余额: ${ethers.formatUnits(balanceBefore, 18)} WLTC`);

        // 执行铸造
        console.log("🔨 正在铸造...");
        const mintTx = await wltcContract.mint(user.address, MINT_AMOUNT);
        console.log(`📝 交易哈希: ${mintTx.hash}`);
        
        // 等待交易确认
        console.log("⏳ 等待交易确认...");
        const receipt = await mintTx.wait();
        console.log(`✅ 交易已确认 (区块: ${receipt.blockNumber})`);

        // 验证铸造结果
        const balanceAfter = await wltcContract.balanceOf(user.address);
        const actualMinted = balanceAfter - balanceBefore;

        console.log("📊 铸造结果:");
        console.log(`   铸造前: ${ethers.formatUnits(balanceBefore, 18)} WLTC`);
        console.log(`   铸造后: ${ethers.formatUnits(balanceAfter, 18)} WLTC`);
        console.log(`   实际铸造: ${ethers.formatUnits(actualMinted, 18)} WLTC`);
        console.log(`   Gas 使用: ${receipt.gasUsed.toString()}`);

        // 验证数量是否正确
        if (actualMinted === MINT_AMOUNT) {
          console.log(`✅ ${user.name} 铸造成功!`);
        } else {
          console.log(`⚠️ ${user.name} 铸造数量不匹配!`);
        }

      } catch (error: any) {
        console.error(`❌ ${user.name} 铸造失败:`, error.message);
        
        // 继续处理下一个用户，不中断整个流程
        console.log("➡️ 继续处理下一个用户...");
      }

      // 添加延迟，避免交易过于频繁
      if (i < USERS.length - 1) {
        console.log("⏸️ 等待 2 秒后继续...");
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // 📊 最终统计和验证
    console.log("\n" + "=" .repeat(60));
    console.log("📊 最终统计和验证");
    console.log("=" .repeat(60));

    let totalMinted = 0n;
    let successfulMints = 0;

    for (const user of USERS) {
      try {
        const finalBalance = await wltcContract.balanceOf(user.address);
        console.log(`\n👤 ${user.name}:`);
        console.log(`   地址: ${user.address}`);
        console.log(`   最终余额: ${ethers.formatUnits(finalBalance, 18)} WLTC`);
        console.log(`   原始数值: ${finalBalance.toString()}`);

        if (finalBalance >= MINT_AMOUNT) {
          console.log(`   状态: ✅ 成功`);
          totalMinted += MINT_AMOUNT;
          successfulMints++;
        } else {
          console.log(`   状态: ❌ 不足 (期望: ${ethers.formatUnits(MINT_AMOUNT, 18)})`);
        }

      } catch (error: any) {
        console.log(`\n👤 ${user.name}:`);
        console.log(`   地址: ${user.address}`);
        console.log(`   状态: ❌ 查询失败 (${error.message})`);
      }
    }

    // 查询合约总供应量
    try {
      const totalSupply = await wltcContract.totalSupply();
      console.log(`\n📊 合约总供应量: ${ethers.formatUnits(totalSupply, 18)} WLTC`);
    } catch (error: any) {
      console.log("\n📊 无法查询总供应量:", error.message);
    }

    // 铸造摘要
    console.log(`\n📋 铸造摘要:`);
    console.log(`   目标用户数: ${USERS.length}`);
    console.log(`   成功铸造: ${successfulMints}`);
    console.log(`   每人数量: ${ethers.formatUnits(MINT_AMOUNT, 18)} WLTC`);
    console.log(`   总铸造量: ${ethers.formatUnits(totalMinted, 18)} WLTC`);
    console.log(`   成功率: ${((successfulMints / USERS.length) * 100).toFixed(1)}%`);

    if (successfulMints === USERS.length) {
      console.log("\n🎉 所有用户 WLTC 铸造完成!");
    } else {
      console.log(`\n⚠️ ${USERS.length - successfulMints} 个用户铸造失败，请检查错误信息`);
    }

    // 使用示例
    console.log("\n📖 后续使用示例:");
    console.log("// 查询用户余额");
    console.log(`const wltc = await ethers.getContractAt("WLTCMock", "${WLTC_CONTRACT_ADDRESS}");`);
    console.log(`const balance = await wltc.balanceOf("用户地址");`);
    console.log(`console.log("余额:", ethers.formatUnits(balance, 18), "WLTC");`);

  } catch (error: any) {
    console.error("\n💥 铸造过程发生错误:", error.message);
    
    // 错误处理建议
    console.log("\n🔧 故障排除建议:");
    if (error.message.includes("Ownable")) {
      console.log("   - 检查是否有 Owner 权限");
      console.log("   - 确认使用正确的部署账户");
    }
    if (error.message.includes("insufficient funds")) {
      console.log("   - 账户 ETH 余额不足支付 Gas");
      console.log("   - 获取测试 ETH: https://sepoliafaucet.com/");
    }
    if (error.message.includes("invalid address")) {
      console.log("   - 检查合约地址是否正确");
      console.log("   - 确认合约已正确部署");
    }
    
    process.exit(1);
  }
}

mintWLTCForUsers()
  .then(() => {
    console.log("\n✅ WLTC 铸造脚本执行完成!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 脚本执行失败:", error);
    process.exit(1);
  });