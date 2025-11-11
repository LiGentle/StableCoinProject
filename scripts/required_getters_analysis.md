# 需要添加的 Getter 函数分析

## 基于 `test_full_system.js` 的需求分析

### 1. `CustodianFixed.sol` 需要添加的 getter 函数

**当前缺失的 getter 函数：**
```solidity
// 需要添加以下公开 getter 函数：

// 状态变量
function state() external view returns (State) {
    return state;
}

// 清算和拍卖合约地址
function liquidationManager() external view returns (address) {
    return address(liquidationManager);
}

function auctionManager() external view returns (address) {
    return address(auctionManager);
}

// 角色常量（虽然已经有 public，但需要确保 ABI 正确）
// 当前已有：LIQUIDATION_ROLE, ADMIN_ROLE, AUCTION_ROLE
```

### 2. `AuctionManager.sol` 需要添加的 getter 函数

**当前缺失的 getter 函数：**
```solidity
// 需要添加以下公开 getter 函数：

// 核心合约地址
function custodian() external view returns (address) {
    return address(custodian);
}

function liquidationManager() external view returns (address) {
    return address(liquidationManager);
}

function priceCalculator() external view returns (address) {
    return address(priceCalculator);
}

function stableToken() external view returns (address) {
    return address(stableToken);
}

// 角色常量
// 当前已有：CALLER_ROLE, ADMIN_ROLE
```

### 3. `LiquidationManager.sol` 需要添加的 getter 函数

**当前缺失的 getter 函数：**
```solidity
// 需要添加以下公开 getter 函数：

// 核心合约地址
function custodian() external view returns (address) {
    return address(custodian);
}

function auction() external view returns (address) {
    return address(auction);
}

function leverageToken() external view returns (address) {
    return address(leverageToken);
}

// 角色常量
// 当前已有：CUSTODIAN_ROLE, AUCTION_ROLE, ADMIN_ROLE
```

### 4. 其他合约的 getter 函数状态

**`StableToken.sol`** - ✅ 已有完整 getter：
- `custodian()` - 已有
- `getCustodian()` - 已有
- `isCustodianSet()` - 已有

**`MultiLeverageToken.sol`** - ✅ 已有完整 getter：
- `custodian()` - 已有

**`InterestManager.sol`** - ✅ 已有完整 getter：
- `custodian()` - 已有

### 5. 测试脚本中需要修复的函数调用

在 `test_full_system.js` 中，以下调用需要对应的 getter 函数：

```javascript
// 需要修复的调用：
const custodianAddr = await auctionManager.custodian(); // ❌ 缺少 getter
const liquidationAddr = await custodian.liquidationManager(); // ❌ 缺少 getter

// 权限检查需要角色常量 getter
const hasLiquidationRole = await custodian.hasRole(
    await custodian.LIQUIDATION_ROLE(), // ❌ 角色常量 getter 问题
    deploymentInfo.liquidationManager
);
```

### 6. 建议的修复方案

**方案 A：添加缺失的 getter 函数**
```solidity
// 在 CustodianFixed.sol 中添加：
function state() external view returns (State) { return state; }
function liquidationManager() external view returns (address) { return address(liquidationManager); }
function auctionManager() external view returns (address) { return address(auctionManager); }

// 在 AuctionManager.sol 中添加：
function custodian() external view returns (address) { return address(custodian); }
function liquidationManager() external view returns (address) { return address(liquidationManager); }
function priceCalculator() external view returns (address) { return address(priceCalculator); }
function stableToken() external view returns (address) { return address(stableToken); }

// 在 LiquidationManager.sol 中添加：
function custodian() external view returns (address) { return address(custodian); }
function auction() external view returns (address) { return address(auction); }
function leverageToken() external view returns (address) { return address(leverageToken); }
```

**方案 B：修改测试脚本**
- 跳过这些检查，因为部署脚本已经验证了合约连接
- 专注于测试核心业务功能

### 7. 优先级建议

**高优先级**：
- `custodian.state()` - 用于检查合约状态
- `auctionManager.custodian()` - 用于合约连接验证

**中优先级**：
- 其他合约地址 getter 函数
- 角色常量 getter 函数

**低优先级**：
- 统计信息 getter 函数（已有替代方案）
