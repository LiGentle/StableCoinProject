#!/usr/bin/env python3
"""
检查用户持仓脚本
检查当前系统中是否有用户持仓
"""

import logging
from web3 import Web3
import json
import os

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class PositionChecker:
    """持仓检查器"""
    
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
    
    def get_all_accounts(self):
        """获取所有账户"""
        accounts = self.w3.eth.accounts
        logger.info(f"可用账户: {len(accounts)}")
        for i, account in enumerate(accounts):
            balance = self.w3.eth.get_balance(account)
            logger.info(f"账户 {i}: {account} - 余额: {balance/10**18:.4f} ETH")
        return accounts
    
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
    
    def check_liquidation_status(self, user_address: str, token_id: int):
        """检查用户清算状态"""
        try:
            liquidation_contract = self.contracts["liquidation_manager"]
            
            status = liquidation_contract.functions.userLiquidationStatus(
                user_address, token_id
            ).call()
            
            is_freezed = status[5]
            is_under_liquidation = status[4]
            
            logger.info(f"用户 {user_address} Token {token_id} 状态: 冻结={is_freezed}, 清算中={is_under_liquidation}")
            return status
        except Exception as e:
            logger.error(f"检查清算状态失败: {e}")
            return None
    
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
    
    def run_check(self):
        """运行持仓检查"""
        logger.info("🔍 开始检查用户持仓...")
        
        # 获取所有账户
        accounts = self.get_all_accounts()
        
        # 获取当前价格
        current_price = self.get_current_price()
        
        # 检查每个账户的持仓
        total_positions = 0
        for account in accounts:
            positions = self.get_user_positions(account)
            if positions:
                logger.info(f"📊 账户 {account} 有 {len(positions)} 个持仓:")
                for position in positions:
                    logger.info(f"  - Token {position['token_id']}: 余额={position['balance']/10**18:.2f}, 杠杆类型={position['leverage_type']}, 铸币价格={position['mint_price']/10**18:.2f}")
                    
                    # 检查清算状态
                    self.check_liquidation_status(account, position['token_id'])
                    
                    total_positions += 1
        
        if total_positions == 0:
            logger.info("❌ 没有发现任何用户持仓")
        else:
            logger.info(f"✅ 总共发现 {total_positions} 个持仓")
        
        return total_positions > 0

if __name__ == "__main__":
    checker = PositionChecker()
    has_positions = checker.run_check()
    
    if has_positions:
        logger.info("✅ 系统中有用户持仓，可以测试清算机器人")
    else:
        logger.info("❌ 系统中没有用户持仓，需要先创建测试数据")
