const { ethers, upgrades } = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
    console.log("🚀 开始部署 MultiLeverageToken...");
    
    // 获取部署者账户
    const [deployer] = await ethers.getSigners();
    console.log("📋 部署者地址:", deployer.address);
    console.log("💰 部署者余额:", ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH");
    
    // ✅ 配置metadata IPFS URI (替换为你的实际CID)
    const METADATA_CID = "bafybeib5e4rylv4rfvy7afaoevomygulwp7oxgp4rzcjexcgnrbw34cgfm"; // 🔄 替换为你上传后的实际CID
    const staticMetadataURI = `ipfs://${METADATA_CID}/`;
    
    console.log("📁 Metadata URI:", staticMetadataURI);
    
    // ✅ 获取合约工厂
    const MultiLeverageToken = await ethers.getContractFactory("MultiLeverageToken");
    
    // ✅ 部署合约
    console.log("⏳ 正在部署合约...");
    const multiLeverageToken = await MultiLeverageToken.deploy(staticMetadataURI);
    
    // 等待部署完成
    await multiLeverageToken.waitForDeployment();
    const contractAddress = await multiLeverageToken.getAddress();
    
    console.log("✅ MultiLeverageToken 部署成功!");
    console.log("📍 合约地址:", contractAddress);
    console.log("🔗 区块链浏览器:", `https://etherscan.io/address/${contractAddress}`);
    
    // ✅ 验证部署
    console.log("\n🔍 验证部署状态...");
    
    // 检查owner
    const owner = await multiLeverageToken.owner();
    console.log("👤 合约Owner:", owner);
    
    // 检查静态token初始化
    console.log("🔢 检查静态token初始化...");
    for (let i = 1; i <= 9; i++) {
        const tokenInfo = await multiLeverageToken.tokens(i);
        const leverageTypes = ["CONSERVATIVE", "MODERATE", "AGGRESSIVE"];
        console.log(`   Token ${i}: ${leverageTypes[tokenInfo.leverageType]} - P0: $${ethers.formatEther(tokenInfo.mintPrice)} - Static: ${tokenInfo.isStatic}`);
    }
    
    // 测试URI生成
    console.log("\n🌐 测试URI生成...");
    const uri1 = await multiLeverageToken.uri(1);
    const uri5 = await multiLeverageToken.uri(5);
    const uri9 = await multiLeverageToken.uri(9);
    console.log("   Token 1 URI:", uri1);
    console.log("   Token 5 URI:", uri5);
    console.log("   Token 9 URI:", uri9);
    
    // ✅ 保存部署信息
    const deploymentInfo = {
        network: hre.network.name,
        contractAddress: contractAddress,
        contractName: "MultiLeverageToken",
        deployer: deployer.address,
        deploymentTime: new Date().toISOString(),
        metadataCID: METADATA_CID,
        metadataURI: staticMetadataURI,
        gasUsed: "TBD", // 可以在交易回执中获取
        blockNumber: "TBD",
        transactionHash: "TBD",
        constructorArgs: [staticMetadataURI],
        staticTokensConfig: {
            1: "AGGRESSIVE-110",
            2: "AGGRESSIVE-120", 
            3: "AGGRESSIVE-130",
            4: "CONSERVATIVE-110",
            5: "CONSERVATIVE-120",
            6: "CONSERVATIVE-130",
            7: "MODERATE-110",
            8: "MODERATE-120",
            9: "MODERATE-130"
        }
    };
    
    // 保存到文件
    const deploymentsDir = path.join(__dirname, "../../deployments");
    if (!fs.existsSync(deploymentsDir)) {
        fs.mkdirSync(deploymentsDir, { recursive: true });
    }
    
    const deploymentFile = path.join(deploymentsDir, `MultiLeverageToken-${hre.network.name}-${Date.now()}.json`);
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
    
    console.log("💾 部署信息已保存到:", deploymentFile);
    
    // ✅ 等待几个区块确认后进行验证
    if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
        console.log("\n⏳ 等待区块确认用于合约验证...");
        await multiLeverageToken.deploymentTransaction().wait(6);
        
        console.log("🔐 开始合约验证...");
        try {
            await hre.run("verify:verify", {
                address: contractAddress,
                constructorArguments: [staticMetadataURI],
            });
            console.log("✅ 合约验证成功!");
        } catch (error) {
            console.log("❌ 合约验证失败:", error.message);
            console.log("💡 你可以稍后手动验证合约");
        }
    }
    
    // ✅ 显示后续操作提示
    console.log("\n📋 后续操作:");
    console.log("1. 设置托管人地址:");
    console.log(`   await contract.setCustodian("0x...custodian_address")`);
    console.log("\n2. 测试铸造静态token:");
    console.log(`   await contract.mintStaticToken(userAddress, 1, ethers.parseEther("1"))`);
    console.log("\n3. 创建动态token:");
    console.log(`   await contract.createAndMintDynamicToken(userAddress, 0, ethers.parseEther("200"), ethers.parseEther("0.5"))`);
    console.log("\n4. 检查metadata文件:");
    console.log(`   访问: ${staticMetadataURI}Aggressive110.json`);
    console.log(`   访问: ${staticMetadataURI}Conservative120.json`);
    
    return {
        contract: multiLeverageToken,
        address: contractAddress,
        deploymentInfo: deploymentInfo
    };
}

// 错误处理
main()
    .then(({ address }) => {
        console.log(`\n🎉 部署完成! 合约地址: ${address}`);
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ 部署失败:", error);
        process.exit(1);
    });

module.exports = { main };