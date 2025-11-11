import hre from "hardhat";

/*

  📋 =============== 部署摘要 ===============
  ✅ 所有合约部署成功!

  📄 StableToken:
    - 地址: 0xc737f2b19790120032327F7c6fCF886DA9ed672f
    - 名称: Stable Token (S)

  📄 MultiLeverageToken:
    - 地址: 0x89106De21Be816F3823b7011C91569C27Cf8C18a
    - Base URI: ipfs://bafybeib5e4rylv4rfvy7afaoevomygulwp7oxgp4rzcjexcgnrbw34cgfm/
    - 静态Token: 1-9

  🔗 URI 信息:
    - 输入格式: ipfs://bafybeib5e4rylv4rfvy7afaoevomygulwp7oxgp4rzcjexcgnrbw34cgfm/
    - 实际存储: ipfs://bafybeib5e4rylv4rfvy7afaoevomygulwp7oxgp4rzcjexcgnrbw34cgfm/
    - IPFS网关: https://ipfs.io/ipfs/bafybeib5e4rylv4rfvy7afaoevomygulwp7oxgp4rzcjexcgnrbw34cgfm/       

  💡 URI 格式说明:
    - ipfs:// 是标准格式，由客户端解析
    - 如果钱包不支持，会自动使用公共网关
    - OpenSea 等平台会自动处理 IPFS URI
  ========================================

*/

async function main(): Promise<void> {

  const ethers = (hre as any).ethers;

  console.log("🚀 开始部署代币合约...");
  console.log("📡 当前网络:", hre.network.name);

  const [deployer] = await ethers.getSigners();
  console.log("👤 部署账户:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 账户余额:", ethers.formatEther(balance), "ETH");

  try {
    // ============= 第一步：部署 StableToken =============
    console.log("\n📄 部署 StableToken...");
    
    const StableTokenFactory = await ethers.getContractFactory("StableToken");
    const stableToken = await StableTokenFactory.deploy();

    await stableToken.waitForDeployment();
    const stableTokenAddress = await stableToken.getAddress();
    
    console.log("✅ StableToken 部署成功!");
    console.log("📄 合约地址:", stableTokenAddress);

    // 验证 StableToken 基本信息
    const stableName = await stableToken.name();
    const stableSymbol = await stableToken.symbol();
    const stableDecimals = await stableToken.decimals();
    const owner = await stableToken.owner();
    const custodian = await stableToken.custodian();

    console.log("📋 StableToken 信息:");
    console.log(`   - 名称: ${stableName} (${stableSymbol})`);
    console.log(`   - 精度: ${stableDecimals} 位`);
    console.log(`   - Owner: ${owner}`);
    console.log(`   - Custodian: ${custodian === ethers.ZeroAddress ? '(未设置)' : custodian}`);

    // ============= 第二步：部署 MultiLeverageToken =============
    console.log("\n📄 部署 MultiLeverageToken...");

    // ✅ 使用正确的 IPFS URI 格式
    const IPFS_METADATA_URI = "ipfs://bafybeib5e4rylv4rfvy7afaoevomygulwp7oxgp4rzcjexcgnrbw34cgfm/";
    
    console.log("🔗 使用的 Metadata URI:", IPFS_METADATA_URI);
    
    const MultiLeverageTokenFactory = await ethers.getContractFactory("MultiLeverageToken");
    const leverageToken = await MultiLeverageTokenFactory.deploy(IPFS_METADATA_URI);

    await leverageToken.waitForDeployment();
    const leverageTokenAddress = await leverageToken.getAddress();

    console.log("✅ MultiLeverageToken 部署成功!");
    console.log("📄 合约地址:", leverageTokenAddress);

    // 验证 MultiLeverageToken 基本信息
    const leverageOwner = await leverageToken.owner();
    const leverageCustodian = await leverageToken.custodian();
    const leverageBaseURI = await leverageToken.baseURI();
    const nextTokenId = await leverageToken.nextTokenId();
    
    console.log("📋 MultiLeverageToken 信息:");
    console.log(`   - 类型: ERC1155`);
    console.log(`   - Owner: ${leverageOwner}`);
    console.log(`   - Custodian: ${leverageCustodian === ethers.ZeroAddress ? '(未设置)' : leverageCustodian}`);
    console.log(`   - Base URI: ${leverageBaseURI}`);
    console.log(`   - 下一个动态Token ID: ${nextTokenId}`);

    // ============= 第三步：测试 URI 生成 =============
    console.log("\n🔍 测试 URI 生成...");
    
    // 测试不同 tokenId 的 URI 生成
    for (let tokenId = 1; tokenId <= 3; tokenId++) {
      try {
        const tokenURI = await leverageToken.uri(tokenId);
        console.log(`   - Token ${tokenId} URI: ${tokenURI}`);
        
        // 检查 URI 格式是否正确
        if (tokenURI.includes("ipfs://") || tokenURI.includes("https://")) {
          console.log(`     ✅ URI 格式正确`);
        } else {
          console.log(`     ⚠️  URI 格式可能需要调整`);
        }
      } catch (error: any) {
        console.log(`   - Token ${tokenId} URI 生成失败: ${error.message}`);
      }
    }

    // ============= 第四步：验证静态Token初始化 =============
    console.log("\n🔍 验证静态Token初始化...");
    
    for (let tokenId = 1; tokenId <= 9; tokenId++) {
      try {
        const tokenExists = await leverageToken.tokenExists(tokenId);
        const isStatic = await leverageToken.isStaticToken(tokenId);
        
        if (tokenExists && isStatic) {
          const tokenInfo = await leverageToken.getTokenInfo(tokenId);
          const leverageType = tokenInfo[0];
          const mintPrice = tokenInfo[1];
          const tokenName = tokenInfo[3];
          
          console.log(`   - Token ${tokenId}: ${tokenName}`);
          console.log(`     杠杆: ${leverageType}, 价格: $${ethers.formatUnits(mintPrice, 18)}`);
          
          // 测试这个 token 的完整 URI
          const fullURI = await leverageToken.uri(tokenId);
          console.log(`     完整URI: ${fullURI}`);
        } else {
          console.log(`   - Token ${tokenId}: 不存在或非静态token`);
        }
      } catch (error: any) {
        console.log(`   - Token ${tokenId}: 查询失败 - ${error.message}`);
      }
    }

    // ============= 第五步：设置Custodian =============
    console.log("\n🔧 设置临时 Custodian...");

    // StableToken
    const setStableCustodianTx = await stableToken.setCustodian(deployer.address);
    await setStableCustodianTx.wait();
    console.log("✅ StableToken Custodian 设置完成");

    // MultiLeverageToken
    const setLeverageCustodianTx = await leverageToken.setCustodian(deployer.address);
    await setLeverageCustodianTx.wait();
    console.log("✅ MultiLeverageToken Custodian 设置完成");

    // ============= 第六步：测试功能 =============
    console.log("\n🧪 测试基本功能...");

    // 测试 StableToken 铸造
    const testStableAmount = ethers.parseUnits("1000", 18);
    const mintStableTx = await stableToken.mint(deployer.address, testStableAmount);
    await mintStableTx.wait();
    
    const stableBalance = await stableToken.balanceOf(deployer.address);
    console.log(`✅ StableToken 余额: ${ethers.formatUnits(stableBalance, 18)} S`);

    // 测试静态杠杆代币铸造
    const testLeverageAmount = ethers.parseUnits("100", 18);
    const staticTokenId = 1;
    
    const mintLeverageTx = await leverageToken.mintStaticToken(
      deployer.address, 
      staticTokenId, 
      testLeverageAmount
    );
    await mintLeverageTx.wait();
    
    const leverageBalance = await leverageToken.balanceOf(deployer.address, staticTokenId);
    console.log(`✅ 杠杆代币余额: ${ethers.formatUnits(leverageBalance, 18)} (Token ID: ${staticTokenId})`);

    // ============= 输出最终摘要 =============
    console.log("\n📋 =============== 部署摘要 ===============");
    console.log("✅ 所有合约部署成功!");
    console.log("");
    console.log("📄 StableToken:");
    console.log(`   - 地址: ${stableTokenAddress}`);
    console.log(`   - 名称: ${stableName} (${stableSymbol})`);
    console.log("");
    console.log("📄 MultiLeverageToken:");
    console.log(`   - 地址: ${leverageTokenAddress}`);
    console.log(`   - Base URI: ${leverageBaseURI}`);
    console.log(`   - 静态Token: 1-9`);
    console.log("");
    console.log("🔗 URI 信息:");
    console.log(`   - 输入格式: ${IPFS_METADATA_URI}`);
    console.log(`   - 实际存储: ${leverageBaseURI}`);
    console.log(`   - IPFS网关: https://ipfs.io/ipfs/bafybeib5e4rylv4rfvy7afaoevomygulwp7oxgp4rzcjexcgnrbw34cgfm/`);
    console.log("");
    console.log("💡 URI 格式说明:");
    console.log("   - ipfs:// 是标准格式，由客户端解析");
    console.log("   - 如果钱包不支持，会自动使用公共网关");
    console.log("   - OpenSea 等平台会自动处理 IPFS URI");
    console.log("========================================");

    // 最终部署信息
    const deploymentInfo = {
      network: hre.network.name,
      deployer: deployer.address,
      timestamp: new Date().toISOString(),
      contracts: {
        stableToken: {
          address: stableTokenAddress,
          name: stableName,
          symbol: stableSymbol,
          type: "ERC20"
        },
        multiLeverageToken: {
          address: leverageTokenAddress,
          baseURI: leverageBaseURI,
          ipfsURI: IPFS_METADATA_URI,
          type: "ERC1155"
        }
      }
    };

    console.log("\n💾 部署信息 (JSON):");
    console.log(JSON.stringify(deploymentInfo, null, 2));

  } catch (error: any) {
    console.error("\n❌ 部署失败:", error.message);
    
    if (error.message.includes("invalid URI")) {
      console.log("\n💡 URI 格式建议:");
      console.log("   - 使用: ipfs://CID/");
      console.log("   - 或: ipfs://CID/{id}.json");
      console.log("   - 避免: https://... 直接URL");
    }
    
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log("\n🎉 部署完成!");
    process.exit(0);
  })
  .catch((error: Error) => {
    console.error("\n💥 执行失败:", error);
    process.exit(1);
  });