# 正确的 Getter 函数解决方案

## 问题分析

**"Identifier already declared" 错误的原因：**

在 Solidity 中，当你尝试手动添加一个与现有变量同名的函数时，会出现命名冲突。即使变量不是 `public`，编译器仍然会保留该名称。

## 解决方案

### 方案 A：使用不同的函数名（推荐）

在 `CustodianFixed.sol` 中添加：

```solidity
// 状态变量 getter
function getState() external view returns (State) {
    return state;
}

// 清算和拍卖合约地址 getter
function getLiquidationManager() external view returns (address) {
    return address(liquidationManager);
}

function getAuctionManager() external view returns (address) {
    return address(auctionManager);
}
```

### 方案 B：将变量改为 public（不推荐）

```solidity
// 修改现有变量定义
State public state;
Liquidation public liquidationManager;
DuchAuction public auctionManager;
```

**不推荐的原因：**
- 可能会暴露不应该公开的内部状态
- 改变现有变量的可见性可能有副作用

### 方案 C：使用前缀命名约定

```solidity
// 使用前缀避免命名冲突
function currentState() external view returns (State) {
    return state;
}

function liquidationManagerAddress() external view returns (address) {
    return address(liquidationManager);
}

function auctionManagerAddress() external view returns (address) {
    return address(auctionManager);
}
```

## 推荐的完整解决方案

### 1. 在 `CustodianFixed.sol` 中添加：

```solidity
// 在合约的适当位置添加以下函数：

/**
 * @dev 获取当前合约状态
 */
function getState() external view returns (State) {
    return state;
}

/**
 * @dev 获取清算管理器地址
 */
function getLiquidationManager() external view returns (address) {
    return address(liquidationManager);
}

/**
 * @dev 获取拍卖管理器地址
 */
function getAuctionManager() external view returns (address) {
    return address(auctionManager);
}
```

### 2. 在 `AuctionManager.sol` 中添加：

```solidity
/**
 * @dev 获取托管合约地址
 */
function getCustodian() external view returns (address) {
    return address(custodian);
}

/**
 * @dev 获取清算管理器地址
 */
function getLiquidationManager() external view returns (address) {
    return address(liquidationManager);
}

/**
 * @dev 获取价格计算器地址
 */
function getPriceCalculator() external view returns (address) {
    return address(priceCalculator);
}

/**
 * @dev 获取稳定币合约地址
 */
function getStableToken() external view returns (address) {
    return address(stableToken);
}
```

### 3. 在 `LiquidationManager.sol` 中添加：

```solidity
/**
 * @dev 获取托管合约地址
 */
function getCustodian() external view returns (address) {
    return address(custodian);
}

/**
 * @dev 获取拍卖合约地址
 */
function getAuction() external view returns (address) {
    return address(auction);
}

/**
 * @dev 获取杠杆代币合约地址
 */
function getLeverageToken() external view returns (address) {
    return address(leverageToken);
}
```

## 测试脚本的相应修改

在 `test_full_system.js` 中修改调用：

```javascript
// 修改前：
const custodianAddr = await auctionManager.custodian();
const liquidationAddr = await custodian.liquidationManager();

// 修改后：
const custodianAddr = await auctionManager.getCustodian();
const liquidationAddr = await custodian.getLiquidationManager();

// 状态检查：
const currentState = await custodian.getState();
```

## 总结

**使用 `get` 前缀的命名约定**是最佳实践，因为：
1. 避免命名冲突
2. 明确表示这是 getter 函数
3. 符合 Solidity 开发的最佳实践
4. 易于理解和维护
