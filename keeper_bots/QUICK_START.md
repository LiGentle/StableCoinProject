# Keeper Bots 快速启动指南

## 🚀 快速开始

### 1. 环境准备
```bash
# 进入项目目录
cd keeper_bots

# 安装依赖
pip install -r requirements.txt
```

### 2. 配置设置
```bash
# 如果配置文件不存在，会自动创建示例配置
python liquidation_keeper.py
```

### 3. 修改配置文件
编辑 `config.json` 文件，设置以下关键参数：
- `keeper_address`: 你的Keeper钱包地址
- `private_key`: 你的钱包私钥
- `contracts`: 所有合约地址
- `rpc_url`: 以太坊节点URL

### 4. 运行测试
```bash
# 运行完整测试
python test_bots.py
```

### 5. 启动机器人
```bash
# 同时启动两个机器人
python run_bots.py

# 或分别启动
python liquidation_keeper.py &
python auction_reset_keeper.py &
```

## 📋 关键文件说明

- `liquidation_keeper.py` - 清算机器人
- `auction_reset_keeper.py` - 拍卖重置机器人
- `run_bots.py` - 同时运行两个机器人
- `start_bots.py` - 启动脚本（带错误处理）
- `test_bots.py` - 测试脚本
- `config.json` - 配置文件
- `requirements.txt` - Python依赖

## 🔧 故障排除

### 常见问题

1. **ABI加载失败**
   - 确保 `abis/` 目录包含所有合约的ABI文件
   - ABI文件应从Hardhat编译输出获取

2. **RPC连接失败**
   - 检查 `rpc_url` 是否正确
   - 确认网络连接正常

3. **合约调用失败**
   - 检查合约地址是否正确
   - 确认Keeper地址有相应权限

4. **交易失败**
   - 检查钱包余额是否足够支付Gas
   - 确认私钥和地址匹配

### 日志查看
```bash
# 查看清算机器人日志
tail -f liquidation_keeper.log

# 查看拍卖重置机器人日志
tail -f auction_reset_keeper.log
```

## ⚡ 性能优化

- **检查间隔**: 默认30秒，可根据网络情况调整
- **Gas价格**: 自动使用当前网络Gas价格
- **错误重试**: 内置错误处理和重试机制

## 🔒 安全提醒

1. **私钥安全**: 不要在版本控制中提交私钥
2. **权限管理**: 确保Keeper地址有清算和拍卖重置权限
3. **监控告警**: 建议设置机器人运行状态监控

## 📞 技术支持

如果遇到问题：
1. 查看日志文件获取详细错误信息
2. 运行测试脚本验证配置
3. 检查合约地址和ABI文件

---

**🎯 现在你可以开始运行Keeper机器人了！**
