import { network } from "hardhat";

async function main() {
  console.log("🚀 开始完整清算流程测试...");

  // 连接到网络
  const { ethers } = await network.connect();

  // 获取多个测试账户
  const [deployer, liquidatedUser, keeper, bidder1, bidder2] = await ethers.getSigners();
  console.log(`📝 测试账户:`);
  console.log(`  部署者: ${deployer.address}`);
  console.log(`  被清算用户: ${liquidatedUser.address}`);
  console.log(`  Keeper (发起拍卖): ${keeper.address}`);
  console.log(`  竞拍者1: ${bidder1.address}`);
  console.log(`  竞拍者2: ${bidder2.address}`);

  // 从部署信息获取合约地址
  const deploymentInfo = {
    wltc: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    stableToken: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    leverageToken: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    interestManager: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    priceOracle: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
    custodian: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
    linearDecrease: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
    auctionManager: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
    liquidationManager: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318"
  };

  console.log("\n📋 使用合约地址:");
  Object.entries(deploymentInfo).forEach(([name, address]) => {
    console.log(`  ${name}: ${address}`);
  });

  // 获取合约实例
  const wltc  = await ethers.getContractAt("WLTCMock", deploymentInfo.wltc);
  const stableToken = await ethers.getContractAt("StableToken", deploymentInfo.stableToken);
  const leverageToken = await ethers.getContractAt("MultiLeverageToken", deploymentInfo.leverageToken);
  const priceOracle = await ethers.getContractAt("LTCPriceOracle", deploymentInfo.priceOracle);
  const custodian = await ethers.getContractAt("CustodianFixed", deploymentInfo.custodian);
  const auctionManager = await ethers.getContractAt("DuchAuction", deploymentInfo.auctionManager);
  const liquidationManager = await ethers.getContractAt("Liquidation", deploymentInfo.liquidationManager);

  console.log("\n✅ 合约实例化完成");

  // ==================== 测试1: 准备测试环境 ====================
  console.log("\n📦 测试1: 准备测试环境");

  // 1.1 给所有用户分配 WLTC
  console.log("  1.1 分配 WLTC 给所有用户...");
  const wltcAmount = ethers.parseEther("500");
  await wltc.mint(liquidatedUser.address, wltcAmount);
  await wltc.mint(keeper.address, wltcAmount);
  await wltc.mint(bidder1.address, wltcAmount);
  await wltc.mint(bidder2.address, wltcAmount);
  
  console.log(`    被清算用户 WLTC 余额: ${ethers.formatEther(await wltc.balanceOf(liquidatedUser.address))} WLTC ✅`);
  console.log(`    Keeper WLTC 余额: ${ethers.formatEther(await wltc.balanceOf(keeper.address))} WLTC ✅`);
  console.log(`    竞拍者1 WLTC 余额: ${ethers.formatEther(await wltc.balanceOf(bidder1.address))} WLTC ✅`);
  console.log(`    竞拍者2 WLTC 余额: ${ethers.formatEther(await wltc.balanceOf(bidder2.address))} WLTC ✅`);

  // 1.2 用户授权 Custodian 使用 WLTC
  console.log("  1.2 用户授权 Custodian 使用 WLTC...");
  await wltc.connect(liquidatedUser).approve(deploymentInfo.custodian, wltcAmount);
  await wltc.connect(keeper).approve(deploymentInfo.custodian, wltcAmount);
  await wltc.connect(bidder1).approve(deploymentInfo.custodian, wltcAmount);
  await wltc.connect(bidder2).approve(deploymentInfo.custodian, wltcAmount);
  console.log("    授权完成 ✅");

  // 1.3 给竞拍者铸造稳定币用于拍卖
  console.log("  1.3 给竞拍者稳定币用于拍卖...");
  const stableTokenAmount = ethers.parseEther("10000");
  
  // 使用部署者账户直接铸造稳定币给竞拍者
  console.log("    使用部署者账户铸造稳定币...");
  const wltcAmountForDeployer = ethers.parseEther("1000000");
  await wltc.mint(deployer.address, wltcAmountForDeployer );
  await wltc.connect(deployer).approve(deploymentInfo.custodian, wltcAmountForDeployer);
  await custodian.connect(deployer).mint(   wltcAmountForDeployer,
    ethers.parseEther("300"),
    1,)//设置mintprice高一点，防止被清算
  await stableToken.connect(deployer).transfer(bidder1.address, stableTokenAmount);
  await stableToken.connect(deployer).transfer(bidder2.address, stableTokenAmount);


  console.log(`    竞拍者1 S 代币余额: ${ethers.formatEther(await stableToken.balanceOf(bidder1.address))} S`);
  console.log(`    竞拍者2 S 代币余额: ${ethers.formatEther(await stableToken.balanceOf(bidder2.address))} S`);

  // 1.4 给custodian一部分稳定币用于支付奖励
  console.log("  1.4 给custodian一部分稳定币用于支付奖励...");
  const stableTokenAmountForCustodian = ethers.parseEther("1000000");
  await stableToken.connect(deployer).transfer(deploymentInfo.custodian, stableTokenAmountForCustodian);
  console.log(`    Custodian 稳定币余额: ${ethers.formatEther(await stableToken.balanceOf(deploymentInfo.custodian))} S`);


  // ==================== 测试2: 创建高风险代币 ====================
  console.log("\n📦 测试2: 创建高风险代币");

  // 2.1 设置高价格进行铸币
  console.log("  2.1 设置高价格进行铸币...");
  await priceOracle.updatePrice(ethers.parseEther("100"));
  console.log("    📝 设置预言机价格为 100 (铸币)");
  
  const underlyingAmount = ethers.parseEther("50");
  const mintPrice = ethers.parseEther("80");
  const leverageType = 1;

  console.log("  2.2 被清算用户执行铸币...");
  const mintTx = await custodian.connect(liquidatedUser).mint(
    underlyingAmount,
    mintPrice,
    leverageType,
  );
  await mintTx.wait();
  console.log("    铸币成功 ✅");

  // 2.3 检查铸币结果
  console.log("  2.3 检查铸币结果...");
  const userTokens = await custodian.getAllLeverageTokenInfo(liquidatedUser.address);
  console.log(`    被清算用户持有 L 代币数量: ${userTokens[0].length} 种`);

  if (userTokens[0].length > 0) {
    const tokenId = userTokens[0][0];
    console.log(`    L 代币 ID: ${tokenId}`);

    // 获取净值信息
    const navInfo = await custodian.getSingleLeverageTokenNavV2(liquidatedUser.address, tokenId);
    console.log(`    高价格下净值信息:`);
    console.log(`      总净值: ${ethers.formatEther(navInfo[1])}`);
    console.log(`      除息净值: ${ethers.formatEther(navInfo[2])}`);
    console.log(`      当前价格: ${ethers.formatEther(navInfo[6])}`);
  }

  // ==================== 测试3: 触发清算条件 ====================
  console.log("\n📦 测试3: 触发清算条件");

  if (userTokens[0].length > 0) {
    const tokenId = userTokens[0][0];

    // 3.1 设置极低价格来大幅降低净值
    console.log("  3.1 设置极低价格大幅降低净值...");
    await priceOracle.updatePrice(ethers.parseEther("30"));
    console.log("    📝 设置预言机价格为 30 (触发高风险)");

    // 3.2 获取极低价格下的净值
    console.log("  3.2 获取极低价格下净值信息...");
    const lowPriceNavInfo = await custodian.getSingleLeverageTokenNavV2(liquidatedUser.address, tokenId);
    console.log(`    极低价格下净值信息:`);
    console.log(`      总净值: ${ethers.formatEther(lowPriceNavInfo[1])}`);
    console.log(`      除息净值: ${ethers.formatEther(lowPriceNavInfo[2])}`);
    console.log(`      当前价格: ${ethers.formatEther(lowPriceNavInfo[6])}`);


    // 3.3 检查风险等级
    console.log("  3.3 检查风险等级...");
    const userStatus = await liquidationManager.userLiquidationStatus(liquidatedUser.address, tokenId);
    console.log(`    当前风险等级: ${userStatus.riskLevel}`);
    console.log(`    冻结状态: ${userStatus.isFreezed ?  "✅" : "❌"}`);
    console.log(`    清算中: ${userStatus.isUnderLiquidation ? "✅" : "❌"}`);

    // 3.4 手动更新风险等级
    console.log("  3.4 手动更新风险等级...");
    await liquidationManager.updateAllTokensRiskLevel(liquidatedUser.address) //更新风险等级


    // 3.5 再次检查风险等级
    const updatedStatus = await liquidationManager.userLiquidationStatus(liquidatedUser.address, tokenId);
    console.log(`    最终风险等级: ${updatedStatus.riskLevel}`);
  }

  // ==================== 测试4: 发起清算 ====================
  console.log("\n📦 测试4: 发起清算");

  if (userTokens[0].length > 0) {
    const tokenId = userTokens[0][0];
    const userStatus = await liquidationManager.userLiquidationStatus(liquidatedUser.address, tokenId);
    
    console.log(`    当前风险等级: ${userStatus.riskLevel}`);
    
    // 其实这里风险等级即使不是4，keeper也可以调用bark清算，bark内置清算判断逻辑，以应对风险等级没有及时更新的情况。
    // keeper 一般链下计算净值，发现需要被清算的用户，立即调用bark。 
    if (userStatus.riskLevel == 4) {
      console.log("  4.1 Keeper 发起清算...");
      
      // 获取清算前的余额
      const beforeBalance = await leverageToken.balanceOfInWei(liquidatedUser.address, tokenId);
      console.log(`    清算前 L 代币余额: ${ethers.formatEther(beforeBalance)}`);
      
      try {
        // Keeper 发起清算
        console.log("    Keeper调用bark函数");
        const barkTx = await liquidationManager.connect(keeper).bark(
          liquidatedUser.address,
          tokenId,
          keeper.address
        );
        
        const receipt = await barkTx.wait();
        console.log("    📝 清算交易已发送");
        
        // 查找清算事件 - 改进的事件查找逻辑
        console.log("    查找 AuctionStarted 事件...");
        let auctionEvent = null;
        
        // 方法1: 使用 fragment 查找
        auctionEvent = receipt.logs.find(log => 
          log.fragment && log.fragment.name === "AuctionStarted"
        );
        
        // 方法2: 如果方法1失败，尝试通过事件签名查找
        if (!auctionEvent) {
          console.log("    方法1失败，尝试方法2...");
          const auctionManagerInterface = auctionManager.interface;
          const auctionStartedTopic = auctionManagerInterface.getEvent("AuctionStarted").topicHash;
          auctionEvent = receipt.logs.find(log => 
            log.topics && log.topics[0] === auctionStartedTopic
          );
        }
        
        
        if (auctionEvent) {
          console.log("    ✅ 找到 AuctionStarted 事件");
          console.log(`    事件类型: ${typeof auctionEvent}`);
          
          // 调试信息：显示事件对象结构
          console.log("    事件对象结构:");
          console.log(`      fragment: ${auctionEvent.fragment ? '存在' : '不存在'}`);
          console.log(`      args: ${auctionEvent.args ? '存在' : '不存在'}`);
          console.log(`      data: ${auctionEvent.data ? '存在' : '不存在'}`);
          console.log(`      topics: ${auctionEvent.topics ? `长度 ${auctionEvent.topics.length}` : '不存在'}`);
          
          let auctionId, startingPrice, underlyingAmount, originalOwner, tokenId, triggerer, rewardAmount;
          
          try {
            // 方法1: 尝试直接使用 args
            if (auctionEvent.args && Array.isArray(auctionEvent.args) && auctionEvent.args.length > 0) {
              console.log("    使用 args 解析...");
              [auctionId, startingPrice, underlyingAmount, originalOwner, tokenId, triggerer, rewardAmount] = auctionEvent.args;
            } 
            // 方法2: 尝试使用 fragment 解析
            else if (auctionEvent.fragment) {
              console.log("    使用 fragment 解析...");
              const parsed = auctionManager.interface.decodeEventLog(auctionEvent.fragment, auctionEvent.data, auctionEvent.topics);
              auctionId = parsed.auctionId;
              startingPrice = parsed.startingPrice;
              underlyingAmount = parsed.underlyinglAmount; // 注意：合约中是 underlyinglAmount
              originalOwner = parsed.originalOwner;
              tokenId = parsed.tokenId;
              triggerer = parsed.triggerer;
              rewardAmount = parsed.rewardAmount;
            }
            // 方法3: 尝试手动解析
            else {
              console.log("    使用手动解析...");
              const parsed = auctionManager.interface.parseLog(auctionEvent);
              auctionId = parsed.args.auctionId;
              startingPrice = parsed.args.startingPrice;
              underlyingAmount = parsed.args.underlyinglAmount; // 注意：合约中是 underlyinglAmount
              originalOwner = parsed.args.originalOwner;
              tokenId = parsed.args.tokenId;
              triggerer = parsed.args.triggerer;
              rewardAmount = parsed.args.rewardAmount;
            }
            
            console.log(`    📊 AuctionStarted 事件详情:`);
            console.log(`      拍卖 ID: ${auctionId}`);
            console.log(`      起始价格: ${ethers.formatEther(startingPrice)}`);
            console.log(`      拍卖underlying数量: ${ethers.formatEther(underlyingAmount)}`);
            console.log(`      被清算用户: ${originalOwner}`);
            console.log(`      Token ID: ${tokenId}`);
            console.log(`      Keeper: ${triggerer}`);
            console.log(`      奖励keeper: ${ethers.formatEther(rewardAmount)} S`);
            
          } catch (parseError) {
            console.log(`    ❌ 事件解析失败: ${parseError.message}`);
            console.log("    尝试原始数据解析...");
            
            // 如果所有方法都失败，显示原始数据
            console.log("    原始事件数据:");
            console.log(JSON.stringify(auctionEvent, null, 2));
          }
        } else {
          console.log("    ⚠️ 未找到 AuctionStarted 事件");
          console.log("    可能的原因:");
          console.log("      1. 拍卖未成功启动");
          console.log("      2. 事件签名不匹配");
          console.log("      3. 合约调用失败");
        }
        
        // 4.2 检查清算结果
        console.log("  4.2 检查清算结果...");
        
        // 检查token余额减少
        const afterBalance = await leverageToken.balanceOfInWei(liquidatedUser.address, tokenId);
        console.log(`    清算后 L 代币余额: ${ethers.formatEther(afterBalance)}`);
        
        // 检查用户状态
        const afterStatus = await liquidationManager.userLiquidationStatus(liquidatedUser.address, tokenId);
        console.log(`    清算后状态:`);
        console.log(`      冻结状态: ${afterStatus.isFreezed ?  "✅" : "❌"}`);
        console.log(`      清算中: ${afterStatus.isUnderLiquidation ?"✅" : "❌"}`);
        console.log(`      风险等级: ${afterStatus.riskLevel}`);
        console.log(`      拍卖 ID: ${afterStatus.auctionId}`);
        
        console.log("    清算成功 ✅");
        
      } catch (error) {
        console.log(`    ❌ 清算失败: ${error.message}`);
      }
    } else {
      console.log("    风险等级不为4，无需进行清算 ✅");
    }
  }

  // ==================== 测试5: 拍卖流程 ====================
  console.log("\n📦 测试5: 拍卖流程");

  if (userTokens[0].length > 0) {
    const tokenId = userTokens[0][0];
    const userStatus = await liquidationManager.userLiquidationStatus(liquidatedUser.address, tokenId);
    
    if (userStatus.isUnderLiquidation && userStatus.auctionId > 0) {
      const auctionId = userStatus.auctionId;
      console.log(`    拍卖 ID: ${auctionId}`);
      
      // 5.1 检查拍卖信息
      console.log("  5.1 检查拍卖信息...");
      try {
        const auctionInfo = await auctionManager.auctions(auctionId);
        const auctionStatus = await auctionManager.getAuctionStatus(auctionId);
        console.log(`    拍卖信息:`);
        console.log(`      剩余底层资产数量: ${ethers.formatEther(auctionInfo.underlyingAmount)} WLTC`);
        console.log(`      原所有者: ${auctionInfo.originalOwner}`);
        console.log(`      Token ID: ${auctionInfo.tokenId}`);
        console.log(`      开始时间: ${auctionInfo.startTime}`);
        console.log(`      当前价格: ${ethers.formatEther(auctionStatus[1])}`);
        console.log(`      是否需要被重置: ${auctionStatus[0]? "✅" : "❌"}`);

      } catch (error) {
        console.log(`    ⚠️ 获取拍卖信息失败: ${error.message}`);
      }

  // 5.2 竞拍者参与拍卖
  console.log("  5.2 竞拍者参与拍卖...");
  
  // 检查竞拍者稳定币余额
  console.log("    检查竞拍者稳定币余额...");
  const stableAmount = ethers.parseEther("1000");
  console.log(`    竞拍者1 S 代币余额: ${ethers.formatEther(await stableToken.balanceOf(bidder1.address))} S`);
  console.log(`    竞拍者2 S 代币余额: ${ethers.formatEther(await stableToken.balanceOf(bidder2.address))} S`);
      
      // 竞拍者授权拍卖合约使用稳定币
      console.log("    竞拍者授权custodian合约...");
      await stableToken.connect(bidder1).approve(deploymentInfo.custodian, stableAmount);
      await stableToken.connect(bidder2).approve(deploymentInfo.custodian, stableAmount);
      console.log("    授权完成 ✅");
      
      // 5.3 竞拍者1购买底层资产
      console.log("  5.3 竞拍者1购买底层资产...");
      try {
        const maxPurchaseAmount1 = ethers.parseEther("10"); // 最多购买10 WLTC
        const maxAcceptablePrice1 = ethers.parseEther("29.9"); // 最高可接受价格29.9
        
        const purchaseTx1 = await auctionManager.connect(bidder1).purchaseUnderlying(
          auctionId,
          maxPurchaseAmount1,
          maxAcceptablePrice1,
          bidder1.address, // 接收者
          "0x" // 空调用数据
        );
        await purchaseTx1.wait();
        console.log("    竞拍者1购买成功 ✅");
        
        // 检查拍卖状态
        const auctionInfoAfterPurchase1 = await auctionManager.auctions(auctionId);
        console.log(`    购买后剩余数量: ${ethers.formatEther(auctionInfoAfterPurchase1.underlyingAmount)} WLTC`);
        
        // 检查竞拍者1获得的WLTC
        const bidder1WLTCBalance = await wltc.balanceOf(bidder1.address);
        console.log(`    竞拍者1 WLTC 余额: ${ethers.formatEther(bidder1WLTCBalance)} WLTC`);
        
      } catch (error) {
        console.log(`    ⚠️ 竞拍者1购买失败: ${error.message}`);
      }
      
      // 5.4 竞拍者2购买底层资产
      console.log("  5.4 竞拍者2购买底层资产...");
      try {
        const maxPurchaseAmount2 = ethers.parseEther("20"); // 最多购买20 WLTC
        const maxAcceptablePrice2 = ethers.parseEther("30.1"); // 最高可接受价格30.1
        
        const purchaseTx2 = await auctionManager.connect(bidder2).purchaseUnderlying(
          auctionId,
          maxPurchaseAmount2,
          maxAcceptablePrice2,
          bidder2.address, // 接收者
          "0x" // 空调用数据
        );
        await purchaseTx2.wait();
        console.log("    竞拍者2购买成功 ✅");
        
        // 检查拍卖状态
        const auctionInfoAfterPurchase2 = await auctionManager.auctions(auctionId);
        console.log(`    购买后剩余数量: ${ethers.formatEther(auctionInfoAfterPurchase2.underlyingAmount)} WLTC`);
        
        // 检查竞拍者2获得的WLTC
        const bidder2WLTCBalance = await wltc.balanceOf(bidder2.address);
        console.log(`    竞拍者2 WLTC 余额: ${ethers.formatEther(bidder2WLTCBalance)} WLTC`);
        
      } catch (error) {
        console.log(`    ⚠️ 竞拍者2购买失败: ${error.message}`);
      }
    }
  }

  // ==================== 测试6: 拍卖完成后提取币 ====================
  console.log("\n📦 测试6: 拍卖完成后提取币");

  if (userTokens[0].length > 0) {
    const tokenId = userTokens[0][0];
    const userStatus = await liquidationManager.userLiquidationStatus(liquidatedUser.address, tokenId);
    
    if (userStatus.isUnderLiquidation && userStatus.auctionId > 0) {
      const auctionId = userStatus.auctionId;
      
      // 6.1 检查拍卖是否完成
      console.log("  6.1 检查拍卖状态...");
      try {
        const auctionInfo = await auctionManager.auctions(auctionId);
        console.log(`    当前拍卖状态:`);
        console.log(`      剩余数量: ${ethers.formatEther(auctionInfo.underlyingAmount)} WLTC`);
        console.log(`      累计支付金额: ${ethers.formatEther(auctionInfo.totalPayment)} S`);
        
        // 如果拍卖还有剩余，可以继续购买直到完成
        if (auctionInfo.underlyingAmount > 0) {
          console.log("  6.2 拍卖继续...");
          
          // 使用竞拍者1购买剩余所有底层资产
          const remainingAmount = auctionInfo.underlyingAmount;
          // 使用更高的可接受价格，因为价格计算器使用 RAY 精度
          const maxAcceptablePrice = ethers.parseEther("30");
          
          console.log(`    购买剩余 ${ethers.formatEther(remainingAmount)} WLTC...`);
          console.log(`    最高可接受价格: ${ethers.formatEther(maxAcceptablePrice)}`);
          
          const finalPurchaseTx = await auctionManager.connect(bidder1).purchaseUnderlying(
            auctionId,
            remainingAmount, // 购买全部剩余
            maxAcceptablePrice,
            bidder1.address,
            "0x"
          );
          await finalPurchaseTx.wait();
          console.log("    拍卖完成 ✅");
          
          // 检查拍卖是否已移除
          const completedAuctionInfo = await auctionManager.auctions(auctionId);
          if (completedAuctionInfo.originalOwner === ethers.ZeroAddress) {
              console.log("    ✅ 拍卖已成功完成并从活跃拍卖中移除");
          } else {
              console.log(`    ⚠️ 拍卖仍然存在: ${ethers.formatEther(completedAuctionInfo.underlyingAmount)} WLTC 剩余`);
          }

        } else {
          console.log("    ✅ 拍卖已完成，无需额外购买");
        }
        
        // 6.3 被清算用户提取稳定币
        console.log("  6.3 被清算用户提取稳定币...");
        try {
          // 检查提取条件
          const withdrawStatus = await liquidationManager.userLiquidationStatus(liquidatedUser.address, tokenId);
          console.log(`    提取条件检查:`);
          console.log(`      是否已清算完成: ${withdrawStatus.isLiquidated ? "✅" : "❌"}`);
          console.log(`      是否仍在清算中: ${withdrawStatus.isUnderLiquidation ? "✅": "❌" }`);
          console.log(`      该清算卖得稳定币数量: ${ethers.formatEther(withdrawStatus.stableNums)} S`);
          
          if (withdrawStatus.isLiquidated && !withdrawStatus.isUnderLiquidation) {
            console.log("    调用 withdrawStable 函数...");
            
            // 记录提取前的余额
            const beforeWithdrawBalance = await stableToken.balanceOf(liquidatedUser.address);
            console.log(`    提取前稳定币余额: ${ethers.formatEther(beforeWithdrawBalance)} S`);
            
            // 调用 withdrawStable 函数
            const withdrawTx = await liquidationManager.connect(liquidatedUser).withdrawStable(
              liquidatedUser.address,
              tokenId
            );
            await withdrawTx.wait();
            console.log("    提取成功 ✅");
            
            // 检查提取后的余额
            const afterWithdrawBalance = await stableToken.balanceOf(liquidatedUser.address);
            console.log(`    提取后稳定币余额: ${ethers.formatEther(afterWithdrawBalance)} S`);
            console.log(`    提取金额: ${ethers.formatEther(afterWithdrawBalance - beforeWithdrawBalance)} S`);
            
            // 检查用户状态是否已更新
            const afterWithdrawStatus = await liquidationManager.userLiquidationStatus(liquidatedUser.address, tokenId);
            console.log(`    提取后状态:`);
            console.log(`      是否冻结: ${afterWithdrawStatus.isFreezed ?  "✅": "❌" }`);
            console.log(`      卖得稳定币数量: ${ethers.formatEther(afterWithdrawStatus.stableNums)} S`);
            console.log(`      拍卖 ID: ${afterWithdrawStatus.auctionId}`);
            console.log(`      风险等级: ${afterWithdrawStatus.riskLevel}`);
            console.log(`      余额: ${ethers.formatEther(afterWithdrawStatus.balance)}`);
          } else {
            console.log("    ⚠️ 提取条件不满足，跳过提取");
          }
        } catch (error) {
          console.log(`    ❌ 提取稳定币失败: ${error.message}`);
        }
        
        
        // 6.4 检查竞拍者获得的WLTC
        console.log("  6.4 检查竞拍者获得的WLTC...");
        const finalBidder1WLTC = await wltc.balanceOf(bidder1.address);
        const finalBidder2WLTC = await wltc.balanceOf(bidder2.address);
        console.log(`    竞拍者1 最终 WLTC 余额: ${ethers.formatEther(finalBidder1WLTC)} WLTC`);
        console.log(`    竞拍者2 最终 WLTC 余额: ${ethers.formatEther(finalBidder2WLTC)} WLTC`);
        
        // 6.8 检查系统整体状态
        console.log("  6.8 系统整体状态检查...");
        const activeAuctionCount = await auctionManager.getActiveAuctionCount();
        console.log(`    活跃拍卖数量: ${activeAuctionCount}`);
        
        console.log("\n🎉 完整清算流程测试完成!");
        
      } catch (error) {
        console.log(`    ⚠️ 拍卖完成检查失败: ${error.message}`);
      }
    } else {
      console.log("    拍卖未在进行中，跳过提取币测试");
    }
  } else {
    console.log("    没有可用的代币进行测试");
  }
}

// 执行主函数
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
