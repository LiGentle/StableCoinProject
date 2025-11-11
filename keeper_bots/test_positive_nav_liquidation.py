#!/usr/bin/env python3
"""
测试净值为正时的清算功能
将WLTC价格调整到刚好使净值低于清算阈值，然后测试清算
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

class PositiveNavLiquidationTester:
    """正净值清算测试器"""
    
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
        
        # 加载LiquidationManager合约
        with open(os.path.join(abi_dir, "LiquidationManager.json"), 'r') as f:
            liquidation_artifact = json.load(f)
            liquidation_abi = liquidation_artifact["abi"]
        liquidation_address = self.config["contracts"]["liquidation_manager"]
        contracts["liquidation_manager"] = self.w3.eth.contract(
            address=liquidation_address,
            abi=liquidation_abi
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
    
    def calculate_nav_for_leverage(self, leverage_type: int, mint_price: int, current_price: int):
        """计算特定杠杆类型的净值"""
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
    
    def find_liquidation_price(self, leverage_type: int, mint_price: int, liquidation_threshold: float = 0.3):
        """找到触发清算的价格"""
        liquidation_threshold_wei = int(liquidation_threshold * 10**18)
        
        # 对于MODERATE杠杆(1:4)，净值公式: NAV = (5*Pt - P0) / (4*P0)
        # 当NAV < 0.3时触发清算: (5*Pt - P0) / (4*P0) < 0.3
        # 5*Pt - P0 < 1.2*P0
        # 5*Pt < 2.2*P0
        # Pt < 0.44*P0
        
        if leverage_type == 1:  # MODERATE (1:4)
            liquidation_price = int(0.44 * mint_price)
            liquidation_nav = self.calculate_nav_for_leverage(leverage_type, mint_price, liquidation_price)
            
            logger.info(f"触发清算的价格: {liquidation_price/10**18:.2f} USD")
            logger.info(f"对应净值: {liquidation_nav/10**18:.4f}")
            
            return liquidation_price
        else:
            # 对于其他杠杆类型，使用线性搜索
            step = mint_price // 100  # 1%步长
            for price in range(0, mint_price, step):
                nav = self.calculate_nav_for_leverage(leverage_type, mint_price, price)
                if nav < liquidation_threshold_wei:
                    liquidation_price = price
                    liquidation_nav = nav
                    
                    logger.info(f"触发清算的价格: {liquidation_price/10**18:.2f} USD")
                    logger.info(f"对应净值: {liquidation_nav/10**18:.4f}")
                    
                    return liquidation_price
        
        # 如果没有找到，返回一个默认值
        default_price = int(0.5 * mint_price)
        logger.warning(f"未找到精确的清算价格，使用默认值: {default_price/10**18:.2f} USD")
        return default_price
    
    def test_liquidation_scenario(self):
        """测试清算场景"""
        logger.info("🧪 测试净值为正时的清算场景")
        
        # 获取当前价格
        current_price = self.get_current_price()
        logger.info(f"当前WLTC价格: {current_price/10**18:.2f} USD")
        
        # 获取用户持仓信息
        accounts = self.w3.eth.accounts
        for account in accounts:
            try:
                custodian_contract = self.contracts["custodian"]
                token_info = custodian_contract.functions.getAllLeverageTokenInfo(account).call()
                token_ids, balances, leverages, mint_prices, accrued_interests = token_info
                
                for i in range(len(token_ids)):
                    if balances[i] > 0:
                        logger.info(f"📊 分析用户 {account} 的持仓:")
                        logger.info(f"  - Token ID: {token_ids[i]}")
                        logger.info(f"  - 杠杆类型: {leverages[i]}")
                        logger.info(f"  - 铸币价格: {mint_prices[i]/10**18:.2f} USD")
                        logger.info(f"  - 当前WLTC价格: {current_price/10**18:.2f} USD")
                        
                        # 计算当前净值
                        current_nav = self.calculate_nav_for_leverage(
                            leverages[i], mint_prices[i], current_price
                        )
                        logger.info(f"  - 当前净值: {current_nav/10**18:.4f}")
                        
                        # 找到触发清算的价格
                        liquidation_price = self.find_liquidation_price(
                            leverages[i], mint_prices[i]
                        )
                        
                        # 将价格调整到刚好触发清算
                        liquidation_price_usd = liquidation_price / 10**18
                        logger.info(f"  - 将WLTC价格调整到: {liquidation_price_usd:.2f} USD 来触发清算")
                        
                        # 更新价格
                        success = self.update_price(liquidation_price_usd)
                        
                        if success:
                            # 验证新价格
                            new_price = self.get_current_price()
                            logger.info(f"  - 新WLTC价格: {new_price/10**18:.2f} USD")
                            
                            # 计算新净值
                            new_nav = self.calculate_nav_for_leverage(
                                leverages[i], mint_prices[i], new_price
                            )
                            logger.info(f"  - 新净值: {new_nav/10**18:.4f}")
                            
                            # 检查是否应该清算
                            liquidation_threshold = int(Decimal("0.3") * 10**18)
                            should_liquidate = new_nav < liquidation_threshold
                            logger.info(f"  - 应该清算: {should_liquidate}")
                            
                            if should_liquidate:
                                logger.info("  🚨 净值低于清算阈值，应该触发清算!")
                            else:
                                logger.info("  ✅ 净值高于清算阈值，不需要清算")
                                
                        return  # 只测试第一个有持仓的用户
                        
            except Exception as e:
                logger.error(f"检查用户 {account} 持仓失败: {e}")

if __name__ == "__main__":
    tester = PositiveNavLiquidationTester()
    tester.test_liquidation_scenario()
