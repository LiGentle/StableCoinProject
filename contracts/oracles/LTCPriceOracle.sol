// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IChainlinkV3.sol";

/**
 * @title LTCPriceOracle
 * @dev 自建的LTC价格预言机，兼容Chainlink V3接口
 * @notice 支持手动更新价格和自动价格验证，使用18位精度
 */
contract LTCPriceOracle is IChainlinkV3, Ownable, ReentrancyGuard {

    // ================= 常量定义 =================
    
    uint8 public constant override decimals = 18;          // LTC价格精度：18位小数
    uint256 public constant MAX_PRICE_AGE = 3600;          // 最大价格有效期：1小时
    uint256 public constant MIN_PRICE = 10e18;             // 最低价格：$10 (18位精度)
    uint256 public constant MAX_PRICE = 100000e18;         // 最高价格：$100,000 (18位精度)
    uint256 public constant PRICE_CHANGE_THRESHOLD = 1000; // 价格变动阈值：10% (基点)
    
    // ================= 价格数据结构 =================
    
    struct RoundData {
        uint80 roundId;           // 轮次ID
        int256 answer;            // 价格答案（18位精度）
        uint256 startedAt;        // 开始时间
        uint256 updatedAt;        // 更新时间
        uint80 answeredInRound;   // 回答轮次
        bool isValid;             // 是否有效
    }
    
    // ================= 状态变量 =================
    
    uint80 public currentRoundId;                    // 当前轮次ID
    mapping(uint80 => RoundData) public rounds;     // 轮次数据映射
    
    // 价格管理员地址（可以是多个地址）
    mapping(address => bool) public priceFeeder;    // 授权的价格提供者
    
    // 最新价格数据缓存
    RoundData private latestRound;
    
    // 紧急状态
    bool public emergencyMode = false;              // 紧急模式
    int256 public emergencyPrice;                   // 紧急价格（18位精度）
    
    // ================= 事件定义 =================
    
    event PriceUpdated(
        uint80 indexed roundId,
        int256 price,
        uint256 timestamp,
        address indexed updater
    );
    event PriceFeederAdded(address indexed feeder);
    event PriceFeederRemoved(address indexed feeder);
    event EmergencyModeActivated(int256 emergencyPrice);
    event EmergencyModeDeactivated();
    event InvalidPriceSubmitted(int256 price, address indexed submitter, string reason);
    
    // ================= 修饰符 =================
    
    modifier onlyPriceFeeder() {
        require(priceFeeder[msg.sender], "Not authorized price feeder");
        _;
    }
    
    modifier validPrice(int256 price) {
        require(price > 0, "Price must be positive");
        require(uint256(price) >= MIN_PRICE, "Price too low");
        require(uint256(price) <= MAX_PRICE, "Price too high");
        _;
    }
    
    // ================= 构造函数 =================
    
    constructor(
        int256 _initialPrice,
        address[] memory _initialFeeders
    ) Ownable(msg.sender) validPrice(_initialPrice) {
        
        // 设置初始价格
        currentRoundId = 1;
        
        latestRound = RoundData({
            roundId: currentRoundId,
            answer: _initialPrice,
            startedAt: block.timestamp,
            updatedAt: block.timestamp,
            answeredInRound: currentRoundId,
            isValid: true
        });
        
        rounds[currentRoundId] = latestRound;
        
        // 添加初始价格提供者
        for (uint i = 0; i < _initialFeeders.length; i++) {
            if (_initialFeeders[i] != address(0)) {
                priceFeeder[_initialFeeders[i]] = true;
                emit PriceFeederAdded(_initialFeeders[i]);
            }
        }
        
        // Owner也是价格提供者
        priceFeeder[msg.sender] = true;
        emit PriceFeederAdded(msg.sender);
        
        emit PriceUpdated(currentRoundId, _initialPrice, block.timestamp, msg.sender);
    }
    
    // ================= Chainlink V3 接口实现 =================
    
    /**
     * @dev 获取最新轮次数据（Chainlink标准接口）
     * @return roundId 轮次ID
     * @return answer 价格答案（18位精度）
     * @return startedAt 开始时间
     * @return updatedAt 更新时间
     * @return answeredInRound 回答轮次
     */
    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        // 如果处于紧急模式，返回紧急价格
        if (emergencyMode) {
            return (
                currentRoundId,
                emergencyPrice,
                block.timestamp,
                block.timestamp,
                currentRoundId
            );
        }
        
        // 验证价格时效性
        require(latestRound.isValid, "No valid price data");
        require(
            block.timestamp - latestRound.updatedAt <= MAX_PRICE_AGE,
            "Price data too old"
        );
        
        return (
            latestRound.roundId,
            latestRound.answer,
            latestRound.startedAt,
            latestRound.updatedAt,
            latestRound.answeredInRound
        );
    }
    
    // ================= 价格更新函数 =================
    
    /**
     * @dev 更新LTC价格（授权地址调用）
     * @param newPrice 新的价格（18位精度，例如：75.50 USD = 75500000000000000000）
     */
    function updatePrice(int256 newPrice) 
        external 
        onlyPriceFeeder 
        nonReentrant 
        validPrice(newPrice) 
    {
        require(!emergencyMode, "Cannot update price in emergency mode");
        
        // 价格变动幅度检查
        if (latestRound.isValid && latestRound.answer > 0) {
            uint256 priceChange = _calculatePriceChangePercentage(latestRound.answer, newPrice);
            if (priceChange > PRICE_CHANGE_THRESHOLD) {
                emit InvalidPriceSubmitted(newPrice, msg.sender, "Price change too large");
                // 不要revert，只是记录，允许管理员决定
                require(msg.sender == owner(), "Large price change requires owner approval");
            }
        }
        
        // 更新轮次
        currentRoundId++;
        
        RoundData memory newRound = RoundData({
            roundId: currentRoundId,
            answer: newPrice,
            startedAt: block.timestamp,
            updatedAt: block.timestamp,
            answeredInRound: currentRoundId,
            isValid: true
        });
        
        // 保存数据
        rounds[currentRoundId] = newRound;
        latestRound = newRound;
        
        emit PriceUpdated(currentRoundId, newPrice, block.timestamp, msg.sender);
    }
    
    /**
     * @dev 批量更新价格（用于历史数据回填）
     * @param prices 价格数组（18位精度）
     * @param timestamps 时间戳数组
     */
    function batchUpdatePrices(
        int256[] calldata prices,
        uint256[] calldata timestamps
    ) external onlyOwner nonReentrant {
        require(prices.length == timestamps.length, "Array length mismatch");
        require(prices.length > 0, "Empty arrays");
        
        for (uint i = 0; i < prices.length; i++) {
            require(prices[i] > 0, "Invalid price");
            require(timestamps[i] <= block.timestamp, "Future timestamp");
            
            currentRoundId++;
            
            RoundData memory newRound = RoundData({
                roundId: currentRoundId,
                answer: prices[i],
                startedAt: timestamps[i],
                updatedAt: timestamps[i],
                answeredInRound: currentRoundId,
                isValid: true
            });
            
            rounds[currentRoundId] = newRound;
            
            emit PriceUpdated(currentRoundId, prices[i], timestamps[i], msg.sender);
        }
        
        // 更新最新价格为最后一个
        latestRound = rounds[currentRoundId];
    }
    
    // ================= 管理员函数 =================
    
    /**
     * @dev 添加价格提供者
     * @param feeder 价格提供者地址
     */
    function addPriceFeeder(address feeder) external onlyOwner {
        require(feeder != address(0), "Invalid address");
        require(!priceFeeder[feeder], "Already a price feeder");
        
        priceFeeder[feeder] = true;
        emit PriceFeederAdded(feeder);
    }
    
    /**
     * @dev 移除价格提供者
     * @param feeder 价格提供者地址
     */
    function removePriceFeeder(address feeder) external onlyOwner {
        require(priceFeeder[feeder], "Not a price feeder");
        require(feeder != owner(), "Cannot remove owner");
        
        priceFeeder[feeder] = false;
        emit PriceFeederRemoved(feeder);
    }
    
    /**
     * @dev 激活紧急模式
     * @param _emergencyPrice 紧急状态下的固定价格（18位精度）
     */
    function activateEmergencyMode(int256 _emergencyPrice) 
        external 
        onlyOwner 
        validPrice(_emergencyPrice) 
    {
        require(!emergencyMode, "Already in emergency mode");
        
        emergencyMode = true;
        emergencyPrice = _emergencyPrice;
        
        emit EmergencyModeActivated(_emergencyPrice);
    }
    
    /**
     * @dev 停用紧急模式
     */
    function deactivateEmergencyMode() external onlyOwner {
        require(emergencyMode, "Not in emergency mode");
        require(latestRound.isValid, "No valid price data to resume");
        require(
            block.timestamp - latestRound.updatedAt <= MAX_PRICE_AGE,
            "Latest price too old, update first"
        );
        
        emergencyMode = false;
        emergencyPrice = 0;
        
        emit EmergencyModeDeactivated();
    }
    
    // ================= 查询函数 =================
    
    /**
     * @dev 获取指定轮次的数据
     */
    function getRoundData(uint80 _roundId)
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        require(_roundId > 0 && _roundId <= currentRoundId, "Round not found");
        
        RoundData memory round = rounds[_roundId];
        require(round.isValid, "Invalid round data");
        
        return (
            round.roundId,
            round.answer,
            round.startedAt,
            round.updatedAt,
            round.answeredInRound
        );
    }
    
    /**
     * @dev 获取价格历史（最近N个轮次）
     * @param count 获取的轮次数量
     * @return 价格历史数组
     */
    function getPriceHistory(uint256 count) 
        external 
        view 
        returns (RoundData[] memory) 
    {
        require(count > 0, "Count must be positive");
        require(count <= 100, "Count too large"); // 限制最多100条
        
        uint256 actualCount = count > currentRoundId ? currentRoundId : count;
        RoundData[] memory history = new RoundData[](actualCount);
        
        for (uint256 i = 0; i < actualCount; i++) {
            uint80 roundId = currentRoundId - uint80(i);
            history[i] = rounds[roundId];
        }
        
        return history;
    }
    
    /**
     * @dev 获取当前价格状态
     */
    function getPriceStatus() 
        external 
        view 
        returns (
            int256 currentPrice,
            uint256 lastUpdate,
            uint256 priceAge,
            bool isValid,
            bool inEmergencyMode,
            uint80 totalRounds
        ) 
    {
        currentPrice = emergencyMode ? emergencyPrice : latestRound.answer;
        lastUpdate = latestRound.updatedAt;
        priceAge = block.timestamp - lastUpdate;
        isValid = latestRound.isValid && priceAge <= MAX_PRICE_AGE && !emergencyMode;
        inEmergencyMode = emergencyMode;
        totalRounds = currentRoundId;
    }
    
    /**
     * @dev 获取人类可读的价格（带格式化）
     * @return priceFormatted 格式化后的价格字符串
     * @return rawPrice 原始价格（18位精度）
     */
    function getFormattedPrice() 
        external 
        view 
        returns (string memory priceFormatted, int256 rawPrice) 
    {
        rawPrice = emergencyMode ? emergencyPrice : latestRound.answer;
        // 简单的格式化：除以 10^18 然后转为字符串
        // 在实际应用中，前端会处理格式化
        priceFormatted = "Use frontend formatting";
    }
    
    // ================= 内部函数 =================
    
    /**
     * @dev 计算价格变动百分比（基点）
     * @param oldPrice 旧价格
     * @param newPrice 新价格
     * @return 变动百分比（基点，10000 = 100%）
     */
    function _calculatePriceChangePercentage(int256 oldPrice, int256 newPrice) 
        internal 
        pure 
        returns (uint256) 
    {
        if (oldPrice == 0) return 0;
        
        uint256 diff = oldPrice > newPrice ? 
            uint256(oldPrice - newPrice) : 
            uint256(newPrice - oldPrice);
            
        return (diff * 10000) / uint256(oldPrice);
    }
    
    // ================= 辅助函数（18位精度转换） =================
    
    /**
     * @dev 将美元价格转换为18位精度格式
     * @param dollarPrice 美元价格（例如：75.50）
     * @return 18位精度价格
     */
    function dollarToWei(uint256 dollarPrice, uint256 cents) 
        external 
        pure 
        returns (int256) 
    {
        // dollarPrice = 75, cents = 50 => $75.50
        // 返回: 75500000000000000000 (75.50 * 10^18)
        return int256((dollarPrice * 1e18) + (cents * 1e16));
    }
    
    /**
     * @dev 将18位精度格式转换为美元价格
     * @param weiPrice 18位精度价格
     * @return dollars 美元整数部分
     * @return cents 美分部分
     */
    function weiToDollar(int256 weiPrice) 
        external 
        pure 
        returns (uint256 dollars, uint256 cents) 
    {
        require(weiPrice >= 0, "Negative price");
        uint256 price = uint256(weiPrice);
        dollars = price / 1e18;
        cents = (price % 1e18) / 1e16;
    }
}