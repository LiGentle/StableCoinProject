import hre from "hardhat";
import * as fs from "fs";

async function generateNFTBrowser(): Promise<void> {
  const ethers = (hre as any).ethers;

  console.log("🎨 生成 Leverage Token NFT 浏览器...");

  const [signer] = await ethers.getSigners();
  const WALLET_ADDRESS = signer.address;
  
  // 合约地址
  const STABLE_TOKEN_ADDRESS = "0xc737f2b19790120032327F7c6fCF886DA9ed672f";
  const LEVERAGE_TOKEN_ADDRESS = "0x89106De21Be816F3823b7011C91569C27Cf8C18a";
  const CUSTODIAN_FIXED_ADDRESS = "0x2e3E65a236c563a18d471278817722fE3fECd15e";
  const IPFS_BASE_URI = "ipfs://bafybeib5e4rylv4rfvy7afaoevomygulwp7oxgp4rzcjexcgnrbw34cgfm/";

  try {
    const leverageToken = await ethers.getContractAt("MultiLeverageToken", LEVERAGE_TOKEN_ADDRESS);
    const custodianFixed = await ethers.getContractAt("CustodianFixed", CUSTODIAN_FIXED_ADDRESS);
    const stableToken = await ethers.getContractAt("StableToken", STABLE_TOKEN_ADDRESS);

    console.log("✅ 合约连接成功");

    // 🔧 修复：正确传递 IPFS_BASE_URI 参数
    const userData = await fetchUserData(ethers, leverageToken, custodianFixed, stableToken, WALLET_ADDRESS, IPFS_BASE_URI);
    
    // 生成 HTML
    const html = generateHTML(userData, WALLET_ADDRESS, LEVERAGE_TOKEN_ADDRESS, IPFS_BASE_URI);
    
    // 保存文件
    fs.writeFileSync('leverage_nft_browser.html', html);
    console.log("✅ NFT 浏览器已生成: leverage_nft_browser.html");
    console.log("🌐 在浏览器中打开文件即可查看你的 Leverage Token NFT 收藏");

  } catch (error: any) {
    console.error("❌ 生成失败:", error.message);
    process.exit(1);
  }
}

// 🔧 修复：添加 IPFS_BASE_URI 参数
async function fetchUserData(ethers: any, leverageToken: any, custodianFixed: any, stableToken: any, walletAddress: string, IPFS_BASE_URI: string) {
  const userData = {
    walletAddress,
    stableTokenBalance: "0",
    currentPrice: "0",
    priceTimestamp: 0,
    isPriceValid: false,
    totalValue: 0,
    collateralAmount: "0",
    tokens: [] as any[]
  };

  try {
    console.log("📊 获取用户数据...");
    
    // 获取 S Token 余额
    const stableBalance = await stableToken.balanceOf(walletAddress);
    userData.stableTokenBalance = ethers.formatUnits(stableBalance, 18);
    console.log(`💰 S Token 余额: ${userData.stableTokenBalance}`);

    // 获取当前价格
    try {
      const priceResult = await custodianFixed.getLatestPriceView();
      userData.currentPrice = ethers.formatUnits(priceResult[0], 18);
      userData.priceTimestamp = Number(priceResult[1]);
      userData.isPriceValid = priceResult[2];
      console.log(`📈 当前价格: $${userData.currentPrice} (${userData.isPriceValid ? '有效' : '无效'})`);
    } catch (e) {
      console.log("⚠️ 使用默认价格 $120");
      userData.currentPrice = "120";
    }

    // 获取抵押品信息
    try {
      const collateral = await custodianFixed.getUserCollateral(walletAddress);
      userData.collateralAmount = ethers.formatUnits(collateral, 18);
      console.log(`🏦 抵押品数量: ${userData.collateralAmount} WLTC`);
    } catch (e) {
      console.log("⚠️ 获取抵押品信息失败");
    }

    // 获取所有 L Token 信息
    try {
      console.log("🎯 获取 Leverage Token 信息...");
      const userTokenInfo = await custodianFixed.getAllLeverageTokenInfo(walletAddress);
      
      const tokenIds = userTokenInfo[0];
      const balances = userTokenInfo[1];
      const leverages = userTokenInfo[2];
      const mintPrices = userTokenInfo[3];
      const accruedInterests = userTokenInfo[4];

      console.log(`📦 找到 ${tokenIds.length} 个 Leverage Token`);

      for (let i = 0; i < tokenIds.length; i++) {
        const tokenId = tokenIds[i];
        const balance = balances[i];
        const leverage = leverages[i];
        const mintPrice = mintPrices[i];
        const accruedInterest = accruedInterests[i];

        console.log(`🔍 处理 Token ID ${tokenId}...`);

        try {
          // 获取详细信息
          const tokenDetails = await custodianFixed.getTokenDetails(tokenId);
          const tokenInfo = await leverageToken.getTokenInfo(tokenId);
          
          let navInfo = null;
          if (userData.isPriceValid) {
            try {
              navInfo = await custodianFixed.getSingleLeverageTokenNav(
                walletAddress,
                tokenId,
                ethers.parseUnits(userData.currentPrice, 18)
              );
            } catch (e) {
              console.log(`⚠️ Token ${tokenId} 净值计算失败`);
            }
          }

          const tokenData = {
            id: tokenId.toString(),
            balance: ethers.formatUnits(balance, 18),
            leverage: Number(leverage),
            leverageText: getLeverageText(Number(leverage)),
            mintPrice: ethers.formatUnits(mintPrice, 18),
            accruedInterest: ethers.formatUnits(accruedInterest, 18),
            creationTime: Number(tokenDetails[2]),
            isStatic: tokenDetails[4],
            tokenName: tokenInfo[3] || `Leverage Token #${tokenId}`,
            tokenSymbol: tokenInfo[4] || `LT${tokenId}`,
            // 净值信息
            grossNav: navInfo ? ethers.formatUnits(navInfo[1], 18) : "1.0",
            netNav: navInfo ? ethers.formatUnits(navInfo[2], 18) : "1.0",
            totalValue: navInfo ? ethers.formatUnits(navInfo[3], 18) : ethers.formatUnits(balance, 18),
            netValue: navInfo ? ethers.formatUnits(navInfo[4], 18) : ethers.formatUnits(balance, 18),
            // UI 属性
            leverageColor: getLeverageColor(Number(leverage)),
            leverageBadge: getLeverageBadge(Number(leverage)),
            pnlPercent: navInfo ? ((parseFloat(ethers.formatUnits(navInfo[1], 18)) - 1.0) * 100).toFixed(2) : "0.00",
            imageUrl: `${IPFS_BASE_URI}${tokenId}.json`, // 🔧 修复：使用传入的参数
            rarity: getTokenRarity(Number(tokenId), tokenDetails[4])
          };

          userData.tokens.push(tokenData);
          if (navInfo) {
            userData.totalValue += parseFloat(tokenData.totalValue);
          } else {
            userData.totalValue += parseFloat(tokenData.balance);
          }

          console.log(`✅ Token ${tokenId} 处理完成 - 余额: ${tokenData.balance}, 杠杆: ${tokenData.leverageText}`);

        } catch (tokenError: any) {
          console.log(`⚠️ Token ${tokenId} 信息获取失败:`, tokenError.message);
          
          // 🔧 添加备用数据，避免完全失败
          const fallbackTokenData = {
            id: tokenId.toString(),
            balance: ethers.formatUnits(balance, 18),
            leverage: Number(leverage),
            leverageText: getLeverageText(Number(leverage)),
            mintPrice: ethers.formatUnits(mintPrice, 18),
            accruedInterest: ethers.formatUnits(accruedInterest, 18),
            creationTime: Date.now() / 1000,
            isStatic: Number(tokenId) <= 9,
            tokenName: `Leverage Token #${tokenId}`,
            tokenSymbol: `LT${tokenId}`,
            grossNav: "1.0",
            netNav: "1.0", 
            totalValue: ethers.formatUnits(balance, 18),
            netValue: ethers.formatUnits(balance, 18),
            leverageColor: getLeverageColor(Number(leverage)),
            leverageBadge: getLeverageBadge(Number(leverage)),
            pnlPercent: "0.00",
            imageUrl: `${IPFS_BASE_URI}${tokenId}.json`,
            rarity: getTokenRarity(Number(tokenId), Number(tokenId) <= 9),
            hasError: true
          };

          userData.tokens.push(fallbackTokenData);
          userData.totalValue += parseFloat(fallbackTokenData.balance);
        }
      }

    } catch (tokenInfoError: any) {
      console.log("⚠️ 使用备用方案查询静态 Token...");
      
      // 备用方案：查询静态 Token 1-9
      for (let tokenId = 1; tokenId <= 9; tokenId++) {
        try {
          const balance = await leverageToken.balanceOf(walletAddress, tokenId);
          if (balance > 0n) {
            console.log(`📦 发现静态 Token ${tokenId}, 余额: ${ethers.formatUnits(balance, 18)}`);
            
            const tokenInfo = await leverageToken.getTokenInfo(tokenId);
            
            const tokenData = {
              id: tokenId.toString(),
              balance: ethers.formatUnits(balance, 18),
              leverage: Number(tokenInfo[0]),
              leverageText: getLeverageText(Number(tokenInfo[0])),
              mintPrice: ethers.formatUnits(tokenInfo[1], 18),
              accruedInterest: "0",
              creationTime: Number(tokenInfo[2]),
              isStatic: tokenInfo[4],
              tokenName: tokenInfo[3] || `Static Leverage Token #${tokenId}`,
              tokenSymbol: tokenInfo[4] || `SLT${tokenId}`,
              grossNav: "1.0",
              netNav: "1.0", 
              totalValue: ethers.formatUnits(balance, 18),
              netValue: ethers.formatUnits(balance, 18),
              leverageColor: getLeverageColor(Number(tokenInfo[0])),
              leverageBadge: getLeverageBadge(Number(tokenInfo[0])),
              pnlPercent: "0.00",
              imageUrl: `${IPFS_BASE_URI}${tokenId}.json`, // 🔧 修复：使用传入的参数
              rarity: getTokenRarity(tokenId, true),
              isBackup: true
            };

            userData.tokens.push(tokenData);
            userData.totalValue += parseFloat(tokenData.balance);
          }
        } catch (e) {
          // 静默忽略错误
        }
      }
    }

    console.log(`📊 数据获取完成 - 找到 ${userData.tokens.length} 个 Token, 总价值: $${userData.totalValue.toFixed(2)}`);

  } catch (error: any) {
    console.error("获取用户数据失败:", error.message);
  }

  return userData;
}

function getLeverageText(leverage: number): string {
  switch (leverage) {
    case 0: return "CONSERVATIVE";
    case 1: return "MODERATE";
    case 2: return "AGGRESSIVE";
    default: return "UNKNOWN";
  }
}

function getLeverageColor(leverage: number): string {
  switch (leverage) {
    case 0: return "#28a745"; // 绿色
    case 1: return "#ffc107"; // 黄色
    case 2: return "#dc3545"; // 红色
    default: return "#6c757d"; // 灰色
  }
}

function getLeverageBadge(leverage: number): string {
  switch (leverage) {
    case 0: return "🟢 CONSERVATIVE";
    case 1: return "🟡 MODERATE";
    case 2: return "🔴 AGGRESSIVE";
    default: return "⚪ UNKNOWN";
  }
}

function getTokenRarity(tokenId: number, isStatic: boolean): string {
  if (isStatic) {
    if (tokenId <= 3) return "LEGENDARY";
    if (tokenId <= 6) return "EPIC";
    return "RARE";
  } else {
    if (tokenId < 20) return "RARE";
    if (tokenId < 50) return "UNCOMMON";
    return "COMMON";
  }
}

function generateHTML(userData: any, walletAddress: string, contractAddress: string, ipfsBaseUri: string): string {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎯 Leverage Token NFT Collection</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }

        .header {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-bottom: 1px solid rgba(255, 255, 255, 0.2);
            padding: 20px 0;
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .header-content {
            max-width: 1400px;
            margin: 0 auto;
            padding: 0 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 20px;
        }

        .logo {
            font-size: 28px;
            font-weight: bold;
            background: linear-gradient(135deg, #667eea, #764ba2);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .wallet-info {
            display: flex;
            align-items: center;
            gap: 15px;
            background: rgba(102, 126, 234, 0.1);
            padding: 10px 20px;
            border-radius: 20px;
            border: 1px solid rgba(102, 126, 234, 0.2);
        }

        .wallet-address {
            font-family: 'Courier New', monospace;
            font-size: 14px;
            color: #666;
            word-break: break-all;
        }

        .stats-bar {
            background: rgba(255, 255, 255, 0.9);
            padding: 20px;
            margin: 20px;
            border-radius: 15px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            max-width: 1400px;
            margin: 0 auto;
        }

        .stat-card {
            text-align: center;
            padding: 15px;
            background: white;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }

        .stat-value {
            font-size: 24px;
            font-weight: bold;
            color: #667eea;
        }

        .stat-label {
            color: #666;
            margin-top: 5px;
            font-size: 14px;
        }

        .main-content {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }

        .section-title {
            font-size: 28px;
            font-weight: bold;
            margin: 40px 0 30px 0;
            text-align: center;
            color: white;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        }

        .nft-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 25px;
            margin: 30px 0;
        }

        .nft-card {
            background: white;
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            position: relative;
            opacity: 0;
            animation: fadeInUp 0.6s ease forwards;
        }

        .nft-card:hover {
            transform: translateY(-10px);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        }

        .nft-card.error {
            border: 2px solid #ffc107;
        }

        .nft-card.backup {
            border: 2px solid #17a2b8;
        }

        .nft-image {
            height: 250px;
            background: linear-gradient(135deg, var(--leverage-color), rgba(255, 255, 255, 0.2));
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            overflow: hidden;
        }

        .nft-image::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="0.5"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)" /></svg>');
        }

        .nft-icon {
            font-size: 80px;
            z-index: 1;
            position: relative;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
        }

        .nft-content {
            padding: 25px;
        }

        .nft-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 20px;
        }

        .nft-title {
            font-size: 20px;
            font-weight: bold;
            color: #333;
            margin-bottom: 5px;
        }

        .nft-id {
            font-size: 14px;
            color: #666;
            font-family: 'Courier New', monospace;
        }

        .badges {
            display: flex;
            flex-direction: column;
            gap: 8px;
            align-items: flex-end;
        }

        .badge {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 500;
        }

        .leverage-badge {
            color: white;
            background: var(--leverage-color);
        }

        .type-badge {
            background: #e3f2fd;
            color: #1976d2;
        }

        .rarity-badge {
            background: #fff3e0;
            color: #f57c00;
        }

        .error-badge {
            background: #fff3cd;
            color: #856404;
        }

        .backup-badge {
            background: #d1ecf1;
            color: #0c5460;
        }

        .nft-stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            margin: 20px 0;
        }

        .stat-item {
            text-align: center;
            padding: 12px;
            background: #f8f9fa;
            border-radius: 10px;
        }

        .stat-item-label {
            font-size: 12px;
            color: #666;
            margin-bottom: 5px;
        }

        .stat-item-value {
            font-weight: bold;
            color: #333;
        }

        .performance {
            margin: 20px 0;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 10px;
            text-align: center;
        }

        .performance-value {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 5px;
        }

        .performance-label {
            font-size: 12px;
            color: #666;
        }

        .positive { color: #28a745; }
        .negative { color: #dc3545; }
        .neutral { color: #6c757d; }

        .nft-details {
            display: grid;
            grid-template-columns: 1fr;
            gap: 5px;
            font-size: 14px;
        }

        .detail-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #f0f0f0;
        }

        .detail-label {
            color: #666;
        }

        .detail-value {
            font-weight: 500;
            color: #333;
        }

        .empty-state {
            text-align: center;
            padding: 80px 20px;
            color: white;
        }

        .empty-icon {
            font-size: 120px;
            margin-bottom: 30px;
            opacity: 0.8;
        }

        .empty-title {
            font-size: 32px;
            margin-bottom: 15px;
            font-weight: bold;
        }

        .empty-description {
            font-size: 18px;
            opacity: 0.9;
            margin-bottom: 30px;
        }

        .price-info {
            background: rgba(255, 255, 255, 0.9);
            padding: 15px;
            margin: 20px;
            border-radius: 10px;
            text-align: center;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
        }

        .current-price {
            font-size: 24px;
            font-weight: bold;
            color: #667eea;
            margin-bottom: 5px;
        }

        .price-timestamp {
            font-size: 12px;
            color: #666;
        }

        .refresh-button {
            position: fixed;
            bottom: 30px;
            right: 30px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 50%;
            width: 60px;
            height: 60px;
            font-size: 24px;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
            transition: transform 0.2s ease;
        }

        .refresh-button:hover {
            transform: scale(1.1);
        }

        .filters {
            display: flex;
            justify-content: center;
            gap: 15px;
            margin: 30px 0;
            flex-wrap: wrap;
        }

        .filter-button {
            padding: 10px 20px;
            border: 2px solid white;
            background: transparent;
            color: white;
            border-radius: 25px;
            cursor: pointer;
            transition: all 0.2s ease;
            font-weight: 500;
        }

        .filter-button:hover,
        .filter-button.active {
            background: white;
            color: #667eea;
        }

        @media (max-width: 768px) {
            .nft-grid {
                grid-template-columns: 1fr;
                gap: 20px;
            }
            
            .header-content {
                flex-direction: column;
                text-align: center;
            }
            
            .stats-grid {
                grid-template-columns: 1fr 1fr;
            }
            
            .nft-stats {
                grid-template-columns: 1fr;
            }
        }

        @keyframes fadeInUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); }
        }
    </style>
</head>
<body>
    <header class="header">
        <div class="header-content">
            <div class="logo">🎯 Leverage Token Collection</div>
            <div class="wallet-info">
                <div>
                    <div style="font-size: 12px; color: #666;">钱包地址</div>
                    <div class="wallet-address">${walletAddress}</div>
                </div>
                <div>
                    <div style="font-size: 12px; color: #666;">网络</div>
                    <div style="font-weight: bold; color: #667eea;">Sepolia</div>
                </div>
            </div>
        </div>
    </header>

    <div class="stats-bar">
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${userData.tokens.length}</div>
                <div class="stat-label">NFT 数量</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">$${userData.totalValue.toFixed(2)}</div>
                <div class="stat-label">总价值</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${parseFloat(userData.stableTokenBalance).toFixed(2)}</div>
                <div class="stat-label">S Token</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${parseFloat(userData.collateralAmount).toFixed(2)}</div>
                <div class="stat-label">WLTC 抵押</div>
            </div>
        </div>
    </div>

    ${userData.isPriceValid ? `
    <div class="price-info">
        <div class="current-price">LTC 价格: $${userData.currentPrice}</div>
        <div class="price-timestamp">更新时间: ${new Date(userData.priceTimestamp * 1000).toLocaleString()}</div>
    </div>
    ` : ''}

    <main class="main-content">
        <h2 class="section-title">🖼️ 我的 Leverage Token NFT 收藏</h2>
        
        <div class="filters">
            <button class="filter-button active" onclick="filterTokens('all')">全部</button>
            <button class="filter-button" onclick="filterTokens('conservative')">🟢 保守型</button>
            <button class="filter-button" onclick="filterTokens('moderate')">🟡 适中型</button>
            <button class="filter-button" onclick="filterTokens('aggressive')">🔴 激进型</button>
            <button class="filter-button" onclick="filterTokens('static')">静态</button>
            <button class="filter-button" onclick="filterTokens('dynamic')">动态</button>
        </div>

        ${userData.tokens.length === 0 ? `
        <div class="empty-state">
            <div class="empty-icon">🎨</div>
            <div class="empty-title">还没有 Leverage Token NFT</div>
            <div class="empty-description">开始你的 DeFi 杠杆投资之旅，铸造你的第一个 NFT！</div>
            <div style="background: rgba(255, 255, 255, 0.1); padding: 20px; border-radius: 10px; margin: 20px 0; font-family: 'Courier New', monospace; font-size: 14px;">
                npx hardhat run scripts/utilities/mint_SLtoken.ts --network sepolia
            </div>
        </div>
        ` : `
        <div class="nft-grid" id="nftGrid">
            ${userData.tokens.map((token: any, index: number) => `
            <div class="nft-card ${token.hasError ? 'error' : ''} ${token.isBackup ? 'backup' : ''}" 
                 style="--leverage-color: ${token.leverageColor}; animation-delay: ${index * 0.1}s;" 
                 data-leverage="${token.leverage}" 
                 data-type="${token.isStatic ? 'static' : 'dynamic'}">
                <div class="nft-image">
                    <div class="nft-icon">${token.leverage === 0 ? '🛡️' : token.leverage === 1 ? '⚖️' : '🚀'}</div>
                </div>
                
                <div class="nft-content">
                    <div class="nft-header">
                        <div>
                            <div class="nft-title">${token.tokenName}</div>
                            <div class="nft-id">Token ID: #${token.id}</div>
                        </div>
                        <div class="badges">
                            <span class="badge leverage-badge">${token.leverageBadge}</span>
                            <span class="badge type-badge">${token.isStatic ? '静态' : '动态'}</span>
                            <span class="badge rarity-badge">${token.rarity}</span>
                            ${token.hasError ? '<span class="badge error-badge">数据错误</span>' : ''}
                            ${token.isBackup ? '<span class="badge backup-badge">备用数据</span>' : ''}
                        </div>
                    </div>

                    <div class="performance">
                        <div class="performance-value ${parseFloat(token.pnlPercent) >= 0 ? 'positive' : parseFloat(token.pnlPercent) < 0 ? 'negative' : 'neutral'}">
                            ${parseFloat(token.pnlPercent) >= 0 ? '+' : ''}${token.pnlPercent}%
                        </div>
                        <div class="performance-label">收益率</div>
                    </div>

                    <div class="nft-stats">
                        <div class="stat-item">
                            <div class="stat-item-label">持仓数量</div>
                            <div class="stat-item-value">${parseFloat(token.balance).toFixed(2)}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-item-label">当前净值</div>
                            <div class="stat-item-value">${parseFloat(token.grossNav).toFixed(4)}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-item-label">总价值</div>
                            <div class="stat-item-value">$${parseFloat(token.totalValue).toFixed(2)}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-item-label">净价值</div>
                            <div class="stat-item-value">$${parseFloat(token.netValue).toFixed(2)}</div>
                        </div>
                    </div>

                    <div class="nft-details">
                        <div class="detail-row">
                            <span class="detail-label">铸币价格:</span>
                            <span class="detail-value">$${parseFloat(token.mintPrice).toFixed(2)}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">累积利息:</span>
                            <span class="detail-value">${parseFloat(token.accruedInterest).toFixed(4)}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">创建时间:</span>
                            <span class="detail-value">${new Date(token.creationTime * 1000).toLocaleDateString()}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">杠杆比例:</span>
                            <span class="detail-value">${token.leverage === 0 ? '1:8' : token.leverage === 1 ? '1:4' : '1:1'}</span>
                        </div>
                        <div class="detail-row">
                            <span class="detail-label">IPFS URI:</span>
                            <span class="detail-value">
                                <a href="https://ipfs.io/ipfs/bafybeib5e4rylv4rfvy7afaoevomygulwp7oxgp4rzcjexcgnrbw34cgfm/${token.id}.json" target="_blank" style="color: #667eea; text-decoration: none;">
                                    查看元数据
                                </a>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
            `).join('')}
        </div>
        `}
    </main>

    <button class="refresh-button" onclick="location.reload()" title="刷新数据">
        🔄
    </button>

    <script>
        function filterTokens(filter) {
            const cards = document.querySelectorAll('.nft-card');
            const buttons = document.querySelectorAll('.filter-button');
            
            // 更新按钮状态
            buttons.forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            
            // 过滤卡片
            cards.forEach(card => {
                let show = false;
                
                switch(filter) {
                    case 'all':
                        show = true;
                        break;
                    case 'conservative':
                        show = card.dataset.leverage === '0';
                        break;
                    case 'moderate':
                        show = card.dataset.leverage === '1';
                        break;
                    case 'aggressive':
                        show = card.dataset.leverage === '2';
                        break;
                    case 'static':
                        show = card.dataset.type === 'static';
                        break;
                    case 'dynamic':
                        show = card.dataset.type === 'dynamic';
                        break;
                }
                
                card.style.display = show ? 'block' : 'none';
            });
        }

        // 初始化
        document.addEventListener('DOMContentLoaded', function() {
            console.log('🎯 Leverage Token NFT Browser 已加载');
            console.log('📊 找到 ${userData.tokens.length} 个 NFT');
            console.log('💰 总价值: $${userData.totalValue.toFixed(2)}');
            console.log('🔗 IPFS 基础 URI: ${ipfsBaseUri}');
            
            // 复制钱包地址功能
            const walletAddress = document.querySelector('.wallet-address');
            if (walletAddress) {
                walletAddress.addEventListener('click', function() {
                    navigator.clipboard.writeText('${walletAddress}').then(function() {
                        walletAddress.style.background = '#d4edda';
                        setTimeout(() => {
                            walletAddress.style.background = '';
                        }, 1000);
                    });
                });
                walletAddress.style.cursor = 'pointer';
                walletAddress.title = '点击复制地址';
            }
        });
    </script>
</body>
</html>
  `;
}

generateNFTBrowser()
  .then(() => {
    console.log("\n🎉 NFT 浏览器生成完成!");
    process.exit(0);
  })
  .catch((error: Error) => {
    console.error("\n💥 生成失败:", error);
    process.exit(1);
  });