async function main() {
    const [deployer] = await ethers.getSigners();
    
    // ✅ 第一步：获取已部署合约的地址
    const custodianAddress = "0x...";     // 之前部署的LeverageCustodian
    const stableTokenAddress = "0x...";   // 之前部署的StableToken
    const leverageTokenAddress = "0x..."; // 之前部署的MultiLeverageToken
    const feeCollectorAddress = "0x...";  // 费用收集者地址

    const SEPOLIA_UNISWAP_V3_ADDRESSES = {
        //由Uniswap V3官方部署的基礎設施合約，地址不變；这些地址在所有网络上都是相同的（主网、测试网等）
        ROUTER: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
        QUOTER: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6", 
        FACTORY: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    };

    //https://app.uniswap.org/explore/pools/ethereum_sepolia/0xc2823E89bEB6D0331B918a0303e2e7Da7aF13Cb7
    const POOL_CONFIG = {
        POOL_ADDRESS: "0xc2823E89bEB6D0331B918a0303e2e7Da7aF13Cb7",  // 你的池地址(自己在Uniswap V3上创建的USDC-Underlying池)
        POOL_USDC_ADDRESS: "0xCc90Ce982aD208b0F90b872e8A1880Ace299c371",                  // Sepolia USDC地址(自己部署的USDC)
        POOL_UNDERLYING_ADDRESS: "0x9DFF6745444c05bbEc03bF59C0910731C02950dd",            // Sepolia Underlying地址(自己部署的WLTC)
        POOL_FEE: 3000  // 0.3% = 3000 basis points
    };

    
    // 使用Factory查找池
    const factory = await ethers.getContractAt("IUniswapV3Factory", SEPOLIA_UNISWAP_V3_ADDRESSES.FACTORY);
    let uniswapV3PoolAddress = await factory.getPool(
        POOL_CONFIG.POOL_USDC_ADDRESS,
        POOL_CONFIG.POOL_UNDERLYING_ADDRESS,
        POOL_CONFIG.POOL_FEE
    );

    console.log("查询到的池地址:", uniswapV3PoolAddress);
    console.log("预期的池地址:", POOL_CONFIG.POOL_ADDRESS);

    if (uniswapV3PoolAddress !== POOL_CONFIG.POOL_ADDRESS) {
        throw new Error("池地址不匹配");
    }

    if (uniswapV3PoolAddress === ethers.constants.AddressZero) {
        throw new Error("请先在Uniswap V3上创建USDC-Underlying交易池");
    }
    
    
    // ✅ 第三步：部署我们自己的AMM池（StableUSDCPool）
    console.log("🚀 开始部署StableUSDCPool...");
    
    const StableUSDCPool = await ethers.getContractFactory("StableUSDCPool");
    const ourAmmPool = await StableUSDCPool.deploy(
        custodianAddress,                           // 我们的托管合约
        stableTokenAddress,                         // AMM可交易的稳定币
        leverageTokenAddress,                       // AMM可交易的杠杆代币
        feeCollectorAddress,                        // 费用收集者

        SEPOLIA_UNISWAP_V3_ADDRESSES.ROUTER,        // Uniswap V3 Router
        SEPOLIA_UNISWAP_V3_ADDRESSES.QUOTER,        // Uniswap V3 Quoter

        POOL_CONFIG.POOL_ADDRESS,                   // 传入自己部署的Uniswap V3池地址（作为外部DEX）
        POOL_CONFIG.POOL_USDC_ADDRESS,                           // DEX池資產USDC
        POOL_CONFIG.POOL_UNDERLYING_ADDRESS,                     // DEX池标的资产代币
        POOL_CONFIG.POOL_FEE,                                 // Uniswap V3池费率
        
        "StableUSDC LP Token V3",                 // LP代币名称
        "sUSDC-LP-V3"                            // LP代币符号
    );
    
    await ourAmmPool.deployed();
    console.log("✅ StableUSDCPool 部署完成:", ourAmmPool.address);
    
    // ✅ 第四步：验证配置
    const config = await ourAmmPool.getV3DexConfig();
    console.log("📊 AMM配置验证:");
    console.log("- Router:", config.router);
    console.log("- Quoter:", config._quoter);
    console.log("- 外部V3池:", config.pool);
    console.log("- 费率:", config.fee);
}