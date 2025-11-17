// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./tokens/MultiLeverageToken.sol";
import "./Types.sol";

/**
 * @title Constant InterestManager
 * @dev 固定利率的利息管理合约
 * @notice 使用常数年化利率，简化计算逻辑
 */
contract InterestManager is Ownable, ReentrancyGuard {

    // ================= 常量定义 =================
    
    uint256 public constant BASIS_POINTS = 10000;           // 基点：100% = 10000
    uint256 public constant SECONDS_PER_YEAR = 365 days;    // 一年的秒数
    uint256 public constant MAX_INTEREST_RATE = 5000;       // 最大年利率 50%
    uint256 public constant MIN_HOLDING_TIME = 1 hours;     // 最短持有时间
    uint256 public constant PRECISION = 1e18;               // 18位精度
    
    // ================= 核心合约引用 =================
    
    IERC20 public immutable underlyingToken;               // 标的资产 (LTC)
    MultiLeverageToken public leverageToken;               // 杠杆代币合约
    address public custodian;                              // Custodian合约地址
    
    // ================= 利率配置 =================
    
    uint256 public annualInterestRate;                     // 年化利率 (基点，500 = 5%)
    bool public initialized = false;                       // 初始化状态
    
    // ================= 利息统计 =================
    
    uint256 public totalInterestAccrued;                   // 累计产生的利息，利息實時產生，但是該值一般在該用戶merge或新開倉時更新, 否則gas太高
    uint256 public totalInterestCollected;                 // 累计收取的利息，從用戶處transfer到InterestManager合約的資產
    uint256 public totalInterestWithdrawn;                 // 累计提取的利息，从InterestManager处理transfer到feeCollector個人的資產
    uint256 public totalActivePositions;                   // 活跃持仓数量
    uint256 public totalLeverageAmount;                    // 总杠杆金额
    
    // ================= 用户持仓数据 =================
    
    struct UserPosition {
        uint256 lAmountInWei;          // 杠杆代币数量
        uint256 timestamp;             // 最后更新时间
        uint256 accruedInterest;       // 累计未收取利息
        bool active;                   // 是否活跃
    }
    
    mapping(address => mapping(uint256 => UserPosition)) public userPositions;
    
    // ================= 事件定义 =================
    
    event ContractInitialized(address indexed leverageToken, address indexed custodian);
    event PositionOpened(address indexed user, uint256 indexed tokenId, uint256 amount, uint256 timestamp);
    event PositionIncreased(address indexed user, uint256 indexed tokenId, uint256 amount, uint256 totalAmount, uint256 totalInterest);
    event PositionClosed(address indexed user, uint256 indexed tokenId, uint256 amount);
    event InterestAccrued(address indexed user, uint256 indexed tokenId, uint256 interestAmount);
    event InterestCollected(address indexed user, uint256 indexed tokenId, uint256  deductLAmountInWei, uint256 interestAmount); // modified by jintao
    event InterestRateChanged(uint256 oldRate, uint256 newRate);
    event InterestWithdrawn(address indexed to, uint256 amount);
    event SystemStatsUpdated(uint256 totalAccrued, uint256 totalCollected, uint256 activePositions);

    // ================= 修饰符 =================
    
    modifier validAddress(address addr) {
        require(addr != address(0), "Invalid address");
        _;
    }
    
    modifier onlyInitialized() {
        require(initialized, "Contract not initialized");
        _;
    }
    
    modifier onlyCustodian() {
        require(msg.sender == custodian, "Only custodian can call");
        _;
    }

    // ================= 构造函数 =================
    
    constructor(
        address _underlyingToken,
        uint256 _annualInterestRate //300表示3%
    ) Ownable(msg.sender) validAddress(_underlyingToken) {
        underlyingToken = IERC20(_underlyingToken);
        annualInterestRate = _annualInterestRate;
        emit InterestRateChanged(0, _annualInterestRate); //added by jintao
    }

    // ================= 初始化函数 =================
    
    /**
     * @dev 初始化合约，设置关联的合约地址
     */
    function initialize(
        address _leverageToken,
        address _custodian
    ) external onlyOwner validAddress(_leverageToken) validAddress(_custodian) {
        require(!initialized, "Already initialized");
        
        leverageToken = MultiLeverageToken(_leverageToken);
        custodian = _custodian;
        initialized = true;
        
        emit ContractInitialized(_leverageToken, _custodian);
    }

    // ================= 核心业务函数 =================
    
    /**
     * @dev 记录用户持仓（由Custodian调用, 用戶split鑄幣時調用， 開始起息）
     * @param user 用户地址
     * @param leverageTokenId 杠杆代币ID
     * @param lAmountInWei 杠杆代币数量
     */
    function recordPosition(
        address user, 
        uint256 leverageTokenId, 
        uint256 lAmountInWei
    ) external onlyCustodian onlyInitialized validAddress(user) {
        
        require(lAmountInWei > 0, "Invalid amount");
        
        UserPosition storage position = userPositions[user][leverageTokenId];
        
        if (position.lAmountInWei == 0) {
            // 新开仓
            position.lAmountInWei = lAmountInWei;
            position.timestamp = block.timestamp;
            position.accruedInterest = 0;
            position.active = true;
            
            // 更新系统统计
            totalActivePositions += 1;
            totalLeverageAmount += lAmountInWei;
            
            emit PositionOpened(user, leverageTokenId, lAmountInWei, block.timestamp);
        } else {
            // 增加持仓 - 先计算之前的累计利息; 更新totalInterestAccrued, 但是利息不轉移到當前InterestManager合约!!!
            uint256 newAccruedInterest = _calculateAccruedInterest(
                position.lAmountInWei, 
                annualInterestRate,
                block.timestamp - position.timestamp,
                leverageTokenId
            );
            
            position.accruedInterest += newAccruedInterest;
            position.lAmountInWei += lAmountInWei;
            position.timestamp = block.timestamp;  // 重置时间戳
            
            // 更新系统统计
            totalInterestAccrued += newAccruedInterest;
            totalLeverageAmount += lAmountInWei;
            
            emit PositionIncreased(user, leverageTokenId, lAmountInWei, position.lAmountInWei, position.accruedInterest); //modified by jintao
            emit InterestAccrued(user, leverageTokenId, newAccruedInterest);
        }
    }

    /**
     * @dev 更新纍計應付利息並更新totalInterestAccrued。计算并返回用户的累计利息; 在custodian中的merge函数中调用, 用戶計算用戶纍計應付利息金額
     * @param user 用户地址
     * @param leverageTokenId 杠杆代币ID
     * @return 累计利息金额
     */
    function totalAccruedInterest(
        address user, 
        uint256 leverageTokenId 
    ) external onlyCustodian onlyInitialized validAddress(user) returns (uint256) {
        
        UserPosition storage position = userPositions[user][leverageTokenId];
        
        if (position.lAmountInWei > 0 && position.active) {
            // 计算从上次更新到现在的新利息
            uint256 newAccruedInterest = _calculateAccruedInterest(
                position.lAmountInWei, 
                annualInterestRate,
                block.timestamp - position.timestamp, 
                leverageTokenId
            );
            
            // 更新持仓数据
            position.accruedInterest += newAccruedInterest;
            position.timestamp = block.timestamp;
            
            // 更新系统统计
            totalInterestAccrued += newAccruedInterest;
            
            if (newAccruedInterest > 0) {
                emit InterestAccrued(user, leverageTokenId, newAccruedInterest);
            }
        }
        
        return position.accruedInterest;
    }

    /**
     * @dev 從用戶賬戶扣除利息並更新totalInterestCollected。在custodian中的merge函数中调用, 用戶計算用戶檔次實際支付的利息金額；該金額會被轉到InterestManager合约.
     * @param user 用户地址
     * @param leverageTokenId 杠杆代币ID
     * @param deductInterestInWei 扣除的利息金额
     * @param deductLAmountInWei 扣除的杠杆代币金额
     */
    function updateUserPosition(
        address user, 
        uint256 leverageTokenId,
        uint256 deductInterestInWei,
        uint256 deductLAmountInWei
    ) external onlyCustodian onlyInitialized validAddress(user) {

        UserPosition storage position = userPositions[user][leverageTokenId];
        
        if (position.lAmountInWei > 0) {
            // 限制扣除金额不能超过累计利息
            if (deductInterestInWei > position.accruedInterest) {
                deductInterestInWei = position.accruedInterest;
            }
            
            // 更新用户持仓
            position.accruedInterest -= deductInterestInWei;
            position.lAmountInWei -= deductLAmountInWei;
            
            // 如果持仓归零，标记为不活跃
            if (position.lAmountInWei == 0) {
                position.active = false;
                totalActivePositions -= 1;
            }
            
            // 更新系统统计
            totalInterestCollected += deductInterestInWei;
            totalLeverageAmount -= deductLAmountInWei;
            
            emit InterestCollected(user, leverageTokenId, deductLAmountInWei, deductInterestInWei); // modified by jintao
            
            if (position.lAmountInWei == 0) {
                emit PositionClosed(user, leverageTokenId, deductLAmountInWei);
            }
        }
    }
    /**
     * @dev 内部函数：计算累积利息, 單位為Wei
     */
    function _calculateAccruedInterest(
        uint256 lAmountInWei,//持有杠桿幣的數量
        uint256 interestRate,//年化利率
        uint256 holdingTimeInSeconds,//持有的時間
        uint256 leverageTokenId //杠杆代币ID,用來確定按照哪種水平計算利息，一份token, 杠桿越高利息越高
    ) internal view returns (uint256) {

        // 确定支付利息标准
        (LeverageType leverage,,,,) = leverageToken.getTokenInfo(leverageTokenId);

        // 计算年化利息：本金 × 年利率 × 持有时间比例（InWei）
        uint256 accruedInterest = (lAmountInWei * interestRate * holdingTimeInSeconds) / 
                                   (BASIS_POINTS * SECONDS_PER_YEAR);
        
        if (leverage == LeverageType.CONSERVATIVE) { 
            accruedInterest = accruedInterest/8;
        }
        else if (leverage == LeverageType.MODERATE) { 
            accruedInterest = accruedInterest/4;
        }
        else if (leverage == LeverageType.AGGRESSIVE) { 
        }
        return accruedInterest;
    }

    /**
     * @dev 提取系统收取的利息
     * @param to 接收地址
     * @param amount 提取金额
     */
    function withdrawInterest(address to, uint256 amount) external onlyOwner validAddress(to) nonReentrant {
        // 检查可提取余额
        uint256 availableAmount = totalInterestCollected - totalInterestWithdrawn;
        require(amount <= availableAmount, "Insufficient interest balance");
        
        // 更新提取统计
        totalInterestWithdrawn += amount;
        
        // 执行转账
        require(underlyingToken.transfer(to, amount), "Transfer failed");
        
        emit InterestWithdrawn(to, amount);
    }
    
    /**
     * @dev 紧急提取所有可用利息
     * @param to 接收地址
     */
    function emergencyWithdrawInterest(address to) external onlyOwner validAddress(to) nonReentrant {
        uint256 availableAmount = totalInterestCollected - totalInterestWithdrawn;
        require(availableAmount > 0, "No interest available");
        
        totalInterestWithdrawn += availableAmount;
        
        require(underlyingToken.transfer(to, availableAmount), "Transfer failed");
        
        emit InterestWithdrawn(to, availableAmount);
    }    
    

    // =================相關設置及查詢函數，需有管理员權限 =================
    
    /**
     * @dev 设置年化利率（只有owner可以调用）
     * @param newRate 新的年化利率（基点表示，500 = 5%）
     */
    function setAnnualInterestRate(uint256 newRate) external onlyOwner {
        require(newRate <= MAX_INTEREST_RATE, "Interest rate too high");
        
        uint256 oldRate = annualInterestRate;
        annualInterestRate = newRate;
        
        emit InterestRateChanged(oldRate, newRate);
    }
    
    /**
     * @dev 更新杠杆代币合约地址
     * @param _newLeverageToken 新的杠杆代币合约地址
     */
    function updateLeverageToken(address _newLeverageToken) external onlyOwner validAddress(_newLeverageToken) {
        require(initialized, "Not initialized");
        leverageToken = MultiLeverageToken(_newLeverageToken);
    }
    
    /**
     * @dev 更新Custodian合约地址
     * @param _newCustodian 新的Custodian合约地址
     */
    function updateCustodian(address _newCustodian) external onlyOwner validAddress(_newCustodian) {
        require(initialized, "Not initialized");
        custodian = _newCustodian;
    }
    
    /**
     * @dev 获取用户在特定杠杆代币上的持仓信息
     * @param user 用户地址
     * @param leverageTokenId 杠杆代币ID
     * @return 持仓信息
     */
    function getUserPosition(address user, uint256 leverageTokenId) 
        external view returns (UserPosition memory) {
        return userPositions[user][leverageTokenId];
    }
    
    /**
     * @dev 预览计算利息（不更新状态）
     * @param user 用户地址
     * @param leverageTokenId 杠杆代币ID
     * @return 当前累计利息 + 未结算利息
     */
    function previewAccruedInterest(address user, uint256 leverageTokenId) 
        external view returns (uint256) {
        
        UserPosition memory position = userPositions[user][leverageTokenId];
        
        if (position.lAmountInWei == 0 || !position.active) {
            return 0;
        }
        
        uint256 newInterest = _calculateAccruedInterest(
            position.lAmountInWei,
            annualInterestRate,
            block.timestamp - position.timestamp,
            leverageTokenId
        );
        
        return position.accruedInterest + newInterest;
    }
    
    /**
     * @dev 获取系统统计信息
     */
    function getSystemStats() external view returns (
        uint256 accruedAmount,        // 累计产生的利息
        uint256 collectedAmount,      // 累计收取的利息
        uint256 withdrawnAmount,      // 累计提取的利息
        uint256 availableBalance,     // 可用余额
        uint256 activePositions,      // 活跃持仓数
        uint256 totalLeverage,        // 总杠杆金额
        uint256 currentRate           // 当前利率
    ) {
        accruedAmount = totalInterestAccrued;
        collectedAmount = totalInterestCollected;
        withdrawnAmount = totalInterestWithdrawn;
        availableBalance = totalInterestCollected - totalInterestWithdrawn;
        activePositions = totalActivePositions;
        totalLeverage = totalLeverageAmount;
        currentRate = annualInterestRate;
    }
    
    /**
     * @dev 获取当前利率配置
     */
    function getInterestConfig() external view returns (
        uint256 currentRate,          // 当前年利率（基点）
        uint256 maxRate,              // 最大允许利率
        uint256 minHoldingTime,       // 最短持有时间
        bool isInitialized            // 是否已初始化
    ) {
        currentRate = annualInterestRate;
        maxRate = MAX_INTEREST_RATE;
        minHoldingTime = MIN_HOLDING_TIME;
        isInitialized = initialized;
    }
    
    /**
     * @dev 计算特定金额在特定时间下的利息（工具函数）
     * @param lAmountInWei 杠杆代币数量
     * @param timeInSeconds 时间长度（秒）
     * @param leverageTokenId 杠杆代币ID
     * @return 计算出的利息
     */
    function calculateInterestForAmount(
        uint256 lAmountInWei,
        uint256 timeInSeconds,
        uint256 leverageTokenId
    ) external view returns (uint256) {
        return _calculateAccruedInterest(lAmountInWei, annualInterestRate, timeInSeconds, leverageTokenId);
    }
    
    /**
     * @dev 获取系统健康度指标
     */
    function getSystemHealth() external view returns (
        uint256 collectionRate,       // 收取率 = collected / accrued (基点)
        uint256 utilizationRate,      // 资金利用率 = withdrawn / collected (基点)  
        uint256 avgPositionSize,      // 平均持仓大小
        bool isHealthy               // 整体健康状态
    ) {
        // 收取率计算
        collectionRate = totalInterestAccrued > 0 ? 
            (totalInterestCollected * BASIS_POINTS) / totalInterestAccrued : BASIS_POINTS;
        
        // 资金利用率计算
        utilizationRate = totalInterestCollected > 0 ? 
            (totalInterestWithdrawn * BASIS_POINTS) / totalInterestCollected : 0;
        
        // 平均持仓大小
        avgPositionSize = totalActivePositions > 0 ? 
            totalLeverageAmount / totalActivePositions : 0;
        
        // 健康状态判断（收取率>80%，利用率<90%）
        isHealthy = collectionRate >= 8000 && utilizationRate <= 9000;
    }
}