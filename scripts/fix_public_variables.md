# 修复合约变量为 Public 的修改指南

## 需要修改的合约文件

### 1. `contracts/CustodianFixed.sol`

**修改前：**
```solidity
Liquidation liquidationManager;
DuchAuction auctionManager;
```

**修改后：**
```solidity
Liquidation public liquidationManager;
DuchAuction public auctionManager;
```

### 2. `contracts/auctions/LiquidationManager.sol`

**修改前：**
```solidity
CustodianLike public custodian;
AuctionLike public auction;
MultiLeverageToken public leverageToken;
```

**修改后：**
```solidity
CustodianLike public custodian;
AuctionLike public auction;
MultiLeverageToken public leverageToken;
```

**注意：** 在 `LiquidationManager.sol` 中这些变量已经是 `public`，但可能由于 ABI 缓存问题仍然无法正常工作。

## 问题分析

### 当前状态：
- **AuctionManager.sol** - ✅ 所有关键变量已经是 `public`
- **CustodianFixed.sol** - ❌ `liquidationManager` 和 `auctionManager` 不是 `public`
- **LiquidationManager.sol** - ✅ 所有关键变量已经是 `public`

### 根本原因：
即使我们重新部署了合约，如果合约代码中的变量没有定义为 `public`，Solidity 编译器不会自动生成 getter 函数。

## 解决方案

### 步骤 1：修改合约代码
在相应的合约文件中将上述变量改为 `public`。

### 步骤 2：重新编译和部署
```bash
npx hardhat run scripts/deploy_full_system.js --network hardhatMainnet
```

### 步骤 3：验证修复
```bash
npx hardhat run scripts/verify_getters.js --network hardhatMainnet
```

## 预期结果

修复后，以下 getter 函数应该能正常工作：

### CustodianFixed.sol
- `custodian.liquidationManager()` - 返回清算管理器地址
- `custodian.auctionManager()` - 返回拍卖管理器地址
- `custodian.LIQUIDATION_ROLE()` - 返回角色常量

### AuctionManager.sol
- `auctionManager.custodian()` - 返回托管合约地址
- `auctionManager.liquidationManager()` - 返回清算管理器地址
- `auctionManager.stableToken()` - 返回稳定币合约地址

### LiquidationManager.sol
- `liquidationManager.custodian()` - 返回托管合约地址
- `liquidationManager.auction()` - 返回拍卖合约地址
- `liquidationManager.leverageToken()` - 返回杠杆代币合约地址

## 测试脚本修改

修复后，`test_full_system.js` 中的连接检查和权限检查应该能正常工作：

```javascript
// 合约连接检查
const custodianAddr = await auctionManager.custodian();
const liquidationAddr = await custodian.liquidationManager();
const auctionAddr = await custodian.auctionManager();

// 权限检查
const hasLiquidationRole = await custodian.hasRole(
    await custodian.LIQUIDATION_ROLE(),
    deploymentInfo.liquidationManager
);
```

## 注意事项

1. **ABI 缓存**：如果修改后仍然有问题，可能需要清除 Hardhat 缓存：
   ```bash
   npx hardhat clean
   ```

2. **重新编译**：确保修改后重新编译所有合约。

3. **测试验证**：使用 `scripts/verify_getters.js` 验证修复是否成功。
