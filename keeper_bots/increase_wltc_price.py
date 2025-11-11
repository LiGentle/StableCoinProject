#!/usr/bin/env python3
"""
提高WLTC价格脚本
将WLTC价格从30 USD提高到400 USD，使净值为正
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

class PriceUpdater:
    """WLTC价格更新器"""
    
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
        
        # 加载PriceOracle合约
        with open(os.path.join(abi_dir, "LTCPriceOracle.json"), 'r') as f:
            oracle_artifact = json.load(f)
            oracle_abi = oracle_artifact["abi"]
        oracle_address = self.config["contracts"]["price_oracle"]
        contracts["price_oracle"] = self.w3.eth.contract(
            address=oracle_address,
            abi=oracle_abi
        )
        
        # 加载CustodianFixed合约
        with open(os.path.join(abi_dir, "CustodianFixed.json"), 'r') as f:
            custodian_artifact = json.load(f)
            custodian_abi = custodian_artifact["abi"]
        custodian_address = self.config["contracts"]["custodian"]
        contracts["custodian"] = self.w3.eth.contract(
            address=custodian_address,
            abi=custodian_abi
        )
        
        logger.info("合约实例加载完成")
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
    
    def update_price(self, new_price_usd: float):
        """更新WLTC价格"""
        try:
            # 将价格转换为wei单位
            new_price_wei = int(new_price_usd * 10**18)
            
            # 获取管理员账户
            admin_account = self.w3.eth.accounts[0]
            
            # 构建更新价格交易
            update_function = self.contracts["price_oracle"].functions.updatePrice(new_price_wei)
            
            # 估算gas
            gas_estimate = update_function.estimate_gas({
                'from': admin_account,
                'nonce': self.w3.eth.get_transaction_count(admin_account)
            })
            
            # 构建交易
            transaction = update_function.build_transaction({
                'from': admin_account,
                'gas': gas_estimate + 10000,  # 增加一些缓冲
                'gasPrice': self.w3.eth.gas_price,
                'nonce': self.w3.eth.get_transaction_count(admin_account),
            })
            
            # 签名并发送交易
            signed_txn = self.w3.eth.account.sign_transaction(transaction, self.config["private_key"])
            tx_hash = self.w3.eth.send_raw_transaction(signed_txn.raw_transaction)
            
            # 等待交易确认
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            if receipt.status == 1:
                logger.info(f"价格更新成功! 新价格: {new_price_usd:.2f} USD, 交易哈希: {tx_hash.hex()}")
                return True
            else:
                logger.error(f"价格更新失败! 交易哈希: {tx_hash.hex()}")
                return False
                
        except Exception as e:
            logger.error(f"更新价格失败: {e}")
            return False
    
    def calculate_nav_after_price_change(self, leverage_type: int, mint_price: int, new_price: int):
        """计算价格变化后的净值"""
        try:
            if leverage_type == 0:  # CONSERVATIVE (1:8)
                # NAV = (9*Pt - P0) / (8*P0)
                numerator = 9 * new_price - mint_price
                denominator = 8 * mint_price
                nav = (numerator * 10**18) // denominator
                
            elif leverage_type == 1:  # MODERATE (1:4)
                # NAV = (5*Pt - P0) / (4*P0)
                numerator = 5 * new_price - mint_price
                denominator = 4 * mint_price
                nav = (numerator * 10**18) // denominator
                
            elif leverage_type == 2:  # AGGRESSIVE (1:1)
                # NAV = (2*Pt - P0) / (1*P0)
                numerator = 2 * new_price - mint_price
                denominator = mint_price
                nav = (numerator * 10**18) // denominator
                
            else:
                logger.error(f"未知杠杆类型: {leverage_type}")
                return 0
            
            return nav
            
        except Exception as e:
            logger.error(f"计算净值失败: {e}")
            return 0
    
    def check_user_position_nav(self, user_address: str, new_price: int):
        """检查用户持仓在价格变化后的净值"""
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
                    
            # 计算净值
            for position in positions:
                nav = self.calculate_nav_after_price_change(
                    position['leverage_type'],
                    position['mint_price'],
                    new_price
                )
                
                logger.info(f"Token {position['token_id']}:")
                logger.info(f"  - 杠杆类型: {position['leverage_type']}")
                logger.info(f"  - 铸币价格: {position['mint_price']/10**18:.2f} USD")
                logger.info(f"  - 新WLTC价格: {new_price/10**18:.2f} USD")
                logger.info(f"  - 计算净值: {nav/10**18:.4f}")
                
                # 检查是否应该清算
                liquidation_threshold = int(Decimal("0.3") * 10**18)
                should_liquidate = nav < liquidation_threshold
                logger.info(f"  - 应该清算: {should_liquidate}")
                
            return positions
            
        except Exception as e:
            logger.error(f"检查用户持仓失败: {e}")
            return []

if __name__ == "__main__":
    updater = PriceUpdater()
    
    # 获取当前价格
    current_price = updater.get_current_price()
    logger.info(f"当前WLTC价格: {current_price/10**18:.2f} USD")
    
    # 将价格提高到400 USD
    new_price_usd = 400.0
    logger.info(f"准备将WLTC价格提高到: {new_price_usd:.2f} USD")
    
    # 检查价格变化后的净值
    accounts = updater.w3.eth.accounts
    for account in accounts:
        positions = updater.check_user_position_nav(account, int(new_price_usd * 10**18))
        if positions:
            break
    
    # 更新价格
    success = updater.update_price(new_price_usd)
    
    if success:
        # 验证新价格
        new_current_price = updater.get_current_price()
        logger.info(f"价格更新验证: {new_current_price/10**18:.2f} USD")
        
        # 再次检查净值
        for account in accounts:
            positions = updater.check_user_position_nav(account, new_current_price)
            if positions:
                break
