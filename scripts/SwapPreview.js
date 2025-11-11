// 前端JavaScript调用示例

class SwapPreviewManager {
    constructor(poolContract, web3) {
        this.poolContract = poolContract;
        this.web3 = web3;
    }

    // ✅ 预览Stable -> USDC交易
    async previewStableToUsdc(stableAmount) {
        try {
            const stableAmountWei = this.web3.utils.toWei(stableAmount.toString(), 'ether');
            
            const result = await this.poolContract.methods
                .previewSwapStableToUsdc(stableAmountWei)
                .call();
            
            return {
                usdcOut: parseFloat(result.usdcAmountOut) / 1e6, // 转换为USDC显示
                tradingFee: this.web3.utils.fromWei(result.tradingFee, 'ether'),
                adminFee: this.web3.utils.fromWei(result.adminFeeAmount, 'ether'),
                lpFee: this.web3.utils.fromWei(result.lpFeeAmount, 'ether'),
                priceImpact: parseFloat(result.priceImpact) / 100, // 转换为百分比
                isValid: result.isValid,
                effectiveRate: result.isValid ? 
                    parseFloat(result.usdcAmountOut) / 1e6 / stableAmount : 0
            };
        } catch (error) {
            console.error("Error previewing stable to usdc swap:", error);
            return null;
        }
    }

    // ✅ 预览USDC -> Stable交易
    async previewUsdcToStable(usdcAmount) {
        try {
            const usdcAmountScaled = Math.floor(usdcAmount * 1e6); // 转换为6位精度
            
            const result = await this.poolContract.methods
                .previewSwapUsdcToStable(usdcAmountScaled)
                .call();
            
            return {
                stableOut: this.web3.utils.fromWei(result.stableAmountOut, 'ether'),
                tradingFee: this.web3.utils.fromWei(result.tradingFee, 'ether'),
                adminFee: this.web3.utils.fromWei(result.adminFeeAmount, 'ether'),
                lpFee: this.web3.utils.fromWei(result.lpFeeAmount, 'ether'),
                priceImpact: parseFloat(result.priceImpact) / 100,
                isValid: result.isValid,
                effectiveRate: result.isValid ? 
                    parseFloat(this.web3.utils.fromWei(result.stableAmountOut, 'ether')) / usdcAmount : 0
            };
        } catch (error) {
            console.error("Error previewing usdc to stable swap:", error);
            return null;
        }
    }

    // ✅ 批量预览交易
    async batchPreviewSwaps(stableAmounts, usdcAmounts) {
        try {
            const stableAmountsWei = stableAmounts.map(amount => 
                this.web3.utils.toWei(amount.toString(), 'ether')
            );
            const usdcAmountsScaled = usdcAmounts.map(amount => 
                Math.floor(amount * 1e6)
            );
            
            const result = await this.poolContract.methods
                .batchPreviewSwaps(stableAmountsWei, usdcAmountsScaled)
                .call();
            
            return {
                stableToUsdc: result.stableToUsdcResults.map((res, index) => ({
                    inputAmount: stableAmounts[index],
                    outputAmount: parseFloat(res.amountOut) / 1e6,
                    tradingFee: this.web3.utils.fromWei(res.tradingFee, 'ether'),
                    priceImpact: parseFloat(res.priceImpact) / 100,
                    isValid: res.isValid
                })),
                usdcToStable: result.usdcToStableResults.map((res, index) => ({
                    inputAmount: usdcAmounts[index],
                    outputAmount: this.web3.utils.fromWei(res.amountOut, 'ether'),
                    tradingFee: this.web3.utils.fromWei(res.tradingFee, 'ether'),
                    priceImpact: parseFloat(res.priceImpact) / 100,
                    isValid: res.isValid
                }))
            };
        } catch (error) {
            console.error("Error in batch preview:", error);
            return null;
        }
    }

    // ✅ 获取最优交易数量
    async getOptimalAmount(maxPriceImpact, direction) {
        try {
            const maxImpactBasisPoints = Math.floor(maxPriceImpact * 100); // 转换为基点
            const isStableToUsdc = direction === 'stable_to_usdc';
            
            const result = await this.poolContract.methods
                .getOptimalSwapAmount(maxImpactBasisPoints, isStableToUsdc)
                .call();
            
            return {
                optimalAmount: isStableToUsdc ? 
                    this.web3.utils.fromWei(result.optimalAmount, 'ether') :
                    parseFloat(result.optimalAmount) / 1e6,
                expectedOutput: isStableToUsdc ?
                    parseFloat(result.expectedOutput) / 1e6 :
                    this.web3.utils.fromWei(result.expectedOutput, 'ether'),
                maxPriceImpact: maxPriceImpact
            };
        } catch (error) {
            console.error("Error getting optimal amount:", error);
            return null;
        }
    }
}

// 使用示例
const previewManager = new SwapPreviewManager(poolContract, web3);

// 预览交易
async function previewTradeExample() {
    // 预览100 Stable -> USDC
    const stableToUsdcResult = await previewManager.previewStableToUsdc(100);
    console.log("Stable to USDC preview:", stableToUsdcResult);
    
    // 预览100 USDC -> Stable
    const usdcToStableResult = await previewManager.previewUsdcToStable(100);
    console.log("USDC to Stable preview:", usdcToStableResult);
    
    // 获取最优交易数量（最大2%价格影响）
    const optimalStableToUsdc = await previewManager.getOptimalAmount(2.0, 'stable_to_usdc');
    console.log("Optimal Stable to USDC amount:", optimalStableToUsdc);
}