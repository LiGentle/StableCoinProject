// test-dex.js
async function testDexIntegration() {
    const pool = await ethers.getContractAt("StableUSDCPool", poolAddress);
    
    // 测试价格查询
    const usdcAmount = ethers.utils.parseUnits("100", 6); // 100 USDC
    const quote = await pool.getUsdcToUnderlyingQuote(usdcAmount);
    
    console.log("100 USDC 可以买到:", ethers.utils.formatEther(quote.underlyingAmount), "Underlying");
    console.log("价格影响:", quote.priceImpact.toString(), "bp");
    
    // 测试实际交易（需要有足够的代币余额）
    // const tx = await pool.swapUsdcToLeverage(usdcAmount, 0); // Leverage.CONSERVATIVE
    // console.log("交易哈希:", tx.hash);
}