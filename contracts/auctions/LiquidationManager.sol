// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
// import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
// import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
// import "../tokens/StableToken.sol";
import "../tokens/MultiLeverageToken.sol";
import "../Types.sol";


interface CustodianLike {
    function burnToken (address user, uint256 tokenId, uint256 balance, uint256 underlyingAmount) external; //冻结被清算的L（转给custodian）
    function withdrawAfterLiquidation (address, uint256, uint256 , uint256, uint256 ) external; //用户提取拍卖完获得的稳定币
    function getAllLeverageTokenInfo(
        address user
    ) external view returns (
        uint256[] memory tokenIds, //用戶所有持有的杠杆幣IDs
        uint256[] memory balancesInWei, //用戶所有持有的杠杆幣數量
        LeverageType[] memory leverages, //杠杆类型,即CONSERVATIVE, MODERATE, AGGRESSIVE
        uint256[] memory mintPricesInWei, //鑄幣價格，有了leverage,mintPrice+(前端獲取的LTC currentPrice)就可以计算净值,如nav = (z*Pt - x*1)/4x = (z*Pt - z*P0/5)/4/(z*P0/5) = (5Pt - P0)/(4P0)
        uint256[] memory accuredInterestsInWei //用户已累积的未扣除利息,用於計算扣除利息后的净值
    );

    function getSingleLeverageTokenNavV2(
        address user,
        uint256 tokenId
    ) external view returns (
        uint256 balance,                    // 用户余额
        uint256 grossNavInWei,              // 总净值（未扣利息）
        uint256 netNavInWei,                // 除息净值
        uint256 totalValueInWei,            // 总价值（余额 × 净值）
        uint256 totalNetValueInWei,         // 净价值（余额 × 除息净值）
        uint256 accruedInterestInWei,       // 累计利息
        uint256 currentPriceInWei,          // 当前LTC价格
        uint256 priceTimestamp              // 价格时间戳
    ) ;

    function findOrCreateToken(
        LeverageType leverage,
        uint256 mintPriceInWei
    ) external returns (uint256 tokenId, bool isStatic);

    function adjustTokenNetValue(
        address user,
        uint256 underlyingAmountInWei,
        uint256 newMintPrice,
        uint256 fromTokenId,
        uint256 toTokenId,
        uint256 lAmountPercentage,
        bool isStatic
    ) external returns (bool success);

    function getLatestPrice() external returns (uint256 priceInWei, uint256 timeInSecond);  // 获取最新underlying价格
}




interface AuctionLike {
        function startAuction(
        uint256 underlyingAmount, // 底层资产数量 
        address originalOwner,    // 被清算用户地址
        uint256 tokenId,          // tokenID
        address triggerer         // 将接收激励的地址
        ) external returns (uint256 auctionId);
    
}

// ================= MultiLeverageToken 新增接口 =================
interface MultiLeverageTokenLike {
    
    // 检查token是否存在
    function tokenExists(uint256 tokenId) external view returns (bool);
    
    // 获取用户token余额
    function balanceOfInWei(address account, uint256 id) external view returns (uint256);
}


contract Liquidation is AccessControl, ReentrancyGuard {



    // --- 权限管理 ---
    bytes32 public constant AUCTION_ROLE = keccak256("AUCTION_ROLE");
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");


    
    function grantAuctionRole(address account) onlyRole(ADMIN_ROLE) public {
        grantRole(AUCTION_ROLE, account);
        emit AuctionAccessGranted(account);
    }
    
    function revokeAuctionRole(address account) onlyRole(ADMIN_ROLE) public  {
        revokeRole(AUCTION_ROLE, account);
        emit AuctionAccessRevoked(account);
    }

    function grantCustodianRole(address account) onlyRole(ADMIN_ROLE) public  {
        grantRole(CUSTODIAN_ROLE, account);
        emit CustodianAccessGranted(account);
    }
    
    function revokeCustodianRole(address account) onlyRole(ADMIN_ROLE) public  {
        revokeRole(CUSTODIAN_ROLE, account);
        emit CustodianAccessRevoked(account);
    }
    
    function grantAdminRole(address account) onlyRole(ADMIN_ROLE) public  {
        grantRole(ADMIN_ROLE, account);
        emit AdminAccessGranted(account);
    }
    
    function revokeAdminRole(address account) onlyRole(ADMIN_ROLE) external {
        revokeRole(ADMIN_ROLE, account);
        emit AdminAccessRevoked(account);
    }





    CustodianLike  public custodian;  // 核心合约  
    AuctionLike public auction; //清算模块
    MultiLeverageToken public leverageToken;



    // ================= 全局清算配置 =================

    struct GlobalLiquidationConfig {
        uint256 adjustmentThreshold;     // 净值调整阈值 [1e18] 
        uint256 liquidationThreshold;    // 强制清算阈值 [1e18]
        uint256 penalty;                 // 清算惩罚金 [1e18]
        bool enabled;                    // 清算功能是否启用
    }

    GlobalLiquidationConfig public globalConfig;



    // ================= 用户清算状态 =================
    struct UserLiquidationStatus {
        uint256 balance;               // 余额
        LeverageType leverageType;     // 杠杆比例
        uint8 riskLevel;               // 风险等级
        bool isLiquidated;             // 是否已被清算
        bool isUnderLiquidation;       // 是否正被清算
        bool isFreezed;                // 是否被冻结，当杠杆币被清算时冻结，此时用户无法铸造该ID的新杠杆币，当用户提取出清算获得的稳定币后，解冻
        uint256 stableNums;            // 清算后得到的稳定币数量
        uint256 auctionId;             // 关联的拍卖ID
    }
    mapping(address => mapping(uint256 => UserLiquidationStatus)) public userLiquidationStatus; // userLiquidationStatus[user][tokenId];

    // ================= 修饰符 =================
    modifier liquidationEnabled() {
        require(globalConfig.enabled, "Liquidation not enabled");
        _;
    }





    // --- Math ---
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

    //================== 定义事件 =================
    event AdminAccessGranted(address indexed user);
    event AuctionAccessGranted(address indexed user); 
    event CustodianAccessGranted(address indexed user);
  
    event AdminAccessRevoked(address indexed user);
    event AuctionAccessRevoked(address indexed user);
    event CustodianAccessRevoked(address indexed user);



    event ParameterChanged(bytes32 indexed parameter, uint256 value);
    event AddressChanged(bytes32 indexed parameter, address addr);
    event LiquidateSwitch (bool liquidationSwitch);
    
    // ================= 新增事件 =================
    event RiskLevelUpdated(address indexed user, uint256 indexed tokenId, uint8 riskLevel);
    event NetValueAdjusted(address indexed user, uint256 indexed fromTokenId, uint256 indexed toTokenId, uint256 adjustAmountInWei, uint256 underlyingAmountInWei);
    event NoLeftAfterLiquidation(string message);

    event DEFICIT(uint256 value);



    // ================= 构造函数 =================
    constructor(
        address _custodian,
        address _auction
    )
    {

        // 设置角色 (权限管理)
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);

        emit AdminAccessGranted(msg.sender);


        custodian = CustodianLike(_custodian);
        auction = AuctionLike (_auction);

        // 默认全局清算配置
        globalConfig = GlobalLiquidationConfig({
            adjustmentThreshold: PRECISION_UNIT / 2,   // 净值调整阈值 (0.5)
            liquidationThreshold: (3 * PRECISION_UNIT) / 10,  // 强制清算阈值 (0.3)
            penalty: (3 * PRECISION_UNIT) / 100,       // 清算惩罚金 (0.03)
            enabled: true
        });

    }

        // --- 管理功能 ---
    function LiquidationSwitch(bool liquidationSwitch) external onlyRole(ADMIN_ROLE) nonReentrant{
        globalConfig.enabled = liquidationSwitch;
        emit LiquidateSwitch (liquidationSwitch);
    }
    
    function setParameter(bytes32 parameter, uint256 value) external onlyRole(ADMIN_ROLE) nonReentrant {
        // require(hasRole(ADMIN_ROLE, msg.sender), "Auction/not-admin");
        if      (parameter == "adjustmentThreshold") globalConfig.adjustmentThreshold = value;
        else if (parameter == "liquidationThreshold") globalConfig.liquidationThreshold = value;          
        else if (parameter == "penalty") globalConfig.penalty = value;          
        else revert("Unrecognized parameter");
        emit ParameterChanged(parameter, value);
    }
    
    function setAddress(bytes32 parameter, address addr) external onlyRole(ADMIN_ROLE) nonReentrant {
        // require(hasRole(ADMIN_ROLE, msg.sender), "Auction/not-admin");
        if (parameter == "custodian") {custodian = CustodianLike(addr); grantCustodianRole(addr);}
        else if (parameter == "leverageToken") leverageToken = MultiLeverageToken(addr);
        else if (parameter == "auction") {auction = AuctionLike(addr); grantAuctionRole(addr);}
        else revert("Unrecognized parameter");
        emit AddressChanged(parameter, addr);
    }

    // ================= 更新用户清算信息 （铸币时和销毁时均需调用）================
    function _updateLiquidationStatus ( address user, uint256 tokenId,  uint256 balance, 
        LeverageType leverageType )        
         external onlyRole(CUSTODIAN_ROLE) nonReentrant{
            require(address(custodian)!=address(0),'Set custodian address first');
            userLiquidationStatus[user][tokenId].balance = balance;
            if (userLiquidationStatus[user][tokenId].leverageType != leverageType){
                userLiquidationStatus[user][tokenId].leverageType = leverageType;
            }
        }


    function checkFreezeStatus (address user, uint256 tokenId) public view returns (bool isFreezed){
        isFreezed = userLiquidationStatus[user][tokenId].isFreezed;
    } 



    // ================= 清算功能 =================
    
    /**
     * @dev 触发清算（类似MakerDAO的bark函数）
     * @param user 被清算用户
     * @param tokenId 杠杆币ID
     * @param kpr Keeper地址（接收激励）
     * @return auctionId 创建的拍卖ID
     */

    function bark(
        address user,
        uint256 tokenId,
        address kpr
    ) external liquidationEnabled nonReentrant returns (uint256 auctionId) {
        require(address(auction)!=address(0), 'Set auction address first!');
        require(address(custodian)!=address(0), 'Set custodian address first!');
        require(address(leverageToken)!=address(0), 'Set leverageToken address first!');
        require(user != address(0), "Invalid user address");
        require(kpr != address(0), "Invalid keeper address");
        require(leverageToken.tokenExists(tokenId), "Token does not exist");
        
        // 获取用户持仓
        uint256 balance = leverageToken.balanceOfInWei(user, tokenId);
        require(balance > 0, "No tokens to liquidate");
        require(userLiquidationStatus[user][tokenId].isFreezed == false, "The Tokens have been freezed");
        require(userLiquidationStatus[user][tokenId].isUnderLiquidation == false, "Already under liquidation");
        
        // 检查净值是否低于清算阈值
        uint256 nav = _calculateNetAssetValue(user, tokenId);
        require(nav < globalConfig.liquidationThreshold, "NAV above liquidation threshold");


        // 计算清算数量
        (uint256 underlyingAmount, uint256 underlyingValue) = _calculateLiquidationAmount(user, tokenId, balance, nav);
        require(underlyingAmount > 0, "Null auction");
        require( underlyingValue <= 2**255 && underlyingAmount<= 2**255, "Overflow");
        
        
        // // 创建荷兰式拍卖
        auctionId = auction.startAuction(underlyingAmount, user, tokenId, kpr);

        
        // 更新用户状态
        userLiquidationStatus[user][tokenId].isUnderLiquidation = true;
        userLiquidationStatus[user][tokenId].riskLevel = 4; // 清算中
        userLiquidationStatus[user][tokenId].auctionId = auctionId;
        userLiquidationStatus[user][tokenId].isFreezed = true;

        // 销毁杠杆币
        _burnLeverageToken(user, tokenId, balance, underlyingAmount);
       
        return auctionId;
    }


    /**
     * @dev 销毁杠杆币
     */
    function _burnLeverageToken(address user, uint256 tokenId, uint256 balance, uint256 underlyingAmount) internal {
        custodian.burnToken (user, tokenId, balance, underlyingAmount);
    }




    /**
     * @dev 计算清算数量
     */
    function _calculateLiquidationAmount(
        address user,
        uint256 tokenId,
        uint256 balance,
        uint256 nav
    ) internal returns (uint256 underlyingAmount, uint256 underlyingValue) {
        LeverageType leverage = userLiquidationStatus[user][tokenId].leverageType;
        uint8 leverageLevel;
        if (leverage==LeverageType.CONSERVATIVE){
            leverageLevel = 8;
        } else if (leverage==LeverageType.MODERATE){
            leverageLevel = 4;
        } else if (leverage==LeverageType.AGGRESSIVE ){
            leverageLevel = 1;
        }
        underlyingValue = wmul ( balance, (nav + 1*PRECISION_UNIT/leverageLevel) );
        (uint256 currentPrice, ) = custodian.getLatestPrice();
        require(currentPrice>0, 'Invalid oracle price (<=0)!');
        underlyingAmount = wdiv( underlyingValue , currentPrice );
    }

    /**
     * @dev 计算用户杠杆币的净值
     */
    function _calculateNetAssetValue(address user, uint256 tokenId) internal view returns (uint256 nav) {
        ( , , uint256 navInWei, , , , , ) = custodian.getSingleLeverageTokenNavV2(user, tokenId);
        require(navInWei>0, 'Invalid Net Value!'); 
        nav = navInWei; // 返回除息净值
    }

    /**
     * @dev 每次有人拍得underlying更新用户状态
     */
    function _afterEachBid(address usr, uint256 tokenID, uint256 numStable, uint256 underlyingAmount) external onlyRole(AUCTION_ROLE) {
        userLiquidationStatus[usr][tokenID].stableNums = numStable;

        if (underlyingAmount==0 && userLiquidationStatus[usr][tokenID].isUnderLiquidation == true){
            userLiquidationStatus[usr][tokenID].isLiquidated = true;
            userLiquidationStatus[usr][tokenID].isUnderLiquidation = false;
        }

    }
    /**
     * @dev 清算完成后，被清算用户提取稳定币
     */
    function withdrawStable(address usr, uint256 tokenID) external {
        require (userLiquidationStatus[usr][tokenID].isLiquidated == true && 
         userLiquidationStatus[usr][tokenID].isUnderLiquidation == false, 'Withdraw not ready');

        LeverageType leverage = userLiquidationStatus[usr][tokenID].leverageType;
        uint8 leverageLevel;
        if (leverage==LeverageType.CONSERVATIVE){
            leverageLevel = 8;
        } else if (leverage==LeverageType.MODERATE){
            leverageLevel = 4;
        } else if (leverage==LeverageType.AGGRESSIVE ){
            leverageLevel = 1;
        }
         
        uint256 penalty = wmul(userLiquidationStatus[usr][tokenID].balance, globalConfig.penalty);
        uint256 stableEarned = userLiquidationStatus[usr][tokenID].stableNums;

        uint256 stableAmountToBeBurned = wmul(userLiquidationStatus[usr][tokenID].balance,
            1*PRECISION_UNIT/leverageLevel);

        if ( stableEarned > (penalty + stableAmountToBeBurned) ){
            uint256 amountToUser = stableEarned - penalty - stableAmountToBeBurned;
            custodian.withdrawAfterLiquidation(usr, tokenID, amountToUser, penalty, stableAmountToBeBurned);
        } else if (stableEarned < stableAmountToBeBurned ){
            emit NoLeftAfterLiquidation('There is no left to be withdrawn after penalty!');
            custodian.withdrawAfterLiquidation(usr, tokenID, 0, 0, stableAmountToBeBurned);
            emit DEFICIT((stableAmountToBeBurned - stableEarned));
        } else {
            emit NoLeftAfterLiquidation('There is no left to be withdrawn after penalty!');
            custodian.withdrawAfterLiquidation(usr, tokenID, 0, stableEarned -stableAmountToBeBurned, stableAmountToBeBurned);
        }
        

        userLiquidationStatus[usr][tokenID].isFreezed = false; //解冻
        userLiquidationStatus[usr][tokenID].stableNums = 0; //重置stableNums
        userLiquidationStatus[usr][tokenID].auctionId = 0; //重置auctionID
        userLiquidationStatus[usr][tokenID].riskLevel = 0; //重置riskLevel
        userLiquidationStatus[usr][tokenID].balance = 0; //重置balance
    }

    // ================= 下折功能 =================

    /**
     * @dev 风险预览 - 持币用户可以调用该函数查看并更新账户内所有token的净值风险等级
     * @param user 用户地址
     * @return tokenIds 用户持有的所有token ID数组
     * @return netValues 对应的净值数组
     * @return riskLevels 对应的风险等级数组
     */
    function updateAllTokensRiskLevel(address user) public returns (
        uint256[] memory tokenIds,
        uint256[] memory netValues,
        uint8[] memory riskLevels
    ) {
        require(user != address(0), "Invalid user address");
        require(address(custodian) != address(0), "Set custodian address first");
        
        // 获取用户所有token信息
        (tokenIds, , , , ) = custodian.getAllLeverageTokenInfo(user);
        
        uint256 tokenCount = tokenIds.length;
        netValues = new uint256[](tokenCount);
        riskLevels = new uint8[](tokenCount);
        
        for (uint256 i = 0; i < tokenCount; i++) {
            uint256 tokenId = tokenIds[i];
            uint256 balance = leverageToken.balanceOfInWei(user, tokenId);
            
            if (balance > 0) {
                // 获取净值
                ( , , uint256 netNavInWei, , , , , ) = custodian.getSingleLeverageTokenNavV2(user, tokenId);
                netValues[i] = netNavInWei;
                
                // 计算风险等级
                riskLevels[i] = _calculateRiskLevel(netNavInWei);
                
                // 更新用户状态
                userLiquidationStatus[user][tokenId].riskLevel = riskLevels[i];
            } else {
                netValues[i] = 0;
                riskLevels[i] = 0;
            }
        }
        
        return (tokenIds, netValues, riskLevels);
    }


    function updateSingleTokensRiskLevel(address user, uint256 tokenId) public returns (
        uint256 netValue,
        uint8 riskLevel
    ) {
        require(user != address(0), "Invalid user address");
        require(address(custodian) != address(0), "Set custodian address first");
        
        uint256 balance = leverageToken.balanceOfInWei(user, tokenId);
        require(balance > 0, "User does not hold this token");
        ( , , netValue, , , , , ) = custodian.getSingleLeverageTokenNavV2(user, tokenId);
        // 计算风险等级
        // riskLevel = 0;
        riskLevel = _calculateRiskLevel(netValue);
        
        // 更新用户状态
        userLiquidationStatus[user][tokenId].riskLevel = riskLevel;
    
    }


    /**
     * @dev 计算风险等级
     * @param netValue 净值（18位精度）
     * @return riskLevel 风险等级：0=安全，1=低风险，2=中风险，3=高风险，4=强制清算
     */
    function _calculateRiskLevel(uint256 netValue) internal view returns (uint8 riskLevel) {
        if (netValue <= globalConfig.liquidationThreshold) {
            // 净值低于强制清算阈值
            riskLevel = 4;
        } else if (netValue <= globalConfig.adjustmentThreshold) {
            // 净值在调整阈值和清算阈值之间，分为3档
            uint256 range = globalConfig.adjustmentThreshold - globalConfig.liquidationThreshold;
            uint256 position = netValue - globalConfig.liquidationThreshold;
            
            // 将区间分为3等分
            uint256 segment = range / 3;
            
            if (position <= segment) {
                riskLevel = 3; // 高风险（最接近清算阈值）
            } else if (position <= segment * 2) {
                riskLevel = 2; // 中风险
            } else {
                riskLevel = 1; // 低风险（最接近调整阈值）
            }
        } else {
            // 净值高于调整阈值，安全
            riskLevel = 0;
        }
        // riskLevel = 0;
    }

    /**
     * @dev 净值调整函数框架 - 用户可以进行净值调整，调整后的净值为1e18wei
     * @param user 用户地址
     * @param fromTokenId 原token ID
     * @param adjustedAmountPercentage 转移比例（单位为wei，最大为100）
     * @return newTokenId 新的token ID
     * @return adjustedAmount 调整后的token数量 
     */
    function adjustNetValue(
        address user,
        uint256 fromTokenId,
        uint256 adjustedAmountPercentage
    ) external liquidationEnabled nonReentrant returns (uint256 newTokenId, uint256 adjustedAmount) {
        require(address(custodian)!=address(0),'Set custodian address first');
        require(adjustedAmountPercentage<=100 && adjustedAmountPercentage>0, 'Invalid percentage! adjustedAmountPercentage should be in range (0,100])') ; 
        require(user != address(0), "Invalid user address");
        require(user == msg.sender, 'Only accessible to token owner');
        require(leverageToken.tokenExists(fromTokenId), "Source token does not exist");
        // 获取用户原token余额
        uint256 balance = leverageToken.balanceOfInWei(user, fromTokenId);
        require(balance > 0, "No tokens to adjust");
        // 获取最新的风险等级和净值
        (uint256 netValue, uint8 riskLevel) = updateSingleTokensRiskLevel(user, fromTokenId);
        require(userLiquidationStatus[user][fromTokenId].isFreezed == false, 'Token is freezed'); 
        require(riskLevel!=0, 'No need to adjust net value when the risk level is Safe.');
        
        // 获取原杠杆比例
        LeverageType leverage = userLiquidationStatus[user][fromTokenId].leverageType;
        
        // 计算需要调整的个数
        adjustedAmount = adjustedAmountPercentage * balance /100;

        // 新的铸币价格 = 最新底层资产价格 （因为目标净值为1）
        (uint256 newMintPrice, ) = custodian.getLatestPrice();
        require(newMintPrice>0, 'Invalid oracle price (<=0)!');


        // 需要的底层资产的数量
        uint256 underlyingAmountInWei =wdiv((adjustedAmount - wmul(netValue,adjustedAmount)), newMintPrice); 

        // 查找或创建新的token
        bool isStatic;
        (newTokenId, isStatic )= custodian.findOrCreateToken(leverage, newMintPrice);

        
        // （从原tokenId到新tokenId）
        bool success = custodian.adjustTokenNetValue(user, underlyingAmountInWei, newMintPrice,
        fromTokenId, newTokenId, adjustedAmountPercentage, isStatic );
        // bool success = true;
        require(success, "Token adjustment failed");
        
        
        // 更新用户状态
        userLiquidationStatus[user][fromTokenId].balance = balance - adjustedAmount;
        userLiquidationStatus[user][newTokenId].riskLevel = 0;
        userLiquidationStatus[user][newTokenId].balance = adjustedAmount;
        
        emit NetValueAdjusted(user, fromTokenId, newTokenId, adjustedAmount, underlyingAmountInWei);
        
        return (newTokenId, adjustedAmount);
    }


}
