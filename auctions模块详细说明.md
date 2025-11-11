# Auctions模块详细说明

## 概述

本文档详细说明contracts/auctions目录下的所有文件以及CustodianFixed.sol中Jintao新增的部分。这些文件构成了稳定币系统的清算和拍卖模块，是系统的核心风险控制机制。

## contracts/auctions目录文件说明

### 1. abaci.sol - 价格计算器合约

**功能**: 提供多种拍卖价格递减算法，实现荷兰式拍卖的价格计算

**核心组件**:

#### LinearDecrease (线性递减)
- **算法**: `price = top * ((tau - dur) / tau)`
- **参数**: 
  - `tau`: 拍卖开始后价格降为0的时间（秒）
  - `top`: 起始价格
  - `dur`: 拍卖已进行的时间
- **特点**: 价格随时间线性递减，简单直观

#### StairstepExponentialDecrease (阶梯指数递减)
- **算法**: `price = top * (cut ^ (dur / step))`
- **参数**:
  - `step`: 价格下降的时间间隔
  - `cut`: 每次下降的百分比（1 - 下降率）
- **特点**: 在固定时间间隔内价格保持不变，然后按指数下降

#### ExponentialDecrease (连续指数递减)
- **算法**: `price = top * (cut ^ dur)`
- **参数**: `cut`: 每秒下降的百分比
- **特点**: 价格连续按指数递减，更平滑

**使用场景**: 拍卖管理器调用这些合约来计算当前拍卖价格

### 2. AuctionManager.sol - 拍卖管理器合约

**功能**: 管理被清算资产的荷兰式拍卖流程

**核心功能**:

#### 权限管理
- `CALLER_ROLE`: 可以调用startAuction函数（清算管理器）
- `ADMIN_ROLE`: 系统管理员，可以配置参数和权限

#### 拍卖参数
```solidity
struct AuctionParams {
    uint256 priceMultiplier;     // 起始价格乘数（相对于当前价格）
    uint256 resetTime;           // 拍卖重置时间（秒）
    uint256 priceDropThreshold;  // 价格下降阈值（触发重置）
    uint256 percentageReward;    // 百分比激励（给keeper）
    uint256 fixedReward;         // 固定激励（给keeper）
    uint256 minAuctionAmount;    // 最小拍卖金额
}
```

#### 主要函数
- `startAuction()`: 启动新的拍卖
- `resetAuction()`: 重置拍卖（当价格过低或时间过长时）
- `purchaseUnderlying()`: 竞拍者购买底层资产
- `getAuctionStatus()`: 获取拍卖状态

#### 拍卖流程
1. 清算管理器调用startAuction启动拍卖
2. 价格随时间递减（使用abaci合约计算）
3. 竞拍者可以按当前价格购买底层资产
4. 如果拍卖需要重置，keeper可以调用resetAuction
5. 拍卖完成后，被清算用户可以提取稳定币

### 3. LiquidationManager.sol - 清算管理器合约

**功能**: 管理用户风险等级计算、清算触发和净值调整

**核心功能**:

#### 风险等级系统
- **等级0**: 净值 > 调整阈值(50%) - 安全状态
- **等级1-3**: 净值在调整阈值和清算阈值之间 - 警告状态
- **等级4**: 净值 < 清算阈值(30%) - 清算状态

#### 主要函数
- `bark()`: Keeper触发清算（类似MakerDAO的bark函数）
- `updateAllTokensRiskLevel()`: 更新用户所有代币的风险等级
- `updateSingleTokensRiskLevel()`: 更新单个代币的风险等级
- `adjustNetValue()`: 净值调整功能
- `withdrawStable()`: 被清算用户提取稳定币

#### 清算配置
```solidity
struct GlobalLiquidationConfig {
    uint256 adjustmentThreshold;     // 调整阈值 (0.5)
    uint256 liquidationThreshold;    // 清算阈值 (0.3)
    uint256 penalty;                 // 惩罚金 (0.03)
    bool enabled;                    // 清算功能是否启用
}
```

#### 用户状态跟踪
```solidity
struct UserLiquidationStatus {
    uint256 balance;               // 余额
    LeverageType leverageType;     // 杠杆比例
    uint8 riskLevel;               // 风险等级
    bool isLiquidated;             // 是否已被清算
    bool isUnderLiquidation;       // 是否正被清算
    bool isFreezed;                // 是否被冻结
    uint256 stableNums;            // 清算后得到的稳定币数量
    uint256 auctionId;             // 关联的拍卖ID
}
```

## 新增部分说明

- auctions下所有文件
- CustodianFixed.sol 中注释标记为Jintao added的部分

## 系统集成流程

### 1. 权限配置流程
1. 部署所有合约
2. 在Custodian中授予LiquidationManager LIQUIDATION_ROLE
3. 在Custodian中授予AuctionManager AUCTION_ROLE
4. 在AuctionManager中授予LiquidationManager CALLER_ROLE
5. 在LiquidationManager中授予AuctionManager AUCTION_ROLE
6. 在LiquidationManager中授予Custodian CUSTODIAN_ROLE

### 2. 清算触发流程
1. 用户净值低于清算阈值
2. Keeper调用LiquidationManager.bark()函数
3. LiquidationManager调用AuctionManager.startAuction()
4. AuctionManager启动荷兰式拍卖
5. 竞拍者参与拍卖购买底层资产
6. 拍卖完成后，用户调用withdrawStable提取稳定币

### 3. 净值调整流程
1. 用户净值低于调整阈值但高于清算阈值
2. 用户调用adjustNetValue进行净值调整
3. 系统创建新的代币并转移部分余额
4. 用户支付底层资产来调整净值


## 部署和配置

### 部署顺序
1. 部署基础代币合约
2. 部署业务合约（InterestManager, PriceOracle）
3. 部署CustodianFixed
4. 部署清算模块（abaci, AuctionManager, LiquidationManager）
5. 配置合约地址和权限
6. 初始化系统
具体可以参考[deploy_full_system.js](scripts/auctions_test/deploy_full_system.js)


