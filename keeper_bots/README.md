# Keeper Bots 使用说明

## 概述

本项目包含两个自动化的Keeper机器人，用于监控和执行稳定币系统的清算和拍卖重置操作：

1. **清算Keeper机器人** (`liquidation_keeper.py`) - 监控用户持仓，发现净值低于清算阈值的用户并执行清算
2. **拍卖重置Keeper机器人** (`auction_reset_keeper.py`) - 监控活跃拍卖，发现需要重置的拍卖并执行重置

## 功能特性

### 清算Keeper机器人
- 实时监控用户持仓的净值变化
- 链下计算除息净值，避免频繁的链上调用
- 自动执行清算操作，获取清算奖励
- 支持多种杠杆类型（保守型、稳健型、激进型）
- 可配置的检查间隔和清算参数

### 拍卖重置Keeper机器人
- 监控所有活跃拍卖的状态
- 检测需要重置的拍卖（基于时间和价格条件）
- 自动执行拍卖重置操作
- 获取重置奖励
- 可配置的拍卖参数和检查间隔

## 安装依赖

```bash
cd keeper_bots
pip install -r requirements.txt
```

## 配置说明

### 配置文件 (`config.json`)

```json
{
  "rpc_url": "http://localhost:8545",
  "is_poa": false,
  "keeper_address": "0xYourKeeperAddress",
  "private_key": "YourPrivateKey",
  "check_interval": 30,
  "contracts": {
    "custodian": "0xCustodianAddress",
    "liquidation_manager": "0xLiquidationManagerAddress",
    "leverage_token": "0xLeverageTokenAddress",
    "price_oracle": "0xPriceOracleAddress",
    "auction_manager": "0xAuctionManagerAddress"
  },
  "abi_dir": "abis"
}
```

### 配置参数说明

- `rpc_url`: 以太坊节点RPC地址
- `is_poa`: 是否为POA网络（如BSC、Polygon）
- `keeper_address`: Keeper钱包地址
- `private_key`: Keeper钱包私钥
- `check_interval`: 检查间隔（秒）
- `contracts`: 合约地址配置
- `abi_dir`: ABI文件目录

## 合约ABI文件

确保在 `abis/` 目录中包含以下合约的ABI文件：
- `CustodianFixed.json`
- `LiquidationManager.json`
- `MultiLeverageToken.json`
- `LTCPriceOracle.json`
- `AuctionManager.json`
- `LinearDecrease.json`

这些ABI文件可以从Hardhat编译输出中获取，位于 `artifacts/contracts/` 目录。

## 运行方式

### 1. 单个机器人运行

```bash
# 运行清算Keeper机器人
python liquidation_keeper.py

# 运行拍卖重置Keeper机器人
python auction_reset_keeper.py
```

### 2. 同时运行两个机器人

```bash
# 使用启动脚本
python start_bots.py

# 或使用运行脚本
python run_bots.py
```

### 3. 后台运行

```bash
# 后台运行
nohup python run_bots.py > bots.log 2>&1 &

# 查看日志
tail -f bots.log

# 停止机器人
pkill -f "python run_bots.py"
```

## 测试和验证

### 测试脚本

```bash
# 运行测试脚本
python test_bots.py

# 创建测试场景
python create_test_scenarios.py

# 本地测试设置
python local_test_setup.py
```

### 日志文件

- `liquidation_keeper.log` - 清算机器人日志
- `auction_reset_keeper.log` - 拍卖重置机器人日志

## 安全注意事项

1. **私钥安全**: 确保私钥文件安全，不要在版本控制中提交
2. **Gas费用**: 机器人会消耗Gas，确保钱包有足够的ETH
3. **网络连接**: 确保RPC节点稳定连接
4. **权限管理**: 确保Keeper地址有相应的合约权限

## 故障排除

### 常见问题

1. **ABI加载失败**
   - 检查ABI文件是否存在且格式正确
   - 确保ABI文件是从Hardhat编译输出中获取的

2. **RPC连接失败**
   - 检查RPC URL是否正确
   - 确认网络连接正常

3. **合约调用失败**
   - 检查合约地址是否正确
   - 确认Keeper地址有相应权限
   - 检查Gas费用设置

4. **交易失败**
   - 检查钱包余额是否足够支付Gas
   - 确认私钥和地址匹配

### 日志级别

可以通过修改代码中的日志配置来调整日志级别：

```python
logging.basicConfig(
    level=logging.DEBUG,  # 改为DEBUG获取更详细日志
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('liquidation_keeper.log'),
        logging.StreamHandler()
    ]
)
```

## 性能优化建议

1. **检查间隔**: 根据网络拥堵情况调整检查间隔
2. **Gas价格**: 在高峰期适当提高Gas价格
3. **批量处理**: 考虑批量处理多个清算或重置操作
4. **监控告警**: 设置监控告警，及时发现机器人异常

## 开发扩展

### 添加新的Keeper机器人

1. 创建新的机器人类，继承基础功能
2. 实现特定的监控和执行逻辑
3. 添加相应的配置和ABI文件
4. 更新启动脚本

### 自定义逻辑

可以修改以下方法来自定义机器人行为：

- `check_liquidation_eligibility()` - 清算条件检查
- `check_reset_eligibility()` - 重置条件检查
- `execute_liquidation()` - 清算执行逻辑
- `execute_reset()` - 重置执行逻辑

## 技术支持

如有问题，请检查：
1. 日志文件中的错误信息
2. 合约地址和ABI文件是否正确
3. 网络连接和Gas费用设置
4. Keeper地址的权限设置
