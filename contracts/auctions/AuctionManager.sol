// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;


import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
// import "../tokens/StableToken.sol";

interface CustodianLike_Auction {
    function receiveFromKpr(address,  uint256) external; // kpr转账稳定币给custodian
    function transferToKpr(address, uint256) external; // custodian转账underlying给kpr
    function rewardKpr(address, uint256) external; //支付给kpr奖励
    function getLatestPrice() external returns (uint256 priceInWei, uint256 timeInSecond);  // 获取最新underlying价格
}


// // 获取价格
// interface SpotterLike_Auction {
//     function getCurrentPrice() external returns (uint256 currentPrice);
//     function getCurrentOracleType() external view returns (bytes32 typeId);
// }


// 稳定币
interface StableLike_Auction {
    function allowance(address owner, address spender) external view returns (uint256);

}

// 更新清算信息
interface LiquidationLike {
    function _afterEachBid(address usr, uint256 tokenID, uint256 numStable, uint256 underlyingAmount) external;
}

// 方便无本金拍卖
interface ClipperCallee {
    function clipperCall(address, uint256, uint256, bytes calldata) external;
}

// 价格计算器
interface AbacusLike {
    function price(uint256, uint256) external view returns (uint256);
}

contract DuchAuction is AccessControl, ReentrancyGuard{
    // --- 权限管理 ---
    bytes32 public constant CALLER_ROLE = keccak256("CALLER_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    
    function grantCallerRole(address account) onlyRole(ADMIN_ROLE) public {
        grantRole(CALLER_ROLE, account);
        emit CallerAccessGranted(account);
    }
    
    function revokeCallerRole(address account) onlyRole(ADMIN_ROLE) public {
        revokeRole(CALLER_ROLE, account);
        emit CallerAccessRevoked(account);
    }
    
    function grantAdminRole(address account) onlyRole(ADMIN_ROLE) public {
        grantRole(ADMIN_ROLE, account);
        emit AdminAccessGranted(account);
    }
    
    function revokeAdminRole(address account) onlyRole(ADMIN_ROLE) public {
        revokeRole(ADMIN_ROLE, account);
        emit AdminAccessRevoked(account);
    }



    // --- 数据 ---
    CustodianLike_Auction public custodian;        // 核心引擎
    StableLike_Auction public stableToken;                // 稳定币合约

    LiquidationLike     public liquidationManager;  // 清算管理模块
    // SpotterLike_Auction public priceModule;         // 底层资产价格模块 (from SpotterLIke)
    AbacusLike  public priceCalculator;     // 当前价格计算器 (from Abacus)

    // 拍卖参数结构体 - 优化存储布局
    struct AuctionParams {
        uint256 priceMultiplier;     // 增加起始价格的乘数因子 
        uint256 resetTime;           // 拍卖重置前的时间 [seconds]
        uint256 priceDropThreshold;  // 拍卖重置前的价格下降百分比
        uint256 percentageReward;    // 激励keeper的百分比费用 
        uint256 fixedReward;         // 激励keeper的固定费用 
        uint256 minAuctionAmount;    // 最小拍卖金额 
    }
    AuctionParams public auctionParams;

    uint256   public totalAuctions = 0;     // 总拍卖数量
    
    // 循环优化 - 使用映射跟踪活跃拍卖
    mapping(uint256 => bool) public isActiveAuction;
    uint256 public activeAuctionCount;

    struct Auction {
        uint256 arrayIndex;  // 在活跃数组中的索引
        uint256 underlyingAmount;  // 剩余抵押品数量 [wad]
        address originalOwner;     // 被清算的杠杆币所有者
        uint256 tokenId;           // tokenID
        uint96  startTime;         // 拍卖开始时间
        uint256 startingPrice;     // 起始价格 
        uint256 currentPrice;      // 当前价格
        uint256 totalPayment;      // 累计支付金额  - 拍卖重置时不重置该值
    }
    mapping(uint256 => Auction) public auctions;

    // uint256 internal reentrancyLock;

    // 断路器级别
    // 0: 无限制
    // 1: 禁止新拍卖()
    // 2: 禁止新拍卖()或重置拍卖()
    // 3: 禁止新拍卖()、重置拍卖()或购买()
    uint256 public circuitBreaker = 0;



    // --- 事件 ---
    event AdminAccessGranted(address indexed user);
    event CallerAccessGranted(address indexed user);    
    event AdminAccessRevoked(address indexed user);
    event CallerAccessRevoked(address indexed user);


    event ParameterChanged(bytes32 indexed parameter, uint256 value);
    event AddressChanged(bytes32 indexed parameter, address addr);

    event AuctionStarted(
        uint256 indexed auctionId,
        uint256 startingPrice,
        uint256 underlyinglAmount,
        address originalOwner,
        uint256 indexed tokenId,
        address indexed triggerer,
        uint256 rewardAmount
    );
    event PurchaseMade(
        uint256 indexed auctionId,
        uint256 maxAcceptablePrice,
        uint256 currentPrice,
        uint256 paymentAmount,
        uint256 remainingunderlying,
        address indexed kpr,
        address indexed originalOwner
    );
    event AuctionReset(
        uint256 indexed auctionId,
        uint256 newStartingPrice,
        uint256 underlyingAmount,
        address originalOwner,
        uint256 indexed tokenId,
        address indexed triggerer,
        uint256 rewardAmount
    );

    event AuctionRemoved(uint256 indexed auctionId); // Jintao

    event AuctionCancelled(uint256 auctionId);

    // --- 初始化 ---
    constructor() {        
        // 设置角色 (权限管理)
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        emit AdminAccessGranted(msg.sender);
    }


    modifier checkCircuitBreaker(uint256 level) {
        require(circuitBreaker < level, 'CircuitBreaker error!');
        _;
    }


    // --- 管理功能 ---
    function setParameter(bytes32 parameter, uint256 value) external onlyRole(ADMIN_ROLE) nonReentrant {
        // require(hasRole(ADMIN_ROLE, msg.sender), "Auction/not-admin");

        if      (parameter == "priceMultiplier") auctionParams.priceMultiplier = value;
        else if (parameter == "resetTime")       auctionParams.resetTime = value;           // 拍卖重置前的时间
        else if (parameter == "minAuctionAmount")       auctionParams.minAuctionAmount = value;           // 拍卖重置前的时间
        else if (parameter == "priceDropThreshold") auctionParams.priceDropThreshold = value; // 拍卖重置前的价格下降百分比
        else if (parameter == "percentageReward") auctionParams.percentageReward = value;   // 激励百分比
        else if (parameter == "fixedReward")     auctionParams.fixedReward = value;  // 固定激励费用
        else if (parameter == "circuitBreaker") circuitBreaker = value;        // 设置断路器级别
        else revert("Unrecognized parameter");
        emit ParameterChanged(parameter, value);
    }
    
    function setAddress(bytes32 parameter, address addr) external onlyRole(ADMIN_ROLE) nonReentrant {
        // require(hasRole(ADMIN_ROLE, msg.sender), "Auction/not-admin");
        if (parameter == "custodian") custodian = CustodianLike_Auction(addr);
        else if (parameter == "liquidationManager") { liquidationManager = LiquidationLike(addr); grantCallerRole(addr);}
        else if (parameter == "priceCalculator") priceCalculator = AbacusLike(addr);
        else if (parameter == "stableToken") stableToken = StableLike_Auction(addr);
        else revert("Unrecognized parameter");
        emit AddressChanged(parameter, addr);
    }

    // --- 数学运算 ---
    // uint256 constant BILLION = 10 **  9;
    // uint256 constant WAD = 10 ** 18;
    // uint256 constant RAY = 10 ** 27;

    // 定义内部精度
    uint8 public constant PRECISION_DECIMALS = 18;
    uint256 public constant PRECISION_UNIT = 1e18;

    function min(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = x <= y ? x : y;
    }
    function add(uint256 x, uint256 y) internal pure returns (uint256 z) {
        require((z = x + y) >= x);
    }
    function sub(uint256 x, uint256 y) internal pure returns (uint256 z) {
        require((z = x - y) <= x);
    }
    function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
        require(y == 0 || (z = x * y) / y == x);
    }
    function wmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = mul(x, y) / PRECISION_UNIT;
    }
    function wdiv(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = mul(x, PRECISION_UNIT) / y;
    }


    // --- 拍卖功能 ---

    // 开始拍卖
    function startAuction(
        uint256 underlyingAmount, // 底层资产数量 
        address originalOwner,    // 被清算用户地址
        uint256 tokenId,          // tokenID
        address triggerer         // 将接收激励的地址
    ) external onlyRole(CALLER_ROLE) nonReentrant checkCircuitBreaker(1) returns (uint256 auctionId) {
        // 输入验证
        // require(debtTarget > 0, "Debt Target should be larger than 0!");
        require(underlyingAmount > 0, "Underlying Amount should be larger than 0!");
        require(originalOwner != address(0), "Invalid Original Owner!");
        auctionId = ++totalAuctions;
        require(auctionId > 0, "Auction ID should be larger than 0!");



        // 循环优化 - 更新映射和计数器
        isActiveAuction[auctionId] = true;
        activeAuctionCount++;

        // auctions[auctionId].debtTarget = debtTarget;
        auctions[auctionId].underlyingAmount = underlyingAmount;
        auctions[auctionId].originalOwner = originalOwner;
        auctions[auctionId].tokenId = tokenId;
        auctions[auctionId].startTime = uint96(block.timestamp);


        uint256 startingPrice;
        // startingPrice = rmul(getCurrentPrice(), priceMultiplier);
        // require(startingPrice > 0, "Starting Price should be larger than 0!");
        // auctions[auctionId].startingPrice = startingPrice;
        (uint256 currentPrice, ) = custodian.getLatestPrice();
        startingPrice = wmul(currentPrice, auctionParams.priceMultiplier);
        require(startingPrice > 0, "Starting Price should be larger than 0!");
        auctions[auctionId].startingPrice = startingPrice;

        // 激励触发拍卖
        uint256 currentFixedReward = auctionParams.fixedReward;
        uint256 currentPercentageReward = auctionParams.percentageReward;
        uint256 rewardAmount;
        if (currentFixedReward > 0 || currentPercentageReward > 0) {
            uint256 currentMinAuctionAmount = auctionParams.minAuctionAmount;
            // 当拍卖价值大于等于最小拍卖金额时，才激励
            if ( wmul(underlyingAmount, currentPrice) >= currentMinAuctionAmount) {
                rewardAmount = add(currentFixedReward, wmul( wmul(underlyingAmount, currentPrice) - currentMinAuctionAmount , currentPercentageReward));
                custodian.rewardKpr(triggerer, rewardAmount);
            }
        }

        emit AuctionStarted(auctionId, startingPrice,  underlyingAmount, originalOwner, tokenId, triggerer, rewardAmount);
    }



        // 重置拍卖
    function resetAuction(
        uint256 auctionId,  // 要重置的拍卖ID
        address triggerer   // 将接收激励的地址
    ) external  nonReentrant checkCircuitBreaker(2) {
        // 读取拍卖数据
        address originalOwner = auctions[auctionId].originalOwner;
        uint96  startTime = auctions[auctionId].startTime;
        uint256 startingPrice = auctions[auctionId].startingPrice;

        require(originalOwner != address(0), "Invalid Original Owner!");

        // 检查拍卖是否需要重置并计算当前价格
        (bool needsReset,) = checkAuctionStatus(startTime, startingPrice);
        require(needsReset, "Auction is not ready to be reset!");

        // uint256 debtTarget = auctions[auctionId].debtTarget;
        uint256 underlyingAmount = auctions[auctionId].underlyingAmount;
        auctions[auctionId].startTime = uint96(block.timestamp);

        (uint256 currentPrice, ) = custodian.getLatestPrice();
        startingPrice = wmul(currentPrice, auctionParams.priceMultiplier);
        require(startingPrice > 0, "Starting Price should be larger than 0!");
        auctions[auctionId].startingPrice = startingPrice;

        // 激励重置拍卖
        uint256 currentFixedReward = auctionParams.fixedReward;
        uint256 currentPercentageReward = auctionParams.percentageReward;
        uint256 rewardAmount;
        if (currentFixedReward > 0 || currentPercentageReward > 0) {
            uint256 currentMinAuctionAmount = auctionParams.minAuctionAmount;
            if ( wmul(underlyingAmount, currentPrice) >= currentMinAuctionAmount) {
                rewardAmount = add(currentFixedReward, wmul( wmul(underlyingAmount, currentPrice), currentPercentageReward));
                custodian.rewardKpr(triggerer, rewardAmount);
            }
        }

        emit AuctionReset(auctionId, startingPrice, underlyingAmount, originalOwner, auctions[auctionId].tokenId , triggerer, rewardAmount);
    }


    // 检查并确保授权额度
    function ensureApproval(uint256 amount) internal view {
        uint256 currentAllowance = stableToken.allowance(msg.sender, address(custodian));
        if (currentAllowance < amount) {
            // 前端需要提示用户授权
            revert("Insufficient approval. Please approve Custodian contract to spend your stable tokens");
        }
    }


    // 购买底层资产
    function purchaseUnderlying(
        uint256 auctionId,           // 拍卖ID
        uint256 maxPurchaseAmount,   // 购买underlying数量的上限 [Wei]
        uint256 maxAcceptablePrice,  // 最高可接受价格 [Wei]
        address receiver,            // underlying接收者和外部调用地址
        bytes calldata callData      // 传递给外部调用的数据
    ) external nonReentrant checkCircuitBreaker(3) {
        require(address(stableToken)!=address(0),'stableToken address is not set');
        ensureApproval(wmul(maxPurchaseAmount, maxAcceptablePrice));
        address originalOwner = auctions[auctionId].originalOwner;
        require(originalOwner != address(0), "Auction not ready");

        uint96  startTime = auctions[auctionId].startTime;
        uint256 currentPrice;
        {
            bool needsReset;
            (needsReset, currentPrice) = checkAuctionStatus(startTime, auctions[auctionId].startingPrice);

            // 检查拍卖不需要重置
            require(!needsReset, "Auction needs to be reset");
        }

        // 确保价格对买家可接受
        require(maxAcceptablePrice >= currentPrice, "Current price is above acceptable price");

        uint256 underlyingAmount = auctions[auctionId].underlyingAmount;
        uint256 paymentAmount;
        uint256 underlyingValue; //underlying 总价值

        
        // 购买尽可能多的抵押品，最多到maxPurchaseAmount
        uint256 purchaseSlice = min(underlyingAmount, maxPurchaseAmount);

        // 购买这部分underlying需要的S金额
        paymentAmount = wmul(purchaseSlice, currentPrice);
        underlyingValue = wmul(underlyingAmount, currentPrice);


        // 如果购买全部underlying => 拍卖完成 => 不考虑尘问题, 否则：
        if ( purchaseSlice < underlyingAmount) {
            uint256 currentMinAuctionAmount = auctionParams.minAuctionAmount;
            if (underlyingValue < currentMinAuctionAmount){
                require(purchaseSlice >= underlyingAmount, 'Current underlying amount is too small, please increase your maximum purchase amount and buy all underlying.'  );
            }
            if (sub(underlyingValue,paymentAmount) < currentMinAuctionAmount) {
                // 如果拍卖后剩余underlying的价值小于最小拍卖金额，则需要调整支付金额和购买数量:
                // 调整支付金额
                paymentAmount = sub(underlyingValue, currentMinAuctionAmount);
                // 调整购买数量
                purchaseSlice = wdiv(paymentAmount,  currentPrice);
            }
        }

        // 计算操作后的剩余underlying数量
        underlyingAmount = sub(underlyingAmount,purchaseSlice);
        
        // 发送underlying给接收者
        custodian.transferToKpr(receiver, purchaseSlice);

        // 执行外部调用（如果定义了调用数据）
        LiquidationLike liquidationManager_ = liquidationManager;
        if (callData.length > 0 && receiver != address(custodian) && receiver != address(liquidationManager_)) {
            ClipperCallee(receiver).clipperCall(msg.sender, paymentAmount, purchaseSlice, callData);
        }
        
        // 从调用者获取S
        custodian.receiveFromKpr(msg.sender,  paymentAmount);

        // 更新累计支付金额
        auctions[auctionId].totalPayment = add(auctions[auctionId].totalPayment, paymentAmount);

        // 更新清算信息
        liquidationManager._afterEachBid(originalOwner, auctions[auctionId].tokenId, auctions[auctionId].totalPayment, underlyingAmount );
    

        if (underlyingAmount == 0) {
            removeAuction(auctionId);
        }
        else {
            auctions[auctionId].underlyingAmount = underlyingAmount;
        }

        emit PurchaseMade(auctionId, maxAcceptablePrice, currentPrice, paymentAmount, underlyingAmount, receiver, originalOwner);
    }

    function removeAuction(uint256 auctionId) internal {
        //
        isActiveAuction[auctionId] = false;
        activeAuctionCount--;
        delete auctions[auctionId];
        emit AuctionRemoved(auctionId);
    }

    // 活跃拍卖数量
    function getActiveAuctionCount() external view returns (uint256) {
        return activeAuctionCount;
    }

    // 返回所有活跃拍卖ID数组
    function auctionIsActive(uint256 auctionId) external view returns (bool) {
        return isActiveAuction[auctionId];
    }

    // 外部查询拍卖状态
    function getAuctionStatus(uint256 auctionId) external view returns (bool needsReset, uint256 currentPrice, uint256 underlyingAmount) {
        require(isActiveAuction[auctionId],'The acuction is not active');
        // 读取拍卖数据
        address originalOwner = auctions[auctionId].originalOwner;
        uint96  startTime = auctions[auctionId].startTime;

        bool done;
        (done, currentPrice) = checkAuctionStatus(startTime, auctions[auctionId].startingPrice);

        needsReset = originalOwner != address(0) && done;
        underlyingAmount = auctions[auctionId].underlyingAmount;
        // debtTarget = auctions[auctionId].debtTarget;
    }

    // 内部检查拍卖状态
    function checkAuctionStatus(uint96 startTime, uint256 startingPrice) internal view returns (bool needsReset, uint256 currentPrice) {
        currentPrice = priceCalculator.price(startingPrice, sub(block.timestamp, startTime));
        needsReset = (sub(block.timestamp, startTime) > auctionParams.resetTime || wdiv(currentPrice, startingPrice) < auctionParams.priceDropThreshold);
    }




    // 取消拍卖（紧急情况或治理操作）
    function cancelAuction(uint256 auctionId) external onlyRole(ADMIN_ROLE) nonReentrant {
        require(auctions[auctionId].originalOwner != address(0), "Auction not started");
        removeAuction(auctionId);
        emit AuctionCancelled(auctionId);
    }

}
