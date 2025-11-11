import hre from "hardhat";

async function diagnoseNewCustodian(): Promise<void> {
  console.log("🔍 诊断新部署的 CustodianFixed 合约...");
  
  const ethers = (hre as any).ethers;
  const NEW_CUSTODIAN_ADDRESS = "0x9Fb49EfD7dC50068eb19Cc7E4ac9cA77bCe9114A";
  
  // 预期的构造函数参数
  const UNDERLYING_TOKEN = "0x9DFF6745444c05bbEc03bF59C0910731C02950dd"; // WLTC
  const STABLE_TOKEN = "0xc737f2b19790120032327F7c6fCF886DA9ed672f";     // S Token
  const LEVERAGE_TOKEN = "0x89106De21Be816F3823b7011C91569C27Cf8C18a";   // L Token
  
  try {
    console.log("📋 新合约信息:");
    console.log("   地址:", NEW_CUSTODIAN_ADDRESS);
    console.log("   预期参数顺序: underlyingToken, stableToken, leverageToken");
    
    const custodianABI = [
      "function owner() view returns (address)",
      "function mint(uint256 underlyingAmountInWei, uint256 mintPriceInWei, uint8 leverageLevel) external",
      "function stableToken() view returns (address)",
      "function leverageToken() view returns (address)", 
      "function underlyingToken() view returns (address)",
      "function ltcPriceOracle() view returns (address)",
      "function currentState() view returns (uint8)",
      "function setState(uint8) external",
      "function initializeSystem(address, address, address) external",
      "function getLatestPrice() view returns (uint256, uint256, bool)",
      "function getLatestPriceView() view returns (uint256, uint256, bool)",
      "function isInitialized() view returns (bool)",
      "function interestManager() view returns (address)"
    ];
    
    const custodian = new ethers.Contract(NEW_CUSTODIAN_ADDRESS, custodianABI, ethers.provider);
    const [signer] = await ethers.getSigners();
    const custodianWithSigner = custodian.connect(signer);
    
    console.log("\n🔬 系统性诊断:");
    console.log("=".repeat(60));
    
    // 1. 基本信息验证
    console.log("1️⃣ 基本信息验证:");
    const owner = await custodian.owner();
    console.log("   Owner:", owner);
    console.log("   当前账户:", signer.address);
    console.log("   是否为 Owner:", owner.toLowerCase() === signer.address.toLowerCase());
    
    // 2. 构造函数参数验证
    console.log("\n2️⃣ 构造函数参数验证:");
    try {
      const actualUnderlyingToken = await custodian.underlyingToken();
      const actualStableToken = await custodian.stableToken();
      const actualLeverageToken = await custodian.leverageToken();
      
      console.log("   实际参数:");
      console.log("     Underlying Token:", actualUnderlyingToken);
      console.log("     Stable Token:", actualStableToken);
      console.log("     Leverage Token:", actualLeverageToken);
      
      console.log("   期望参数:");
      console.log("     Underlying Token:", UNDERLYING_TOKEN);
      console.log("     Stable Token:", STABLE_TOKEN);
      console.log("     Leverage Token:", LEVERAGE_TOKEN);
      
      const paramsMatch = 
        actualUnderlyingToken.toLowerCase() === UNDERLYING_TOKEN.toLowerCase() &&
        actualStableToken.toLowerCase() === STABLE_TOKEN.toLowerCase() &&
        actualLeverageToken.toLowerCase() === LEVERAGE_TOKEN.toLowerCase();
        
      console.log("   参数匹配:", paramsMatch ? "✅" : "❌");
      
      if (!paramsMatch) {
        console.log("   ⚠️ 参数不匹配，可能影响合约功能！");
      }
      
    } catch (error: any) {
      console.log("   ❌ 参数验证失败:", error.message);
    }
    
    // 3. 合约状态检查
    console.log("\n3️⃣ 合约状态检查:");
    try {
      const currentState = await custodian.currentState();
      const stateNames = ['Inception', 'Trading', 'PreReset', 'Reset', 'Matured'];
      
      console.log(`   当前状态: ${currentState} (${stateNames[currentState] || 'Unknown'})`);
      
      if (currentState !== 1) {
        console.log("   ❌ 不在 Trading 状态，需要设置状态！");
        
        // 尝试设置状态
        if (owner.toLowerCase() === signer.address.toLowerCase()) {
          console.log("   🔧 尝试设置为 Trading 状态...");
          try {
            const setStateTx = await custodianWithSigner.setState(1);
            await setStateTx.wait();
            
            const newState = await custodian.currentState();
            console.log(`   ✅ 状态更新成功: ${newState}`);
          } catch (setError: any) {
            console.log("   ❌ 状态设置失败:", setError.message);
          }
        } else {
          console.log("   ⚠️ 需要 Owner 权限设置状态");
        }
      } else {
        console.log("   ✅ 合约在正确的 Trading 状态");
      }
      
    } catch (error: any) {
      console.log("   ❌ 状态检查失败:", error.message);
    }
    
    // 4. 系统初始化检查
    console.log("\n4️⃣ 系统初始化检查:");
    try {
      // 检查是否有 Oracle 设置
      let oracle = null;
      try {
        oracle = await custodian.ltcPriceOracle();
        console.log("   Oracle 地址:", oracle);
        
        if (oracle === "0x0000000000000000000000000000000000000000") {
          console.log("   ❌ Oracle 未设置！");
        } else {
          console.log("   ✅ Oracle 已设置");
        }
      } catch (error: any) {
        console.log("   ⚠️ 无法获取 Oracle 地址");
      }
      
      // 检查 Interest Manager
      try {
        const interestManager = await custodian.interestManager();
        console.log("   Interest Manager:", interestManager);
        
        if (interestManager === "0x0000000000000000000000000000000000000000") {
          console.log("   ❌ Interest Manager 未设置！");
        } else {
          console.log("   ✅ Interest Manager 已设置");
        }
      } catch (error: any) {
        console.log("   ⚠️ 无法获取 Interest Manager");
      }
      
      // 如果系统未初始化，尝试初始化
      if (oracle === "0x0000000000000000000000000000000000000000") {
        console.log("   🔧 系统需要初始化...");
        
        if (owner.toLowerCase() === signer.address.toLowerCase()) {
          console.log("   📝 尝试初始化系统...");
          
          const ORACLE_ADDRESS = "0x0A0a35875bd2A7087D50c56A83D2571A50224eE5";
          const INTEREST_MANAGER = "0x你的InterestManager地址"; // 需要部署
          const FEE_COLLECTOR = signer.address; // 临时使用 Owner 作为手续费收集者
          
          try {
            const initTx = await custodianWithSigner.initializeSystem(
              INTEREST_MANAGER,
              ORACLE_ADDRESS,
              FEE_COLLECTOR
            );
            await initTx.wait();
            console.log("   ✅ 系统初始化成功");
          } catch (initError: any) {
            console.log("   ❌ 系统初始化失败:", initError.message);
            console.log("   💡 可能需要先部署 InterestManager 合约");
          }
        }
      }
      
    } catch (error: any) {
      console.log("   ❌ 初始化检查失败:", error.message);
    }
    
    // 5. Oracle 价格检查
    console.log("\n5️⃣ Oracle 价格检查:");
    const priceFunctions = ['getLatestPrice', 'getLatestPriceView'];
    
    for (const funcName of priceFunctions) {
      try {
        const priceResult = await custodian[funcName]();
        console.log(`   ✅ ${funcName}():`);
        console.log(`      价格: $${ethers.formatUnits(priceResult[0], 18)}`);
        console.log(`      时间: ${new Date(Number(priceResult[1]) * 1000).toLocaleString()}`);
        console.log(`      有效: ${priceResult[2]}`);
        
        if (!priceResult[2]) {
          console.log("   ⚠️ 价格无效或过期！");
        }
        break;
      } catch (error: any) {
        console.log(`   ❌ ${funcName}(): ${error.message}`);
      }
    }
    
    // 6. 用户 WLTC 检查
    console.log("\n6️⃣ 用户 WLTC 检查:");
    try {
      const wltcToken = new ethers.Contract(
        UNDERLYING_TOKEN,
        [
          "function balanceOf(address) view returns (uint256)", 
          "function allowance(address,address) view returns (uint256)",
          "function approve(address,uint256) external returns (bool)"
        ],
        ethers.provider
      );
      
      const balance = await wltcToken.balanceOf(signer.address);
      const allowance = await wltcToken.allowance(signer.address, NEW_CUSTODIAN_ADDRESS);
      
      console.log(`   用户 WLTC 余额: ${ethers.formatUnits(balance, 18)}`);
      console.log(`   授权给 Custodian: ${ethers.formatUnits(allowance, 18)}`);
      
      const requiredAmount = ethers.parseUnits("1", 18);
      const balanceOk = balance >= requiredAmount;
      const allowanceOk = allowance >= requiredAmount;
      
      console.log(`   余额充足 (>=1): ${balanceOk ? '✅' : '❌'}`);
      console.log(`   授权充足 (>=1): ${allowanceOk ? '✅' : '❌'}`);
      
      // 如果需要授权
      if (!allowanceOk && balanceOk) {
        console.log("   🔧 需要授权 WLTC...");
        try {
          const wltcWithSigner = wltcToken.connect(signer);
          const approveTx = await wltcWithSigner.approve(NEW_CUSTODIAN_ADDRESS, ethers.parseUnits("1000000", 18));
          await approveTx.wait();
          console.log("   ✅ WLTC 授权成功");
        } catch (approveError: any) {
          console.log("   ❌ WLTC 授权失败:", approveError.message);
        }
      }
      
    } catch (error: any) {
      console.log("   ❌ WLTC 检查失败:", error.message);
    }
    
    // 7. 最终 Gas 估算测试
    console.log("\n7️⃣ 最终 Gas 估算测试:");
    try {
      const underlyingAmount = ethers.parseUnits("1", 18);
      const mintPrice = ethers.parseUnits("120", 18);
      const leverageLevel = 1;
      
      console.log("   测试参数:");
      console.log(`     数量: ${ethers.formatUnits(underlyingAmount, 18)} WLTC`);
      console.log(`     价格: $${ethers.formatUnits(mintPrice, 18)}`);
      console.log(`     杠杆: ${leverageLevel} (MODERATE)`);
      
      const gasEstimate = await custodianWithSigner.mint.estimateGas(
        underlyingAmount,
        mintPrice,
        leverageLevel
      );
      
      console.log(`   ✅ Gas 估算: ${gasEstimate.toString()}`);
      
      if (gasEstimate <= 5000000n) {
        console.log("   ✅ Gas 正常，可以在 Etherscan 上执行");
      } else {
        console.log("   ❌ Gas 仍然过高，存在其他问题");
      }
      
    } catch (gasError: any) {
      console.log("   ❌ Gas 估算失败:", gasError.message);
      
      // 分析具体错误
      if (gasError.message.includes("Invalid state")) {
        console.log("   🔧 错误原因: 合约状态问题");
      } else if (gasError.message.includes("ERC20: insufficient allowance")) {
        console.log("   🔧 错误原因: WLTC 授权不足");
      } else if (gasError.message.includes("Oracle")) {
        console.log("   🔧 错误原因: Oracle 相关问题");
      } else {
        console.log("   🔧 错误原因: 其他合约逻辑问题");
      }
    }
    
    // 8. 总结和建议
    console.log("\n8️⃣ 诊断总结:");
    console.log("=".repeat(60));
    console.log("📋 在 Etherscan 上测试 mint 的步骤:");
    console.log("1. 确保连接正确的钱包 (Owner 账户)");
    console.log("2. 找到 mint 函数 (3个参数)");
    console.log("3. 输入参数:");
    console.log("   underlyingAmountInWei: 1000000000000000000");
    console.log("   mintPriceInWei: 120000000000000000000"); 
    console.log("   leverageLevel: 1");
    console.log("4. 检查 Gas Limit 设置 (建议 2,000,000)");
    
    console.log("\n🌐 Etherscan 链接:");
    console.log(`   合约地址: https://sepolia.etherscan.io/address/${NEW_CUSTODIAN_ADDRESS}#writeContract`);
    
  } catch (error: any) {
    console.error("❌ 诊断失败:", error.message);
  }
}

diagnoseNewCustodian()
  .then(() => process.exit(0))
  .catch(console.error);