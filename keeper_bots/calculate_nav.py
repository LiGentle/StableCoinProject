#!/usr/bin/env python3
"""
计算杠杆代币净值脚本
正确计算当前持仓的净值，判断是否达到清算阈值
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

class NAVCalculator:
    """净值计算器"""
    
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
    
    def calculate_nav(self, leverage_type: int, mint_price: int, current_price: int):
        """计算杠杆代币净值"""
        try:
            if leverage_type == 0:  # CONSERVATIVE (1:8)
                # NAV = (9*Pt - P0) / (8*P0)
                numerator = 9 * current_price - mint_price
                denominator = 8 * mint_price
                nav = (numerator * 10**18) // denominator
                
            elif leverage_type == 1:  # MODERATE (1:4)
                # NAV = (5*Pt - P0) / (4*P0)
                numerator = 5 * current_price - mint_price
                denominator = 4 * mint_price
                nav = (numerator * 10**18) // denominator
                
            elif leverage_type == 2:  # AGGRESSIVE (1:1)
                # NAV = (2*Pt - P0) / (1*P0)
                numerator = 2 * current_price - mint_price
                denominator = mint_price
                nav = (numerator * 10**18) // denominator
                
            else:
                logger.error(f"未知杠杆类型: {leverage_type}")
                return 0
            
            return nav
            
        except Exception as e:
            logger.error(f"计算净值失败: {e}")
            return 0
    
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
    
    def analyze_position(self, user_address: str):
        """分析用户持仓的净值情况"""
        logger.info(f"🔍 分析用户 {user_address} 的持仓...")
        
        # 获取当前WLTC价格
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
            logger.info(f"  - 杠杆类型: {position['leverage_type']}")
            logger.info(f"  - 铸币价格: {position['mint_price']/10**18:.2f} USD")
            logger.info(f"  - 当前WLTC价格: {current_price/10**18:.2f} USD")
            
            # 计算净值
            nav = self.calculate_nav(
                position['leverage_type'],
                position['mint_price'],
                current_price
            )
            
            logger.info(f"  - 当前净值: {nav/10**18:.4f}")
            logger.info(f"  - 清算阈值: {liquidation_threshold/10**18:.4f}")
            
            if nav < liquidation_threshold:
                logger.info(f"  🚨 净值低于清算阈值! 需要清算")
            else:
                logger.info(f"  ✅ 净值高于清算阈值，安全")
            
            # 计算清算价格（使净值等于清算阈值的WLTC价格）
            liquidation_price = self.calculate_liquidation_price(
                position['leverage_type'],
                position['mint_price'],
                liquidation_threshold
            )
            
            logger.info(f"  - 清算价格: {liquidation_price/10**18:.2f} USD")
            logger.info(f"  - 当前价格距离清算价格: {(current_price - liquidation_price)/10**18:.2f} USD")
    
    def calculate_liquidation_price(self, leverage_type: int, mint_price: int, liquidation_threshold: int):
        """计算清算价格（使净值等于清算阈值的WLTC价格）"""
        try:
            if leverage_type == 0:  # CONSERVATIVE (1:8)
                # NAV = (9*Pt - P0) / (8*P0) = liquidation_threshold
                # 9*Pt - P0 = liquidation_threshold * 8 * P0
                # 9*Pt = liquidation_threshold * 8 * P0 + P0
                # Pt = (liquidation_threshold * 8 * P0 + P0) / 9
                liquidation_price = (liquidation_threshold * 8 * mint_price // 10**18 + mint_price) // 9
                
            elif leverage_type == 1:  # MODERATE (1:4)
                # NAV = (5*Pt - P0) / (4*P0) = liquidation_threshold
                # 5*Pt - P0 = liquidation_threshold * 4 * P0
                # 5*Pt = liquidation_threshold * 4 * P0 + P0
                # Pt = (liquidation_threshold * 4 * P0 + P0) / 5
                liquidation_price = (liquidation_threshold * 4 * mint_price // 10**18 + mint_price) // 5
                
            elif leverage_type == 2:  # AGGRESSIVE (1:1)
                # NAV = (2*Pt - P0) / (1*P0) = liquidation_threshold
                # 2*Pt - P0 = liquidation_threshold * P0
                # 2*Pt = liquidation_threshold * P0 + P0
                # Pt = (liquidation_threshold * P0 + P0) / 2
                liquidation_price = (liquidation_threshold * mint_price // 10**18 + mint_price) // 2
                
            else:
                logger.error(f"未知杠杆类型: {leverage_type}")
                return 0
            
            return liquidation_price
            
        except Exception as e:
            logger.error(f"计算清算价格失败: {e}")
            return 0
    
    def run_analysis(self):
        """运行净值分析"""
        logger.info("🎯 开始杠杆代币净值分析...")
        
        # 获取所有账户
        accounts = self.w3.eth.accounts
        
        # 分析每个账户的持仓
        for account in accounts:
            positions = self.get_user_positions(account)
            if positions:
                self.analyze_position(account)

if __name__ == "__main__":
    calculator = NAVCalculator()
    calculator.run_analysis()
