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

    // 使用 hre.ethers 避免导入问题
    const ethers = (hre as any).ethers;

    console.log("🔍 查询 S Token 和 L Token 余额...");
    console.log("📡 当前网络:", hre.network.name);

    // 获取部署者账户
    const [deployer] = await ethers.getSigners();
    console.log("👤 查询地址:", deployer.address);

    // 代币合约地址（从部署脚本输出中获取）
    const STABLE_TOKEN_ADDRESS = "0xc737f2b19790120032327F7c6fCF886DA9ed672f";
    const LEVERAGE_TOKEN_ADDRESS = "0x89106De21Be816F3823b7011C91569C27Cf8C18a";
    const CUSTODIAN_FIXED_ADDRESS = "0x9Fb49EfD7dC50068eb19Cc7E4ac9cA77bCe9114A";

    // 杠杆级别枚举
    enum LeverageType {
        CONSERVATIVE = 0, // 1:8 比例，低杠杆
        MODERATE = 1,     // 1:4 比例，中等杠杆
        AGGRESSIVE = 2    // 1:1 比例，高杠杆
    }

    // 辅助函数：获取杠杆级别描述
    function getLeverageDescription(level: number): string {
        switch (level) {
            case 0: return "CONSERVATIVE (1:8)";
            case 1: return "MODERATE (1:4)";
            case 2: return "AGGRESSIVE (1:1)";
            default: return "UNKNOWN";
        }
    }

    try {
        // 获取代币合约实例
        const stableToken = await ethers.getContractAt("StableToken", STABLE_TOKEN_ADDRESS);
        const leverageToken = await ethers.getContractAt("MultiLeverageToken", LEVERAGE_TOKEN_ADDRESS);
        const custodianFixed = await ethers.getContractAt("CustodianFixed", CUSTODIAN_FIXED_ADDRESS);

        console.log("✅ 合约连接成功");

        // ============= 查询 S Token 余额 =============
        console.log("\n💰 查询 S Token 余额...");
        
        const stableBalance = await stableToken.balanceOf(deployer.address);
        console.log(`📊 StableToken 余额: ${ethers.formatUnits(stableBalance, 18)} S`);

        // ============= 查询所有 L Token 持仓信息 =============
        console.log("\n🎯 查询所有 L Token 持仓信息...");

        try {
            // 使用 CustodianFixed 的函数获取用户所有 L Token 信息
            const userTokenInfo = await custodianFixed.getAllLeverageTokenInfo(deployer.address);
            
            const tokenIds = userTokenInfo[0];
            const balances = userTokenInfo[1];
            const leverages = userTokenInfo[2];
            const mintPrices = userTokenInfo[3];
            const accruedInterests = userTokenInfo[4];

            if (tokenIds.length === 0) {
                console.log("📭 用户暂无 L Token 持仓");
                console.log("💡 运行铸币脚本创建持仓:");
                console.log("   npx hardhat run scripts/utilities/mint_SLtoken.ts --network sepolia");
            } else {
                console.log(`📊 找到 ${tokenIds.length} 个 L Token 持仓:`);
                console.log("-".repeat(60));

                let totalLTokenValue = 0;
                
                for (let i = 0; i < tokenIds.length; i++) {
                    const tokenId = tokenIds[i];
                    const balance = balances[i];
                    const leverage = leverages[i];
                    const mintPrice = mintPrices[i];
                    const accruedInterest = accruedInterests[i];

                    console.log(`\n🎯 Token ID: ${tokenId.toString()}`);
                    console.log(`   📦 持仓数量: ${ethers.formatUnits(balance, 18)}`);
                    console.log(`   🎚️  杠杆类型: ${getLeverageDescription(Number(leverage))}`);
                    console.log(`   💰 铸币价格: $${ethers.formatUnits(mintPrice, 18)}`);
                    console.log(`   📈 累积利息: ${ethers.formatUnits(accruedInterest, 18)}`);

                    // 获取 Token 详细信息
                    try {
                        const tokenDetails = await custodianFixed.getTokenDetails(tokenId);
                        const creationTime = new Date(Number(tokenDetails[2]) * 1000).toLocaleString();
                        const isStatic = tokenDetails[4];
                        
                        console.log(`   🏷️  Token 类型: ${isStatic ? "静态 Token" : "动态 Token"}`);
                        console.log(`   📅 创建时间: ${creationTime}`);

                    } catch (detailError: any) {
                        console.log(`   ⚠️ 获取详细信息失败: ${detailError.message}`);
                    }

                    // 尝试获取当前净值信息
                    try {
                        // 先获取当前价格
                        const priceResult = await custodianFixed.getLatestPriceView();
                        const currentPrice = priceResult[0];
                        const isValidPrice = priceResult[2];
                        console.log(`   ⏰ 价格更新时间: ${new Date(Number(priceResult[1]) * 1000).toLocaleString()}`);
                        console.log(`   📈 当前价格是否有效: ${isValidPrice}`);
                        console.log(`   📊 当前价格: $${ethers.formatUnits(currentPrice, 18)}`);


                        if (isValidPrice && currentPrice > 0) {
                            const navInfo = await custodianFixed.getSingleLeverageTokenNav(
                                deployer.address,
                                tokenId,
                                currentPrice
                            );

                            const grossNav = ethers.formatUnits(navInfo[1], 18);
                            const netNav = ethers.formatUnits(navInfo[2], 18);
                            const totalValue = ethers.formatUnits(navInfo[3], 18);
                            const netValue = ethers.formatUnits(navInfo[4], 18);

                            console.log(`   📊 当前价格: $${ethers.formatUnits(currentPrice, 18)}`);
                            console.log(`   📈 总净值: ${grossNav}`);
                            console.log(`   💎 除息净值: ${netNav}`);
                            console.log(`   💵 总价值: $${totalValue}`);
                            console.log(`   💰 净价值: $${netValue}`);

                            // 计算盈亏
                            const navNumber = parseFloat(grossNav);
                            const pnlPercent = ((navNumber - 1.0) * 100).toFixed(2);
                            const pnlColor = parseFloat(pnlPercent) >= 0 ? "📈" : "📉";
                            console.log(`   ${pnlColor} 盈亏: ${pnlPercent}%`);

                            totalLTokenValue += parseFloat(totalValue);

                        } else {
                            console.log(`   ⚠️ 无法获取有效价格，跳过净值计算`);
                        }

                    } catch (navError: any) {
                        console.log(`   ⚠️ 净值计算失败: ${navError.message}`);
                    }
                }

                // ============= 汇总信息 =============
                console.log("\n" + "=".repeat(60));
                console.log("📊 持仓汇总:");
                console.log(`   📦 S Token 总余额: ${ethers.formatUnits(stableBalance, 18)}`);
                console.log(`   🎯 L Token 持仓数: ${tokenIds.length} 个`);
                console.log(`   💰 L Token 总价值: $${totalLTokenValue.toFixed(6)}`);
                
                // 计算总价值
                const sTokenValue = parseFloat(ethers.formatUnits(stableBalance, 18));
                const totalPortfolioValue = sTokenValue + totalLTokenValue;
                console.log(`   💎 投资组合总价值: $${totalPortfolioValue.toFixed(6)}`);

                // 获取用户抵押品信息
                try {
                    const userCollateral = await custodianFixed.getUserCollateral(deployer.address);
                    console.log(`   🏦 抵押品数量: ${ethers.formatUnits(userCollateral, 18)} WLTC`);
                } catch (collateralError: any) {
                    console.log(`   ⚠️ 获取抵押品信息失败: ${collateralError.message}`);
                }
            }

        } catch (tokenInfoError: any) {
            console.log("❌ 获取 L Token 信息失败:", tokenInfoError.message);
            console.log("💡 尝试手动查询静态 Token ID...");

            // 备用方案：手动查询已知的静态 Token ID (1-9)
            console.log("\n🔍 手动查询静态 Token ID (1-9):");
            let foundAnyBalance = false;

            for (let tokenId = 1; tokenId <= 9; tokenId++) {
                try {
                    const balance = await leverageToken.balanceOf(deployer.address, tokenId);
                    
                    if (balance > 0) {
                        foundAnyBalance = true;
                        console.log(`   ✅ Token ID ${tokenId}: ${ethers.formatUnits(balance, 18)} 个`);
                        
                        // 获取 Token 信息
                        try {
                            const tokenInfo = await leverageToken.getTokenInfo(tokenId);
                            const leverage = tokenInfo[0];
                            const mintPrice = tokenInfo[1];
                            const isStatic = tokenInfo[4];
                            
                            console.log(`      - 杠杆: ${getLeverageDescription(Number(leverage))}`);
                            console.log(`      - 铸币价格: $${ethers.formatUnits(mintPrice, 18)}`);
                            console.log(`      - 类型: ${isStatic ? "静态" : "动态"}`);
                            
                        } catch (infoError: any) {
                            console.log(`      - ⚠️ 获取信息失败: ${infoError.message}`);
                        }
                    } else {
                        console.log(`   📭 Token ID ${tokenId}: 0 个`);
                    }
                    
                } catch (balanceError: any) {
                    console.log(`   ❌ Token ID ${tokenId}: 查询失败 - ${balanceError.message}`);
                }
            }

            if (!foundAnyBalance) {
                console.log("📭 所有静态 Token ID 余额均为 0");
            }
        }

        // ============= 额外的系统信息 =============
        console.log("\n🌐 系统信息:");
        
        try {
            // 获取项目统计
            const projectStats = await custodianFixed.getProjectStats();
            console.log(`   📊 系统 S Token 总供应: ${ethers.formatUnits(projectStats[0], 18)}`);
            console.log(`   🎯 系统 L Token 总供应: ${ethers.formatUnits(projectStats[1], 18)}`);
            console.log(`   🏦 系统锁定资产总量: ${ethers.formatUnits(projectStats[2], 18)} WLTC`);
        } catch (statsError: any) {
            console.log(`   ⚠️ 获取系统统计失败: ${statsError.message}`);
        }

        try {
            // 获取当前价格信息
            const priceResult = await custodianFixed.getLatestPriceView();
            const currentPrice = priceResult[0];
            const priceTimestamp = priceResult[1];
            const isValidPrice = priceResult[2];

            if (isValidPrice) {
                console.log(`   📈 当前 LTC 价格: $${ethers.formatUnits(currentPrice, 18)}`);
                console.log(`   ⏰ 价格更新时间: ${new Date(Number(priceTimestamp) * 1000).toLocaleString()}`);
            } else {
                console.log(`   ⚠️ 当前价格无效`);
            }
        } catch (priceError: any) {
            console.log(`   ⚠️ 获取价格信息失败: ${priceError.message}`);
        }

    } catch (error: any) {
        console.error("❌ 查询失败:", error.message);
        
        if (error.message.includes("call revert exception")) {
            console.log("\n💡 可能原因:");
            console.log("   - 合约未正确部署");
            console.log("   - 合约地址错误");
            console.log("   - 网络连接问题");
        }
        
        if (error.message.includes("invalid address")) {
            console.log("\n💡 地址问题:");
            console.log("   - 检查合约地址格式是否正确");
            console.log("   - 确认合约已在当前网络部署");
        }
        
        process.exit(1);
    }
}

main()
  .then(() => {
    console.log("\n🎉 余额查询完成!");
    process.exit(0);
  })
  .catch((error: Error) => {
    console.error("\n💥 查询失败:", error);
    process.exit(1);
  });