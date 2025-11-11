#!/usr/bin/env python3
"""
详细净值调试脚本
逐步检查净值计算的每个环节，找出问题所在
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

class DetailedNAVDebugger:
    """详细净值调试器"""
    
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
    
    def get_current_price(self):
        """获取当前WLTC价格"""
        try:
            price_data = self.contracts["price_oracle"].functions.latestRoundData().call()
            current_price = price_data[1]  # answer字段
            logger.info(f"当前WLTC价格: {current_price / 10**18:.2f} USD")
            return current_price
        except Exception as e:
            logger.error(f"获取价格失败: {e}")
            return 0
    
    def get_liquidation_threshold(self):
        """获取清算阈值"""
        try:
            global_config = self.contracts["liquidation_manager"].functions.globalConfig().call()
            liquidation_threshold = global_config[1]  # liquidationThreshold字段
            logger.info(f"清算阈值: {liquidation_threshold/10**18:.4f}")
            return liquidation_threshold
        except Exception as e:
            logger.error(f"获取清算阈值失败: {e}")
            return int(Decimal("0.3") * 10**18)  # 默认值 0.3
    
    def get_user_positions(self, user_address: str):
        """获取用户持仓"""
        try:
            custodian_contract = self.contracts["custodian"]
            
            # 获取用户所有token信息
            token_info = custodian_contract.functions.getAllLeverageTokenInfo(
                user_address
            ).call()
            
            token_ids, balances, leverages, mint_prices, accrued_interests = token_info
            
            positions = []
            for i in range(len(token_ids)):
                if balances[i] > 0:  # 只处理有余额的持仓
                    position = {
                        'token_id': token_ids[i],
                        'balance': balances[i],
                        'leverage_type': leverages[i],
                        'mint_price': mint_prices[i],
                        'accrued_interest': accrued_interests[i]
                    }
                    positions.append(position)
                    
            return positions
        except Exception as e:
            logger.error(f"获取用户 {user_address} 持仓失败: {e}")
            return []
    
    def debug_nav_calculation(self, leverage_type: int, mint_price: int, current_price: int, balance: int, accrued_interest: int):
        """详细调试净值计算"""
        logger.info("🔍 详细调试净值计算:")
        logger.info(f"  - 杠杆类型: {leverage_type}")
        logger.info(f"  - 铸币价格: {mint_price/10**18:.2f} USD")
        logger.info(f"  - 当前价格: {current_price/10**18:.2f} USD")
        logger.info(f"  - 持仓余额: {balance/10**18:.2f}")
        logger.info(f"  - 累计利息: {accrued_interest/10**18:.2f}")
        
        # 计算总净值
        if leverage_type == 0:  # CONSERVATIVE (1:8)
            logger.info("  - 杠杆类型: CONSERVATIVE (1:8)")
            numerator = 9 * current_price - mint_price
            denominator = 8 * mint_price
            logger.info(f"  - 分子: 9 * {current_price/10**18:.2f} - {mint_price/10**18:.2f} = {numerator/10**18:.2f}")
            logger.info(f"  - 分母: 8 * {mint_price/10**18:.2f} = {denominator/10**18:.2f}")
            
        elif leverage_type == 1:  # MODERATE (1:4)
            logger.info("  - 杠杆类型: MODERATE (1:4)")
            numerator = 5 * current_price - mint_price
            denominator = 4 * mint_price
            logger.info(f"  - 分子: 5 * {current_price/10**18:.2f} - {mint_price/10**18:.2f} = {numerator/10**18:.2f}")
            logger.info(f"  - 分母: 4 * {mint_price/10**18:.2f} = {denominator/10**18:.2f}")
            
        elif leverage_type == 2:  # AGGRESSIVE (1:1)
            logger.info("  - 杠杆类型: AGGRESSIVE (1:1)")
            numerator = 2 * current_price - mint_price
            denominator = mint_price
            logger.info(f"  - 分子: 2 * {current_price/10**18:.2f} - {mint_price/10**18:.2f} = {numerator/10**18:.2f}")
            logger.info(f"  - 分母: {mint_price/10**18:.2f}")
            
        else:
            logger.error(f"未知杠杆类型: {leverage_type}")
            return 0, 0
        
        # 计算总净值
        gross_nav = (numerator * 10**18) // denominator
        logger.info(f"  - 总净值: {gross_nav/10**18:.4f}")
        
        # 计算总价值
        total_value = (balance * gross_nav) // 10**18
        logger.info(f"  - 总价值: {total_value/10**18:.2f}")
        
        # 计算除息净值
        if total_value >= accrued_interest:
            net_nav = ((total_value - accrued_interest) * 10**18) // balance
            logger.info(f"  - 除息净值: {net_nav/10**18:.4f}")
        else:
            net_nav = 0
            logger.info(f"  - 除息净值: 0 (总价值小于累计利息)")
        
        return gross_nav, net_nav
    
    def debug_liquidation_keeper_logic(self, user_address: str):
        """调试清算机器人中的逻辑"""
        logger.info("🔧 调试清算机器人中的净值计算逻辑:")
        
        # 获取当前价格
        current_price = self.get_current_price()
        if current_price == 0:
            logger.error("无法获取当前价格")
            return
        
        # 获取清算阈值
        liquidation_threshold = self.get_liquidation_threshold()
        
        # 获取用户持仓
        positions = self.get_user_positions(user_address)
        
        for position in positions:
            logger.info(f"📊 分析Token {position['token_id']}:")
            
            # 详细调试净值计算
            gross_nav, net_nav = self.debug_nav_calculation(
                position['leverage_type'],
                position['mint_price'],
                current_price,
                position['balance'],
                position['accrued_interest']
            )
            
            logger.info(f"  - 清算阈值: {liquidation_threshold/10**18:.4f}")
            
            # 检查是否应该清算
            should_liquidate = net_nav < liquidation_threshold
            logger.info(f"  - 应该清算: {should_liquidate}")
            
            # 检查合约中的清算状态
            try:
                status = self.contracts["liquidation_manager"].functions.userLiquidationStatus(
                    user_address, position['token_id']
                ).call()
                
                is_freezed = status[5]
                is_under_liquidation = status[4]
                
                logger.info(f"  - 合约状态: 冻结={is_freezed}, 清算中={is_under_liquidation}")
                
            except Exception as e:
                logger.error(f"  - 检查合约状态失败: {e}")
            
            # 分析问题
            if should_liquidate:
                logger.info("  🚨 应该清算但机器人没有检测到!")
                logger.info("  ❓ 可能原因:")
                logger.info("    - 清算机器人中的净值计算逻辑有误")
                logger.info("    - 机器人没有正确调用check_liquidation_eligibility方法")
                logger.info("    - 机器人中的用户列表获取有问题")
            else:
                logger.info("  ✅ 净值高于清算阈值，不需要清算")

if __name__ == "__main__":
    debugger = DetailedNAVDebugger()
    
    # 获取所有账户
    accounts = debugger.w3.eth.accounts
    
    # 调试第一个有持仓的账户
    for account in accounts:
        positions = debugger.get_user_positions(account)
        if positions:
            debugger.debug_liquidation_keeper_logic(account)
            break
