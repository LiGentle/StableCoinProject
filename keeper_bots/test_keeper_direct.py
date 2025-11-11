#!/usr/bin/env python3
"""
直接测试清算机器人方法
直接调用清算机器人的方法，检查为什么没有检测到清算机会
"""

import logging
from web3 import Web3
import json
import os
from decimal import Decimal

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class DirectKeeperTester:
    """直接清算机器人测试器"""
    
    def __init__(self, config_path: str = "config.json"):
        self.config = self._load_config(config_path)
        self.w3 = self._setup_web3()
        self.contracts = self._load_contracts()
        
    def _load_config(self, config_path: str) -> dict:
        """加载配置文件"""
        try:
            with open(config_path, 'r') as f:
                config = json.load(f)
            logger.info(f"配置文件加载成功: {config_path}")
            return config
        except Exception as e:
            logger.error(f"配置文件加载失败: {e}")
            raise
    
    def _setup_web3(self) -> Web3:
        """设置Web3连接"""
        rpc_url = self.config.get("rpc_url", "http://localhost:8545")
        w3 = Web3(Web3.HTTPProvider(rpc_url))
        
        if not w3.is_connected():
            raise ConnectionError("无法连接到以太坊节点")
            
        logger.info(f"Web3连接成功，网络ID: {w3.eth.chain_id}")
        return w3
    
    def _load_contracts(self) -> dict:
        """加载合约实例"""
        contracts = {}
        
        # 加载合约ABI
        abi_dir = self.config.get("abi_dir", "abis")
        
        # 加载CustodianFixed合约
        with open(os.path.join(abi_dir, "CustodianFixed.json"), 'r') as f:
            custodian_artifact = json.load(f)
            custodian_abi = custodian_artifact["abi"]
        custodian_address = self.config["contracts"]["custodian"]
        contracts["custodian"] = self.w3.eth.contract(
            address=custodian_address,
            abi=custodian_abi
        )
        
        # 加载LiquidationManager合约
        with open(os.path.join(abi_dir, "LiquidationManager.json"), 'r') as f:
            liquidation_artifact = json.load(f)
            liquidation_abi = liquidation_artifact["abi"]
        liquidation_address = self.config["contracts"]["liquidation_manager"]
        contracts["liquidation_manager"] = self.w3.eth.contract(
            address=liquidation_address,
            abi=liquidation_abi
        )
        
        # 加载PriceOracle合约
        with open(os.path.join(abi_dir, "LTCPriceOracle.json"), 'r') as f:
            oracle_artifact = json.load(f)
            oracle_abi = oracle_artifact["abi"]
        oracle_address = self.config["contracts"]["price_oracle"]
        contracts["price_oracle"] = self.w3.eth.contract(
            address=oracle_address,
            abi=oracle_abi
        )
        
        logger.info("所有合约实例加载完成")
        return contracts
    
    def test_keeper_methods_directly(self):
        """直接测试清算机器人的方法"""
        logger.info("🧪 直接测试清算机器人的方法:")
        
        # 获取当前价格
        try:
            price_data = self.contracts["price_oracle"].functions.latestRoundData().call()
            current_price = price_data[1]  # answer字段
            logger.info(f"当前WLTC价格: {current_price / 10**18:.2f} USD")
        except Exception as e:
            logger.error(f"获取价格失败: {e}")
            return
        
        # 获取清算阈值
        try:
            global_config = self.contracts["liquidation_manager"].functions.globalConfig().call()
            liquidation_threshold = global_config[1]  # liquidationThreshold字段
            logger.info(f"清算阈值: {liquidation_threshold/10**18:.4f}")
        except Exception as e:
            logger.error(f"获取清算阈值失败: {e}")
            liquidation_threshold = int(Decimal("0.3") * 10**18)
        
        # 测试用户列表获取
        logger.info("📋 测试用户列表获取:")
        test_users = [
            "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",  # 默认Hardhat账户0
            "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",  # 默认Hardhat账户1
            "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"   # 默认Hardhat账户2
        ]
        
        users_with_positions = []
        for user in test_users:
            try:
                # 获取用户所有token信息
                token_info = self.contracts["custodian"].functions.getAllLeverageTokenInfo(user).call()
                token_ids, balances, leverages, mint_prices, accrued_interests = token_info
                
                has_position = False
                for i in range(len(token_ids)):
                    if balances[i] > 0:
                        has_position = True
                        break
                
                if has_position:
                    users_with_positions.append(user)
                    logger.info(f"  ✅ 用户 {user} 有持仓")
                else:
                    logger.info(f"  ❌ 用户 {user} 没有持仓")
                    
            except Exception as e:
                logger.error(f"  ❌ 检查用户 {user} 持仓失败: {e}")
        
        logger.info(f"找到 {len(users_with_positions)} 个有持仓的用户")
        
        # 测试清算检查逻辑
        for user in users_with_positions:
            logger.info(f"🔍 测试用户 {user} 的清算检查:")
            
            try:
                # 获取用户持仓
                token_info = self.contracts["custodian"].functions.getAllLeverageTokenInfo(user).call()
                token_ids, balances, leverages, mint_prices, accrued_interests = token_info
                
                for i in range(len(token_ids)):
                    if balances[i] > 0:
                        logger.info(f"  📊 Token {token_ids[i]}:")
                        logger.info(f"    - 余额: {balances[i]/10**18:.2f}")
                        logger.info(f"    - 杠杆类型: {leverages[i]}")
                        logger.info(f"    - 铸币价格: {mint_prices[i]/10**18:.2f} USD")
                        logger.info(f"    - 累计利息: {accrued_interests[i]/10**18:.2f}")
                        
                        # 检查清算状态
                        try:
                            status = self.contracts["liquidation_manager"].functions.userLiquidationStatus(
                                user, token_ids[i]
                            ).call()
                            
                            is_freezed = status[5]
                            is_under_liquidation = status[4]
                            
                            logger.info(f"    - 合约状态: 冻结={is_freezed}, 清算中={is_under_liquidation}")
                            
                            if is_freezed or is_under_liquidation:
                                logger.info(f"    - 不能清算: 已被冻结或正在清算中")
                                continue
                                
                        except Exception as e:
                            logger.error(f"    - 检查合约状态失败: {e}")
                            continue
                        
                        # 计算净值（复制清算机器人中的逻辑）
                        leverage_type = leverages[i]
                        mint_price = mint_prices[i]
                        balance = balances[i]
                        accrued_interest = accrued_interests[i]
                        
                        if leverage_type == 0:  # CONSERVATIVE (1:8)
                            numerator = 9 * current_price - mint_price
                            denominator = 8 * mint_price
                            gross_nav = (numerator * 10**18) // denominator
                            
                        elif leverage_type == 1:  # MODERATE (1:4)
                            numerator = 5 * current_price - mint_price
                            denominator = 4 * mint_price
                            gross_nav = (numerator * 10**18) // denominator
                            
                        elif leverage_type == 2:  # AGGRESSIVE (1:1)
                            numerator = 2 * current_price - mint_price
                            denominator = mint_price
                            gross_nav = (numerator * 10**18) // denominator
                            
                        else:
                            logger.error(f"    - 未知杠杆类型: {leverage_type}")
                            continue
                        
                        logger.info(f"    - 总净值: {gross_nav/10**18:.4f}")
                        
                        # 计算总价值
                        total_value = (balance * gross_nav) // 10**18
                        logger.info(f"    - 总价值: {total_value/10**18:.2f}")
                        
                        # 计算除息净值
                        if total_value >= accrued_interest:
                            net_nav = ((total_value - accrued_interest) * 10**18) // balance
                            logger.info(f"    - 除息净值: {net_nav/10**18:.4f}")
                        else:
                            net_nav = 0
                            logger.info(f"    - 除息净值: 0 (总价值小于累计利息)")
                        
                        # 检查是否应该清算
                        should_liquidate = net_nav < liquidation_threshold
                        logger.info(f"    - 应该清算: {should_liquidate}")
                        
                        if should_liquidate:
                            logger.info(f"    🚨 发现清算机会! 用户: {user}, Token: {token_ids[i]}")
                        else:
                            logger.info(f"    ✅ 不需要清算")
                            
            except Exception as e:
                logger.error(f"  ❌ 测试用户 {user} 失败: {e}")

if __name__ == "__main__":
    tester = DirectKeeperTester()
    tester.test_keeper_methods_directly()
