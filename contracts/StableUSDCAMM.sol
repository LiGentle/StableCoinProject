// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// import "@openzeppelin/contracts/access/Ownable.sol";
// import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
// import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
// import "./tokens/LPToken.sol";
// import "./Types.sol";
// import "./tokens/StableToken.sol";
// import "./tokens/MultiLeverageToken.sol";
// import "./CustodianFixed.sol";




// // ======================Interface由Uniswap V3团队在其官方合约中定义的(仅在当前合约中使用)================
// interface IUniswapV3Router {
//     struct ExactInputSingleParams {
//         address tokenIn;
//         address tokenOut;
//         uint24 fee;           // Uniswap V3的三层费率：500(低費率0.05%), 3000(中費率0.3%), 10000(高費率1%)
//         address recipient;
//         uint256 deadline;
//         uint256 amountIn;
//         uint256 amountOutMinimum;
//         uint160 sqrtPriceLimitX96;// V3特有的价格限制格式
//     }

//     struct ExactOutputSingleParams {
//         address tokenIn;
//         address tokenOut;
//         uint24 fee;
//         address recipient;
//         uint256 deadline;
//         uint256 amountOut;
//         uint256 amountInMaximum;
//         uint160 sqrtPriceLimitX96;
//     }

//     function exactInputSingle(ExactInputSingleParams calldata params)
//         external payable returns (uint256 amountOut);

//     function exactOutputSingle(ExactOutputSingleParams calldata params)
//         external payable returns (uint256 amountIn);
// }

// interface IUniswapV3Pool {
//     function token0() external view returns (address);
//     function token1() external view returns (address);
//     function fee() external view returns (uint24);
//     function slot0() external view returns (
//         uint160 sqrtPriceX96,
//         int24 tick,
//         uint16 observationIndex,
//         uint16 observationCardinality,
//         uint16 observationCardinalityNext,
//         uint8 feeProtocol,
//         bool unlocked
//     );
//     function liquidity() external view returns (uint128);
// }

// interface IUniswapV3Factory {
//     function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
// }

// interface IQuoter {
//     function quoteExactInputSingle(
//         address tokenIn,
//         address tokenOut,
//         uint24 fee,
//         uint256 amountIn,
//         uint160 sqrtPriceLimitX96
//     ) external returns (uint256 amountOut);

//     function quoteExactOutputSingle(
//         address tokenIn,
//         address tokenOut,
//         uint24 fee,
//         uint256 amountOut,
//         uint160 sqrtPriceLimitX96
//     ) external returns (uint256 amountIn);
// }



// /**
//  * @title StableUSDCAMM
//  * @dev 专用的 StableToken-USDC 交易池，使用 StableSwap 算法
//  */
// contract StableUSDCAMM is Ownable, ReentrancyGuard {
//     using SafeERC20 for IERC20;

//     // ============= 常量和配置 =============



//     // ============= A 值调整机制 =============
//     uint256 public initialA;
//     uint256 public futureA; 
//     uint256 public initialATime;
//     uint256 public futureATime;
//     uint256 public constant MIN_RAMP_TIME = 86400; // 1天
//     uint256 public constant MIN_A = 1;
//     uint256 public constant MAX_A = 10000;
//     //以上參數是爲了支持A值的動態調整；
//     uint256 public constant A_PRECISION = 100;
//     uint256 public A;   // 放大系数
    
    



//     // ============= 状态变量 =============

//     CustodianFixed public custodian;
    
//     // 代币合约
//     StableToken public immutable stableToken;    // StableToken (18 decimals)
//     IERC20 public immutable usdc;           // USDC (6 decimals)
    
//     // LP 代币
//     LPToken public immutable lpToken;
    
//     // 池余额（标准化到 18 位精度）
//     uint256 public stableBalance;  // StableToken 余额
//     uint256 public usdcBalance;    // USDC 余额（已转换为 18 位精度）
    
//     // 费率设置

    
//     // ============= 費用管理相關變量及事件 变量 =============
//     address public feeCollector;  // 费用收集器地址
//     uint256 public constant AUTO_WITHDRAW_THRESHOLD = 1000 * 1e18;  // 自动提取阈值
    
//     // 费用累积（保持现有逻辑）,按照Curve Finance的做法
//     uint256 public fee = 4;           // 0.04% 交易费
//     uint256 public constant BASISPOINT = 10000;      // 100% 的基点表示
//     uint256 public adminFee = 500;   // 50% 管理费
//     uint256 public constant PRECISION = 10 ** 18;//用於以下幾處：1. 賣出L獲得USDC后,拆分比例給用戶和池子
//     uint256 public constant MAX_FEE = 5 * 10 ** 9;  // 最大费率 50%
//     uint256 public adminStableBalance;      // 池子中纍積的管理费：StableToken
//     uint256 public adminUsdcBalance;        // 池子中纍積的管理费：USDC (18位精度)

//     // 事件
//     event FeeCollected(address indexed token, uint256 amount);
//     event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
//     event AutoFeeWithdraw(uint256 stableAmount, uint256 usdcAmount);
//     event FeeUpdated(uint256 newFee, uint256 newAdminFee);
//     event FeeDistribution(uint256 lpFee, uint256 adminFee);
//     // ============= 費用管理相關變量及事件 变量 =============

//     // ============= 杠桿代幣交換相關變量及事件===============
//     MultiLeverageToken public immutable leverageToken;      // 杠杆代币
//     IERC20 public immutable underlyingToken;    // 标的资产 (如 ETH, BTC等)

//     // 杠杆交易相关事件
//     event LeverageSwap(
//         address indexed user,
//         bool isUsdcToLeverage,
//         uint256 amountIn,
//         uint256 amountOut,
//         uint256 underlyingAmount
//     );

//     event DEXRouterUpdated(address indexed oldRouter, address indexed newRouter);
//     // ============= 杠桿代幣交換相關變量及事件===============


//     // ==============四個swap事件定義=======================
//     event SwapStableToUsdc(address indexed user, uint256 stableAmountIn, uint256 usdcAmountOut);
//     event SwapUsdcToStable(address indexed user, uint256 usdcAmountIn, uint256 stableAmountOut);
//     event SwapLeverageToUsdc(address indexed user, uint256 leverageTokenId, uint256 lAmountPercentage, uint256 usdcAmountOut);
//     event SwapUsdcToLeverage(address indexed user, uint256 usdcAmountIn, uint256 leverageTokenId, uint256 lAmountOut);

//     // ============= 事件定义 =============

//     event RampA(uint256 initialA, uint256 futureA, uint256 initialTime, uint256 futureTime);
    
//     event AddLiquidity(
//         address indexed provider,
//         uint256 stableAmount,
//         uint256 usdcAmount,
//         uint256 lpTokens
//     );
    
//     event RemoveLiquidity(
//         address indexed provider,
//         uint256 stableAmount,
//         uint256 usdcAmount,
//         uint256 lpTokens
//     );
    
//     event TokenExchange(
//         address indexed buyer,
//         bool stableToUsdc,
//         uint256 amountIn,
//         uint256 amountOut
//     );
    
    
//     event AUpdated(uint256 newA);


//     // ============= DEX交易相关变量 (修改为V3) ===============
//     address public dexRouter;                       // Uniswap V3 Router地址
//     address public quoter;                          // V3 Quoter地址
//     address public usdcUnderlyingPool;              // USDC-Underlying池地址 (V3)
//     uint24 public poolFee;                          // V3池费率 (500, 3000, 10000)
//     uint256 public leverageSlippageTolerance = 300; // 3% 滑点容忍度
//     uint256 public constant MAX_SLIPPAGE = 1000;    // 最大10%滑点
    
//     // V3特有配置
//     uint160 public constant MIN_SQRT_RATIO = 4295128739;
//     uint160 public constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

//     // DEX交易事件
//     event DEXTradeExecuted(
//         bool isBuy, 
//         uint256 amountIn, 
//         uint256 amountOut, 
//         uint256 slippage
//     );

//     // ============= 构造函数 =============
    
//     constructor(
//         address _custodian,          // 托管合约地址
//         address _stableToken,        // AMM池中的配對資產之一：穩定幣 S token
//         address _leverageToken,      // AMM池中的可以交易的產品：杠杆代币 L token
//         address _feeCollector,      // 费用收集者地址
        
//         address _dexRouter,          // V3 Router地址，用于执行实际的代币交换操作 Sepolia测试网地址：0xE592427A0AEce92De3Edee1F18E0157C05861564
//         address _quoter,             // V3 Quoter地址，用于查询交换价格，不执行实际交易 Sepolia测试网地址：0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6
//         address _usdcUnderlyingPool, // V3 池地址，你在Uniswap上创建的具体交易池合约地址 你的池地址：0xc2823E89bEB6D0331B918a0303e2e7Da7aF13Cb7
//         address _usdc,               // DEX/AMM中的配對資產之一：USDC
//         address _underlyingToken,    // DEX中的配對資產之一：标的资产(WLTC) 
//         uint24 _poolFee,             // V3 费率层级           
        
//         string memory _lpName,
//         string memory _lpSymbol
//     ) Ownable(msg.sender) {
//         require(_custodian != address(0), "Invalid custodian address");
//         require(_stableToken != address(0) && _usdc != address(0), "Invalid token addresses");
//         require(_leverageToken != address(0) && _underlyingToken != address(0), "Invalid leverage tokens");
//         require(_dexRouter != address(0), "Invalid DEX router");
//         require(_quoter != address(0), "Invalid quoter");
//         require(_usdcUnderlyingPool != address(0), "Invalid trading pool");
//         require(_poolFee == 500 || _poolFee == 3000 || _poolFee == 10000, "Invalid pool fee");

//         custodian = CustodianFixed(_custodian);
//         stableToken = StableToken(_stableToken);
//         usdc = IERC20(_usdc);
//         leverageToken = MultiLeverageToken(_leverageToken);
//         underlyingToken = IERC20(_underlyingToken);
//         dexRouter = _dexRouter;
//         quoter = _quoter;
//         usdcUnderlyingPool = _usdcUnderlyingPool;
//         poolFee = _poolFee;

//         require(_feeCollector != address(0), "Invalid fee collector address");
//         feeCollector = _feeCollector;

//         // 验证V3池的正确性
//         _validateV3Pool();


//         // ✅ 这里自动创建和部署 LPToken
//         // 此时 msg.sender 是 StableUSDCPool 合约地址，而不是部署者地址
//         // 所以 LPToken 的 pool 变量会被设置为 StableUSDCPool 地址
//         lpToken = new LPToken(_lpName, _lpSymbol);
//         //創建池子的時候，創建LP token


//         // ✅ A值設定，从保守值开始
//         uint256 initialAValue = 200;
//         A = initialAValue * A_PRECISION;
//         initialA = A;
//         futureA = A;
//         initialATime = block.timestamp;
//         futureATime = block.timestamp;
//     }

//     /**
//     * @dev 验证V3池是否正确
//     */
//     function _validateV3Pool() internal view {
//         IUniswapV3Pool pool = IUniswapV3Pool(usdcUnderlyingPool);
//         address token0 = pool.token0();
//         address token1 = pool.token1();
//         uint24 fee0 = pool.fee();
        
//         require(
//             (token0 == address(usdc) && token1 == address(underlyingToken)) ||
//             (token0 == address(underlyingToken) && token1 == address(usdc)),
//             "Invalid pool tokens"
//         );
        
//         require(fee0 == poolFee, "Pool fee mismatch");
//     }


//     // ======================================= AMM池參數管理函數 ================================================
//     // 1. getA: 获取当前有效的 A 值（支持平滑过渡）
//     // 2. rampA: 逐步调整 A 值到新的值
//     // 3. getD: 计算 D 值
//     // 4. getY: 已知一種資產x的數量，计算另一種資產 Y 的數量
//     // ======================================= AMM池參數管理函數 ================================================

//     /**
//      * @dev 获取当前有效的 A 值（支持平滑过渡）
//      */
//     function getA() public view returns (uint256) {
//         uint256 t1 = futureATime;
//         uint256 A1 = futureA;

//         if (block.timestamp < t1) {
//             uint256 A0 = initialA;
//             uint256 t0 = initialATime;
            
//             if (A1 > A0) {
//                 return A0 + (A1 - A0) * (block.timestamp - t0) / (t1 - t0);
//             } else {
//                 return A0 - (A0 - A1) * (block.timestamp - t0) / (t1 - t0);
//             }
//         } else {
//             return A1;
//         }
//     }
    
//     /**
//      * @dev 逐步调整 A 值到新的值
//      */
//     function rampA(uint256 futureAValue, uint256 futureTime) external onlyOwner {
//         require(block.timestamp >= initialATime + MIN_RAMP_TIME, "Too frequent");
//         require(futureTime >= block.timestamp + MIN_RAMP_TIME, "Insufficient time");
//         require(futureAValue >= MIN_A && futureAValue <= MAX_A, "A out of range");
        
//         uint256 initialAValue = getA();
//         futureAValue *= A_PRECISION;
        
//         // 限制 A 值变化幅度（不超过2倍）
//         if (futureAValue < initialAValue) {
//             require(futureAValue * 2 >= initialAValue, "A decrease too large");
//         } else {
//             require(futureAValue <= initialAValue * 2, "A increase too large");
//         }
        
//         initialA = initialAValue;
//         futureA = futureAValue;
//         initialATime = block.timestamp;
//         futureATime = futureTime;
        
//         emit RampA(initialAValue, futureAValue, block.timestamp, futureTime);
//     }

//     /**
//      * @dev 计算不变量 D
//      */
//     function getD() public view returns (uint256) {
//         uint256 currentA = getA(); // 使用动态 A 值
//         uint256 s = stableBalance + usdcBalance;
//         if (s == 0) return 0;

//         uint256 prevD = 0;
//         uint256 d = s;
//         uint256 ann = currentA * 4; // A * n^n, where n=2

//         for (uint256 i = 0; i < 255; i++) {
//              // 计算 D_P = D^3 / (4 * x * y)
//             uint256 dp = d * d * d / (4 * stableBalance * usdcBalance);
//             prevD = d;
//             // d = (ann * s + 2 * dp) * d / ((ann - 1) * d + 3 * dp)
//             d = (ann * s + 2 * dp) * d / ((ann - 1) * d + 3 * dp);
            
//             if (d > prevD) {
//                 if (d - prevD <= 1) break;// 收敛，退出循环
//             } else {
//                 if (prevD - d <= 1) break; // 收敛，退出循环
//             }
//         }
        
//         return d;
//     }

//     /**
//     * @dev 计算 StableSwap 中的 y 值（纯数学版本）
//     * @param x 已知的代币余额
//     * @param d 不变量D
//     * @return y 另一个代币的余额
//     */
//     function getY(uint256 x, uint256 d) internal view returns (uint256) {
//         require(x > 0 && d > 0, "Invalid parameters");
        
//         uint256 currentA = getA();
//         uint256 ann = currentA * 4; // A * n^n, where n=2
        
//         // 使用牛顿迭代法求解
//         uint256 c = d * d * d / (4 * ann * x);
//         uint256 b = x + d / ann;
        
//         uint256 prevY = 0;
//         uint256 y = d; // 初始猜测值
        
//         for (uint256 i = 0; i < 255; i++) {
//             prevY = y;
//             // 牛顿迭代公式：y_new = (y^2 + c) / (2*y + b - d)
//             y = (y * y + c) / (2 * y + b - d);
            
//             // 收敛判断
//             if (y > prevY) {
//                 if (y - prevY <= 1) break;
//             } else {
//                 if (prevY - y <= 1) break;
//             }
//         }
        
//         return y;
//     }
    

    
//     // ======================================= 核心交易函數 ================================================
//     // 1. swapStableToUsdc: StableToken -> USDC
//     // 2. swapUsdcToStable: USDC -> StableToken
//     // 3. swapLeverageToUsdc: 杠杆代币 -> USDC
//     // 4. swapUsdcToLeverage: USDC -> 杠杆代币
//     // ======================================= 核心交易函數 ================================================
    
//     /**
//     * @dev StableToken -> USDC, 增加S token, 減少USDC（重写版本）
//     */
//     function swapStableToUsdc(
//         uint256 stableAmountIn, //單位 18位
//         uint256 slippageTolerance // 允許的最大滑點，基點表示，例如300表示3%
//     ) external nonReentrant returns (
//         uint256 usdcAmountOut) 
//     {
//         require(stableAmountIn > 0, "Amount must be positive");
        
//         // ✅ 使用预览函数获取交易参数
//         (
//             uint256 previewUsdcOut,//6位精度, 且考虑了手续费
//             uint256 tradingFee,
//             uint256 adminFeeAmount,
//             uint256 lpFeeAmount,
//             ,  // priceImpact - 不需要在实际交易中使用
//             bool isValid
//         ) = this.previewSwapStableToUsdc(stableAmountIn);

//         uint256 minUsdcOut = stableAmountIn * (BASISPOINT - slippageTolerance) / BASISPOINT / 1e12;//6位精度，最少应该出来S token数量的97%； 否则revert
//         require(isValid, "Invalid swap parameters");
//         require(previewUsdcOut >= minUsdcOut, "Insufficient output amount");
        
//         // ✅ 执行代币转移
//         stableToken.transferFrom(msg.sender, address(this), stableAmountIn);
        
//         // ✅ 根据预览结果更新池状态
//         stableBalance += stableAmountIn;
//         usdcBalance -= (previewUsdcOut * 1e12 + adminFeeAmount);  // 18位精度计算
        
//         // 管理费用处理
//         adminUsdcBalance += adminFeeAmount;  // 暂存管理费用
//         // LP费用 (lpFeeAmount) 自动留在池中，增加LP提供者收益
        
//         // ✅ 设置返回值
//         usdcAmountOut = previewUsdcOut;
        
//         // ✅ 转移输出代币给用户
//         usdc.safeTransfer(msg.sender, usdcAmountOut);
        
//         // ✅ 可选：超过阈值时自动提取
//         _checkAutoWithdraw();

//         emit SwapStableToUsdc(msg.sender, stableAmountIn, usdcAmountOut);
//         emit FeeDistribution(lpFeeAmount, adminFeeAmount);
//     }
    
//     /**
//     * @dev 预览 StableToken -> USDC 交易结果（view函数，不执行实际交易）
//     * @param stableAmountIn 输入的StableToken数量（18位精度）
//     * @return usdcAmountOut 预期输出的USDC数量（6位精度）
//     * @return tradingFee 交易手续费（18位精度）
//     * @return adminFeeAmount 管理费数量（18位精度）
//     * @return lpFeeAmount LP提供者获得的费用（18位精度）
//     * @return priceImpact 价格影响（基点，100 = 1%）
//     * @return isValid 交易是否有效
//     */
//     function previewSwapStableToUsdc(uint256 stableAmountIn) 
//         external 
//         view 
//         returns (
//             uint256 usdcAmountOut,//6位
//             uint256 tradingFee,
//             uint256 adminFeeAmount, 
//             uint256 lpFeeAmount,
//             uint256 priceImpact,
//             bool isValid
//         ) 
//     {
//         // ✅ 基本验证
//         if (stableAmountIn == 0) {
//             return (0, 0, 0, 0, 0, false);
//         }
        
//         // ✅ 获取当前池状态
//         uint256 stableBalanceBefore = stableBalance;
//         uint256 usdcBalanceBefore = usdcBalance;
        
//         // 检查池子是否有足够的USDC
//         if (usdcBalanceBefore == 0) {
//             return (0, 0, 0, 0, 0, false);
//         }
        
//         // ✅ 计算交易前的D值
//         uint256 DBefore = getD();
//         if (DBefore == 0) {
//             return (0, 0, 0, 0, 0, false);
//         }
        
//         // ✅ 模拟添加StableToken后的状态
//         uint256 stableBalanceAfter = stableBalanceBefore + stableAmountIn;
        
//         // ✅ 使用StableSwap算法计算新的USDC余额
//         uint256 usdcBalanceAfter = getY(stableBalanceAfter, DBefore);
        
//         // ✅ 手动检查结果有效性
//         if (usdcBalanceAfter == 0 || usdcBalanceAfter >= usdcBalanceBefore) {
//             return (0, 0, 0, 0, 0, false);
//         }
        
//         // ✅ 检查计算结果是否合理
//         if (usdcBalanceAfter >= usdcBalanceBefore) {
//             return (0, 0, 0, 0, 0, false); // USDC余额不应该增加
//         }
        
//         // ✅ 计算输出量和费用
//         uint256 usdcOutputBeforeFee = usdcBalanceBefore - usdcBalanceAfter;
        
//         // 检查输出量是否合理
//         if (usdcOutputBeforeFee == 0 || usdcOutputBeforeFee > usdcBalanceBefore) {
//             return (0, 0, 0, 0, 0, false);
//         }
        
//         // ✅ 计算费用结构（与原函数完全一致）
//         tradingFee = usdcOutputBeforeFee * fee / BASISPOINT;
//         adminFeeAmount = tradingFee * adminFee / BASISPOINT;
//         lpFeeAmount = tradingFee - adminFeeAmount;
        
//         // ✅ 计算最终输出（转换为6位精度）
//         uint256 usdcOutputAfterFee = usdcOutputBeforeFee - tradingFee;
//         usdcAmountOut = usdcOutputAfterFee / 1e12;
        
//         // ✅ 计算价格影响
//         priceImpact = _calculateSwapPriceImpact(
//             stableAmountIn,
//             usdcOutputBeforeFee,
//             stableBalanceBefore,
//             usdcBalanceBefore,
//             true // stableToUsdc
//         );
        
//         // ✅ 最终验证
//         isValid = (usdcAmountOut > 0 && priceImpact <= 5000); // 最大50%价格影响
//     }

//     /**
//     * @dev USDC -> StableToken, 增加USDC, 減少S token
//     */
//     function swapUsdcToStable(
//         uint256 usdcAmountIn, //單位 6位
//         uint256 slippageTolerance // 允許的最大滑點，基點表示，例如300表示3%
//     ) external nonReentrant returns (
//         uint256 stableAmountOut) 
//     {
//         require(usdcAmountIn > 0, "Amount must be positive");
        
//         // ✅ 使用预览函数获取交易参数
//         (
//             uint256 previewStableOut,
//             uint256 tradingFee,
//             uint256 adminFeeAmount,
//             uint256 lpFeeAmount,
//             ,  // priceImpact - 不需要在实际交易中使用
//             bool isValid
//         ) = this.previewSwapUsdcToStable(usdcAmountIn);
        

//         uint256 minStableAmountOut = usdcAmountIn *1e12 * (BASISPOINT - slippageTolerance) / BASISPOINT;//18位精度，最少应该出来USDC数量的97%； 否则revert
//         require(isValid, "Invalid swap parameters");
//         require(previewStableOut >= minStableAmountOut, "Insufficient output amount");
        
//         // ✅ 执行代币转移 - 接收用户的USDC
//         usdc.transferFrom(msg.sender, address(this), usdcAmountIn);
        
//         // ✅ 根据预览结果更新池状态
//         // 将USDC输入标准化为18位精度用于内部计算
//         uint256 usdcAmountInNormalized = usdcAmountIn * 1e12;

        
//         // 更新余额（基于StableSwap算法的结果）
//         usdcBalance += usdcAmountInNormalized;
//         stableBalance -= (previewStableOut + adminFeeAmount);  // 减少输出的stable和总费用
        
//         // 管理费用处理
//         adminStableBalance += adminFeeAmount;  // 暂存管理费用
//         // LP费用 (lpFeeAmount) 自动留在池中，增加LP提供者收益
        
//         // ✅ 设置返回值
//         stableAmountOut = previewStableOut;
        
//         // ✅ 转移输出代币给用户
//         stableToken.transfer(msg.sender, stableAmountOut);
        
//         // ✅ 可选：超过阈值时自动提取管理费
//         _checkAutoWithdraw();
        
//         emit SwapUsdcToStable(msg.sender, usdcAmountIn, stableAmountOut);
//         emit FeeDistribution(lpFeeAmount, adminFeeAmount);    
//     }

//     /**
//     * @dev 预览 USDC -> StableToken 交易结果（view函数，不执行实际交易）
//     * @param usdcAmountIn 输入的USDC数量（6位精度）
//     * @return stableAmountOut 预期输出的StableToken数量（18位精度）
//     * @return tradingFee 交易手续费（18位精度）
//     * @return adminFeeAmount 管理费数量（18位精度）
//     * @return lpFeeAmount LP提供者获得的费用（18位精度）
//     * @return priceImpact 价格影响（基点，100 = 1%）
//     * @return isValid 交易是否有效
//     */
//     function previewSwapUsdcToStable(uint256 usdcAmountIn) 
//         external 
//         view 
//         returns (
//             uint256 stableAmountOut,
//             uint256 tradingFee,
//             uint256 adminFeeAmount,
//             uint256 lpFeeAmount, 
//             uint256 priceImpact,
//             bool isValid
//         )
//     {
//         // ✅ 基本验证
//         if (usdcAmountIn == 0) {
//             return (0, 0, 0, 0, 0, false);
//         }
        
//         // ✅ 获取当前池状态
//         uint256 stableBalanceBefore = stableBalance;
//         uint256 usdcBalanceBefore = usdcBalance;
        
//         // 检查池子是否有足够的StableToken
//         if (stableBalanceBefore == 0) {
//             return (0, 0, 0, 0, 0, false);
//         }
        
//         // ✅ 计算交易前的D值
//         uint256 DBefore = getD();
//         if (DBefore == 0) {
//             return (0, 0, 0, 0, 0, false);
//         }
        
//         // ✅ 将USDC输入标准化为18位精度
//         uint256 usdcAmountInNormalized = usdcAmountIn * 1e12;
        
//         // ✅ 模拟添加USDC后的状态
//         uint256 usdcBalanceAfter = usdcBalanceBefore + usdcAmountInNormalized;
        
//         // ✅ 使用StableSwap算法计算新的StableToken余额
//         uint256 stableBalanceAfter = getY(usdcBalanceAfter, DBefore);
        
//         // ✅ 手动检查结果有效性
//         if (stableBalanceAfter == 0 || stableBalanceAfter >= stableBalanceBefore) {
//             return (0, 0, 0, 0, 0, false);
//         }

        
//         // ✅ 检查计算结果是否合理
//         if (stableBalanceAfter >= stableBalanceBefore) {
//             return (0, 0, 0, 0, 0, false); // StableToken余额不应该增加
//         }
        
//         // ✅ 计算输出量和费用
//         uint256 stableOutputBeforeFee = stableBalanceBefore - stableBalanceAfter;
        
//         // 检查输出量是否合理
//         if (stableOutputBeforeFee == 0 || stableOutputBeforeFee > stableBalanceBefore) {
//             return (0, 0, 0, 0, 0, false);
//         }
        
//         // ✅ 计算费用结构（与原函数完全一致）
//         tradingFee = stableOutputBeforeFee * fee / BASISPOINT;
//         adminFeeAmount = tradingFee * adminFee / BASISPOINT;
//         lpFeeAmount = tradingFee - adminFeeAmount;
        
//         // ✅ 计算最终输出（已经是18位精度，无需转换）
//         stableAmountOut = stableOutputBeforeFee - tradingFee;
        
//         // ✅ 计算价格影响
//         priceImpact = _calculateSwapPriceImpact(
//             usdcAmountInNormalized,
//             stableOutputBeforeFee,
//             usdcBalanceBefore,
//             stableBalanceBefore,
//             false // usdcToStable
//         );
        
//         // ✅ 最终验证
//         isValid = (stableAmountOut > 0 && priceImpact <= 5000); // 最大50%价格影响
//     }

//     /**
//     * @dev 计算交易的价格影响（内部辅助函数）
//     * @param amountIn 输入数量
//     * @param amountOutBeforeFee 费用前的输出数量
//     * @param balanceIn 输入代币的池余额
//     * @param balanceOut 输出代币的池余额
//     * @param isStableToUsdc 是否为stable到usdc的交易
//     * @return priceImpact 价格影响（基点，10000 = 100%）
//     */
//     function _calculateSwapPriceImpact(
//         uint256 amountIn,
//         uint256 amountOutBeforeFee,
//         uint256 balanceIn,
//         uint256 balanceOut,
//         bool isStableToUsdc
//     ) internal pure returns (uint256 priceImpact) {
//         if (balanceIn == 0 || balanceOut == 0 || amountIn == 0) {
//             return 0;
//         }
        
//         // ✅ 计算当前现货价格（简化版本）
//         uint256 currentSpotPrice = balanceOut * PRECISION / balanceIn;
        
//         // ✅ 计算实际交易价格
//         uint256 actualTradePrice = amountOutBeforeFee * PRECISION / amountIn;
        
//         // ✅ 计算价格影响
//         if (currentSpotPrice > actualTradePrice) {
//             priceImpact = (currentSpotPrice - actualTradePrice) * 10000 / currentSpotPrice;
//         } else {
//             // 对于StableSwap，通常交易价格应该低于现货价格
//             priceImpact = (actualTradePrice - currentSpotPrice) * 10000 / currentSpotPrice;
//         }
        
//         // ✅ 限制最大价格影响显示为10000基点（100%）
//         if (priceImpact > 10000) {
//             priceImpact = 10000;
//         }
//     }


//     /**
//     * @dev 杠杆代币 -> USDC  
//     * 原理：用户leverage + 池中stable -> 合并成underlying -> DEX卖出 -> 给用户等值USDC
//     * 本質上是通過調用merge函數來注銷S & L token實現的！
//     */
//     function swapLeverageToUsdc(
//         uint256 leverageTokenId, 
//         uint256 lAmountPercentage // 賣出L币的百分比, 需要大於1%, 否则无法賣出； 這裏的1表示1%
//     ) external nonReentrant returns (
//         uint256 usdcAmountToUser)
//     {
//         //  // 获取最新价格
//         // (uint underlyingPriceInWei, ,bool isValid) = custodian.getLatestPriceView();
//         // require(isValid, "Invalid price");

//         //------------------第一步： 計算需要多少S token來合并------------------------
//         (   ,
//             uint256 stableAmountOut,
//             ,,,
//         ) = custodian.previewBurn(leverageTokenId, lAmountPercentage, msg.sender, 0);
//         require(stableAmountOut > 0, "No S token needed");

//          //------------------第二步： 計算需要支付給AMM池的USDC數量---------------------
//         // ✅ 记录交易前状态
//         uint256 stableBalanceBefore = stableBalance;
//         uint256 usdcBalanceBefore = usdcBalance;
//         uint256 DBefore = getD();
        
//         // ✅ 计算理论输出（基于当前D值）
//         uint256 stableBalanceAfter = stableBalanceBefore - stableAmountOut;
//         uint256 usdcBalanceAfter = getY(
//             stableBalanceAfter,
//             DBefore
//         );
        
//         // ✅ 计算存入的USDC
//         uint256 usdcInput = usdcBalanceAfter - usdcBalanceBefore; //需要存入AMM的USDC數量，這裏是18位
//         uint256 tradingFee = usdcInput * fee / BASISPOINT; // 4/10000 = 万四手续费
//         uint256 adminFeeAmount = tradingFee * adminFee / BASISPOINT; //5000/10000 = 50% 的手續費給管理員
//         uint256 lpFeeAmount = tradingFee - adminFeeAmount;  // ✅ LP提供者获得的费用
    
//         //------------------第三步： 合并注銷，並獲取抵押物------------------------
//         //下面的函數執行成功的話，説明執行了以下操作：
//         //  1. burn 用戶 的 L token (✅)
//         //  2. burn AMM  的 S token (✅)
//         //  3. 扣除利息的抵押物轉移到了AMM池(✅)
//         //  4. 利息以部分抵押的形式留存在了custodian中(✅)
//         (uint256 underlyingAmountRedeemedInWei, 
//          uint256 stableTokenBurnedInWei, 
//          uint256 leverageTokenBurnedInWei) 
//             = custodian.burn(address(this),address(this), msg.sender, leverageTokenId, lAmountPercentage);
//         require(underlyingAmountRedeemedInWei > 0, "No underlying to redeem");
//         stableBalance = stableBalance - stableTokenBurnedInWei; //更新AMM池中的stable餘額

//         //------------------第四步： DEX賣出抵押物，獲取USDC------------------------
//         //在DEX上卖出underlying获取USDC, 這裏的USDC單位是什麽？是Wei嗎?還是1e6? 應該是1e6!
//         uint256 usdcAmountOut = _sellUnderlyingOnDEX(underlyingAmountRedeemedInWei); //AMM池收到的USDC數量，這裏是6位
//         require(usdcAmountOut > 0, "No USDC to receive");

//         //------------------第五步： USDC分配------------------------
//         uint256 usdcAmountToAMM = (usdcInput + tradingFee) / 1e12; // 進入AMM的USDC = 算法決定量+ 手續費；單位轉化為1e6
//         usdcAmountToUser = usdcAmountOut - usdcAmountToAMM;
//         usdc.safeTransfer(msg.sender, usdcAmountToUser);//給用戶; 其餘的留在AMM池中
//         //更新AMM池中的USDC餘額
//         usdcBalance = usdcBalance + usdcInput + tradingFee - adminFeeAmount; 
//         //增加管理費用
//         adminUsdcBalance += adminFeeAmount;

//         // ✅ 可选：超过阈值时自动提取
//         _checkAutoWithdraw();
        
//         emit SwapLeverageToUsdc(msg.sender, leverageTokenId, lAmountPercentage, usdcAmountToUser);

//     }    

//     //========================費用管理相關函數========================
//     /**
//      * @dev 设置费用收集器地址
//      */
//     function setFeeCollector(address _feeCollector) external onlyOwner {
//         require(_feeCollector != address(0), "Invalid fee collector");
        
//         address oldCollector = feeCollector;
//         feeCollector = _feeCollector;
        
//         emit FeeCollectorUpdated(oldCollector, _feeCollector);
//     }

//         /**
//      * @dev 主動提取所有管理费到指定地址
//      */
//     function withdrawAdminFees() external onlyOwner returns (uint256 stableAmount, uint256 usdcAmount) {
//         stableAmount = adminStableBalance;
//         usdcAmount = adminUsdcBalance;
        
//         if (stableAmount > 0) {
//             adminStableBalance = 0;
//             stableToken.transfer(feeCollector, stableAmount);
//             emit FeeCollected(address(stableToken), stableAmount);
//         }
        
//         if (usdcAmount > 0) {
//             adminUsdcBalance = 0;
//             uint256 usdcAmountActual = usdcAmount / 1e12;
//             usdc.safeTransfer(feeCollector, usdcAmountActual);
//             emit FeeCollected(address(usdc), usdcAmount);
//         }
//     }

//       /**
//      * @dev 检查是否需要自动提取费用
//      */
//     function _checkAutoWithdraw() internal {
//         uint256 totalFeesNormalized = adminStableBalance + adminUsdcBalance;
        
//         if (totalFeesNormalized >= AUTO_WITHDRAW_THRESHOLD) {
//             _autoWithdrawFees();
//         }
//     }
    
//     /**
//      * @dev 自动提取费用（内部函数）
//      */
//     function _autoWithdrawFees() internal {
//         uint256 stableAmount = adminStableBalance;
//         uint256 usdcAmount = adminUsdcBalance;
        
//         if (stableAmount > 0) {
//             adminStableBalance = 0;
//             stableToken.transfer(feeCollector, stableAmount);
//         }
        
//         if (usdcAmount > 0) {
//             adminUsdcBalance = 0;
//             uint256 usdcAmountActual = usdcAmount / 1e12;
//             usdc.safeTransfer(feeCollector, usdcAmountActual);
//         }
        
//         emit AutoFeeWithdraw(stableAmount, usdcAmount);
//     }
    
//     /**
//      * @dev 手动触发自动提取
//      */
//     function triggerFeeWithdraw() external {
//         require(
//             msg.sender == owner() || msg.sender == feeCollector,
//             "Unauthorized"
//         );
//         _autoWithdrawFees();
//     }


//     // ============= 流动性管理 =============
    
//     /**
//     * @dev 添加流动性（严格平衡模式）
//     */
//     function addLiquidityBalanced(
//         uint256 stableAmount,
//         uint256 usdcAmount,
//         uint256 minLpTokens
//     ) external nonReentrant returns (uint256 lpTokens) {
//         require(stableAmount > 0 && usdcAmount > 0, "Amounts must be positive");
        
//         uint256 usdcAmountNormalized = usdcAmount * 1e12;
//         uint256 totalSupply = lpToken.totalSupply();
        
//         if (totalSupply == 0) {
//             // ✅ 初始流动性要求1:1比例
//             require(stableAmount == usdcAmountNormalized, "Initial liquidity must be 1:1");
//             lpTokens = stableAmount + usdcAmountNormalized;
//         } else {
//             // ✅ 后续添加必须按现有比例
//             uint256 stableRatio = stableAmount * PRECISION / stableBalance;
//             uint256 usdcRatio = usdcAmountNormalized * PRECISION / usdcBalance;
            
//             // 允许小幅偏差（例如1%）
//             uint256 maxDeviation = PRECISION / 100; // 1%
//             require(
//                 stableRatio >= usdcRatio ? 
//                     stableRatio - usdcRatio <= maxDeviation : 
//                     usdcRatio - stableRatio <= maxDeviation,
//                 "Imbalanced liquidity addition"
//             );
            
//             // 使用较小的比例计算LP代币
//             uint256 minRatio = stableRatio < usdcRatio ? stableRatio : usdcRatio;
//             lpTokens = totalSupply * minRatio / PRECISION;
//         }
        
//         require(lpTokens >= minLpTokens, "Insufficient LP tokens");
        
//         // 转移代币
//         stableToken.transferFrom(msg.sender, address(this), stableAmount);
//         usdc.transferFrom(msg.sender, address(this), usdcAmount);
        
//         // 更新余额
//         stableBalance += stableAmount;
//         usdcBalance += usdcAmountNormalized;
        
//         // 铸造 LP 代币
//         lpToken.mint(msg.sender, lpTokens);
        
//         emit AddLiquidity(msg.sender, stableAmount, usdcAmount, lpTokens);
//     }
   
//     /**
//     * @dev 移除流动性（平衡模式 - 按池中比例移除）
//     */
//     function removeLiquidityBalanced(
//         uint256 lpTokens,
//         uint256 minStableAmount,
//         uint256 minUsdcAmount
//     ) external nonReentrant returns (uint256 stableAmount, uint256 usdcAmount) {
//         require(lpTokens > 0, "LP tokens must be positive");
//         require(lpToken.balanceOf(msg.sender) >= lpTokens, "Insufficient LP tokens");
        
//         uint256 totalSupply = lpToken.totalSupply();
//         require(totalSupply > 0, "No liquidity to remove");
        
//         // ✅ 按当前池中比例计算可提取的代币数量（强制平衡）
//         stableAmount = stableBalance * lpTokens / totalSupply;
//         uint256 usdcAmountNormalized = usdcBalance * lpTokens / totalSupply;
//         usdcAmount = usdcAmountNormalized / 1e12;  // 转换回 6 位精度
        
//         // ✅ 验证输出量满足最小要求
//         require(stableAmount >= minStableAmount, "Insufficient StableToken output");
//         require(usdcAmount >= minUsdcAmount, "Insufficient USDC output");
        
//         // ✅ 验证移除比例的合理性（防止过度移除）
//         uint256 removalRatio = lpTokens * PRECISION / totalSupply;
//         require(removalRatio <= PRECISION, "Cannot remove more than 100%");
        
//         // ✅ 更新余额
//         stableBalance -= stableAmount;
//         usdcBalance -= usdcAmountNormalized;
        
//         // ✅ 销毁 LP 代币
//         lpToken.burn(msg.sender, lpTokens);
        
//         // ✅ 转移代币给用户
//         stableToken.transfer(msg.sender, stableAmount);
//         usdc.transfer(msg.sender, usdcAmount);
        
//         emit RemoveLiquidity(msg.sender, stableAmount, usdcAmount, lpTokens);
//     }
//     // ============= 查询函数 =============
    
//     /**
//      * @dev 获取池状态信息
//      */
//     function getPoolInfo() external view returns (
//         uint256 _stableBalance,
//         uint256 _usdcBalance,
//         uint256 _totalLpSupply,
//         uint256 _A,
//         uint256 _fee,
//         uint256 _D
//     ) {
//         return (
//             stableBalance,
//             usdcBalance / 1e12, // 转换回 6 位精度显示
//             lpToken.totalSupply(),
//             A,
//             fee,
//             getD()
//         );
//     }
    
//     /**
//      * @dev 计算添加流动性时的 LP 代币数量
//      */
//     function calcLpTokens(uint256 stableAmount, uint256 usdcAmount) external view returns (uint256) {
//         if (stableAmount == 0 || usdcAmount == 0) return 0;
        
//         uint256 totalSupply = lpToken.totalSupply();
//         if (totalSupply == 0) {
//             return stableAmount + usdcAmount * 1e12;
//         }
        
//         uint256 d0 = getD();
//         uint256 d1 = getD(); // 需要模拟添加后的状态
//         // 简化计算，实际应该模拟添加流动性后的 D 值
        
//         return totalSupply * stableAmount / stableBalance; // 简化版本
//     }

//     // ============= 管理员函数 =============
    
//     /**
//      * @dev 设置费率
//      */
//     function setFee(uint256 newFee, uint256 newAdminFee) external onlyOwner {
//         require(newFee <= MAX_FEE, "Fee too high");
        
//         fee = newFee;
//         adminFee = newAdminFee;
        
//         emit FeeUpdated(newFee, newAdminFee);
//     }
    
//     /**
//      * @dev 设置放大系数
//      */
//     function setA(uint256 newA) external onlyOwner {
//         require(newA > 0 && newA <= 10000, "Invalid A value");
        
//         A = newA * A_PRECISION;
        
//         emit AUpdated(newA);
//     }
    
    
//     /**
//      * @dev 紧急提取（仅在紧急情况下使用）
//      */
//     function emergencyWithdraw() external onlyOwner {
//         uint256 stableAmount = stableToken.balanceOf(address(this));
//         uint256 usdcAmount = usdc.balanceOf(address(this));
        
//         if (stableAmount > 0) {
//             stableToken.transfer(owner(), stableAmount);
//         }
        
//         if (usdcAmount > 0) {
//             usdc.safeTransfer(owner(), usdcAmount);
//         }
        
//         // 重置余额
//         stableBalance = 0;
//         usdcBalance = 0;
//         adminStableBalance = 0;
//         adminUsdcBalance = 0;
//     }


//     /**
//     * @dev 在Uniswap V3上购买underlying资产
//     * @param usdcAmount USDC数量 (6位精度)
//     * @return underlyingAmount 获得的underlying数量
//     */
//     function _buyUnderlyingOnDEX(uint256 usdcAmount) internal returns (uint256 underlyingAmount) {
//         require(usdcAmount > 0, "Invalid USDC amount");
//         require(dexRouter != address(0), "DEX router not set");
        
//         IUniswapV3Router router = IUniswapV3Router(dexRouter);
        
//         // ✅ 1. 使用Quoter获取预期输出量
//         uint256 expectedOut;
//         try IQuoter(quoter).quoteExactInputSingle(
//             address(usdc),
//             address(underlyingToken),
//             poolFee,
//             usdcAmount,
//             0 // sqrtPriceLimitX96 = 0 表示无价格限制
//         ) returns (uint256 amountOut) {
//             expectedOut = amountOut;
//         } catch {
//             revert("Failed to get V3 quote");
//         }
        
//         require(expectedOut > 0, "Invalid V3 quote");
        
//         // ✅ 2. 计算最小输出量（考虑滑点）
//         uint256 minAmountOut = expectedOut * (10000 - leverageSlippageTolerance) / 10000;
        
//         // ✅ 3. 授权Router使用USDC
//         uint256 currentAllowance = usdc.allowance(address(this), dexRouter);
//         if (currentAllowance < usdcAmount) {
//             if (currentAllowance > 0) {
//                 usdc.approve(dexRouter, 0);
//             }
//             usdc.approve(dexRouter, usdcAmount);
//         }
        
//         // ✅ 4. 记录交易前余额
//         uint256 underlyingBefore = underlyingToken.balanceOf(address(this));
        
//         // ✅ 5. 执行V3交易
//         IUniswapV3Router.ExactInputSingleParams memory params = IUniswapV3Router.ExactInputSingleParams({
//             tokenIn: address(usdc),
//             tokenOut: address(underlyingToken),
//             fee: poolFee,
//             recipient: address(this),
//             deadline: block.timestamp + 600, // 10分钟过期
//             amountIn: usdcAmount,
//             amountOutMinimum: minAmountOut,
//             sqrtPriceLimitX96: 0 // 无价格限制
//         });
        
//         try router.exactInputSingle(params) returns (uint256 amountOut) {
//             underlyingAmount = amountOut;
//         } catch Error(string memory reason) {
//             revert(string(abi.encodePacked("V3 swap failed: ", reason)));
//         } catch {
//             revert("V3 swap failed: Unknown error");
//         }
        
//         // ✅ 6. 验证实际收到的数量
//         uint256 underlyingAfter = underlyingToken.balanceOf(address(this));
//         uint256 actualReceived = underlyingAfter - underlyingBefore;
//         require(actualReceived >= minAmountOut, "Insufficient tokens received");
//         require(actualReceived == underlyingAmount, "Amount mismatch");
        
//         // ✅ 7. 计算实际滑点
//         uint256 actualSlippage = expectedOut > actualReceived ? 
//             (expectedOut - actualReceived) * 10000 / expectedOut : 0;
        
//         // ✅ 8. 重置授权
//         usdc.approve(dexRouter, 0);
        
//         emit DEXTradeExecuted(true, usdcAmount, underlyingAmount, actualSlippage);
//     }

//     /**
//     * @dev 在Uniswap V3上卖出underlying资产
//     * @param underlyingAmount underlying数量
//     * @return usdcAmount 获得的USDC数量 (6位精度)
//     */
//     function _sellUnderlyingOnDEX(uint256 underlyingAmount) internal returns (uint256 usdcAmount) {
//         require(underlyingAmount > 0, "Invalid underlying amount");
//         require(dexRouter != address(0), "DEX router not set");
        
//         IUniswapV3Router router = IUniswapV3Router(dexRouter);
        
//         // ✅ 1. 使用Quoter获取预期输出量
//         uint256 expectedOut;
//         try IQuoter(quoter).quoteExactInputSingle(
//             address(underlyingToken),
//             address(usdc),
//             poolFee,
//             underlyingAmount,
//             0
//         ) returns (uint256 amountOut) {
//             expectedOut = amountOut;
//         } catch {
//             revert("Failed to get V3 quote");
//         }
        
//         require(expectedOut > 0, "Invalid V3 quote");
        
//         // ✅ 2. 计算最小输出量（考虑滑点）
//         uint256 minAmountOut = expectedOut * (10000 - leverageSlippageTolerance) / 10000;
        
//         // ✅ 3. 授权Router使用underlying token
//         uint256 currentAllowance = underlyingToken.allowance(address(this), dexRouter);
//         if (currentAllowance < underlyingAmount) {
//             if (currentAllowance > 0) {
//                 underlyingToken.approve(dexRouter, 0);
//             }
//             underlyingToken.approve(dexRouter, underlyingAmount);
//         }
        
//         // ✅ 4. 记录交易前余额
//         uint256 usdcBefore = usdc.balanceOf(address(this));
        
//         // ✅ 5. 执行V3交易
//         IUniswapV3Router.ExactInputSingleParams memory params = IUniswapV3Router.ExactInputSingleParams({
//             tokenIn: address(underlyingToken),
//             tokenOut: address(usdc),
//             fee: poolFee,
//             recipient: address(this),
//             deadline: block.timestamp + 600,
//             amountIn: underlyingAmount,
//             amountOutMinimum: minAmountOut,
//             sqrtPriceLimitX96: 0
//         });
        
//         try router.exactInputSingle(params) returns (uint256 amountOut) {
//             usdcAmount = amountOut;
//         } catch Error(string memory reason) {
//             revert(string(abi.encodePacked("V3 swap failed: ", reason)));
//         } catch {
//             revert("V3 swap failed: Unknown error");
//         }
        
//         // ✅ 6. 验证实际收到的数量
//         uint256 usdcAfter = usdc.balanceOf(address(this));
//         uint256 actualReceived = usdcAfter - usdcBefore;
//         require(actualReceived >= minAmountOut, "Insufficient tokens received");
//         require(actualReceived == usdcAmount, "Amount mismatch");
        
//         // ✅ 7. 计算实际滑点
//         uint256 actualSlippage = expectedOut > actualReceived ? 
//             (expectedOut - actualReceived) * 10000 / expectedOut : 0;
        
//         // ✅ 8. 重置授权
//         underlyingToken.approve(dexRouter, 0);
        
//         emit DEXTradeExecuted(false, underlyingAmount, usdcAmount, actualSlippage);
//     }

//     /**
//     * @dev 获取V3 DEX价格报价 (USDC -> Underlying)
//     */
//     function getUsdcToUnderlyingQuote(uint256 usdcAmount) 
//         external returns (uint256 underlyingAmount, uint256 priceImpact) 
//     {
//         require(quoter != address(0), "Quoter not set");
        
//         if (usdcAmount == 0) return (0, 0);
        
//         try IQuoter(quoter).quoteExactInputSingle(
//             address(usdc),
//             address(underlyingToken),
//             poolFee,
//             usdcAmount,
//             0
//         ) returns (uint256 amountOut) {
//             underlyingAmount = amountOut;
            
//             // V3价格影响计算
//             priceImpact = _calculateV3PriceImpact(usdcAmount, underlyingAmount, true);
//         } catch {
//             return (0, 0);
//         }
//     }

//     /**
//     * @dev 获取V3 DEX价格报价 (Underlying -> USDC) 
//     */
//     function getUnderlyingToUsdcQuote(uint256 underlyingAmount) 
//         external returns (uint256 usdcAmount, uint256 priceImpact) 
//     {
//         require(quoter != address(0), "Quoter not set");
        
//         if (underlyingAmount == 0) return (0, 0);
        
//         try IQuoter(quoter).quoteExactInputSingle(
//             address(underlyingToken),
//             address(usdc),
//             poolFee,
//             underlyingAmount,
//             0
//         ) returns (uint256 amountOut) {
//             usdcAmount = amountOut;
            
//             // V3价格影响计算
//             priceImpact = _calculateV3PriceImpact(underlyingAmount, usdcAmount, false);
//         } catch {
//             return (0, 0);
//         }
//     }

//     /**
//     * @dev 计算V3的价格影响
//     */
//     function _calculateV3PriceImpact(
//         uint256 amountIn, 
//         uint256 amountOut, 
//         bool isUsdcToUnderlying
//     ) internal view returns (uint256 priceImpact) {
//         if (usdcUnderlyingPool == address(0)) return 0;
        
//         try IUniswapV3Pool(usdcUnderlyingPool).slot0() returns (
//             uint160 sqrtPriceX96,
//             int24,
//             uint16,
//             uint16,
//             uint16,
//             uint8,
//             bool
//         ) {
//             // 从sqrtPriceX96计算当前价格
//             uint256 price = _sqrtPriceX96ToPrice(sqrtPriceX96, isUsdcToUnderlying);
            
//             // 计算理想输出量（按当前价格）
//             uint256 idealAmountOut = amountIn * price / (10 ** 18);
            
//             if (idealAmountOut > amountOut) {
//                 priceImpact = (idealAmountOut - amountOut) * 10000 / idealAmountOut;
//             }
//         } catch {
//             return 0;
//         }
//     }

//     /**
//     * @dev 将sqrtPriceX96转换为价格
//     */
//     function _sqrtPriceX96ToPrice(uint160 sqrtPriceX96, bool isUsdcToUnderlying) 
//         internal view returns (uint256 price) 
//     {
//         // V3价格计算：price = (sqrtPriceX96 / 2^96)^2
//         uint256 priceX192 = uint256(sqrtPriceX96) ** 2;
        
//         // 根据代币顺序调整价格
//         IUniswapV3Pool pool = IUniswapV3Pool(usdcUnderlyingPool);
//         address token0 = pool.token0();
        
//         if (isUsdcToUnderlying) {
//             if (token0 == address(usdc)) {
//                 // token0 = USDC, token1 = Underlying
//                 // price = token1/token0 = underlying/usdc
//                 price = priceX192 / (2 ** 192);
//             } else {
//                 // token0 = Underlying, token1 = USDC
//                 // price = token0/token1 = underlying/usdc
//                 price = (2 ** 192) / priceX192;
//             }
//         } else {
//             if (token0 == address(underlyingToken)) {
//                 // token0 = Underlying, token1 = USDC
//                 // price = token1/token0 = usdc/underlying
//                 price = priceX192 / (2 ** 192);
//             } else {
//                 // token0 = USDC, token1 = Underlying
//                 // price = token0/token1 = usdc/underlying  
//                 price = (2 ** 192) / priceX192;
//             }
//         }
        
//         // 调整精度差异 (USDC=6位, Underlying通常=18位)
//         if (isUsdcToUnderlying) {
//             price = price * (10 ** 12); // 6位 -> 18位
//         } else {
//             price = price / (10 ** 12); // 18位 -> 6位
//         }
//     }


// }