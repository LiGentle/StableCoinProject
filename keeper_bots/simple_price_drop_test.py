#!/usr/bin/env python3
"""
简单价格下跌测试脚本
直接模拟WLTC价格下跌，测试清算机器人能否正常发起清算
"""

import logging
import time
from web3 import Web3
import json
import os
from decimal import Decimal

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('simple_price_drop_test.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class SimplePriceDropTest:
    """简单价格下跌测试"""
    
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
    
    def simulate_price_drop(self, new_price: int):
        """模拟WLTC价格下跌"""
        try:
            oracle_contract = self.contracts["price_oracle"]
            keeper_address = self.config["keeper_address"]
            private_key = self.config["private_key"]
            
            # 更新价格
            update_function = oracle_contract.functions.updatePrice(new_price)
            
            # 估算gas
            gas_estimate = update_function.estimate_gas({
                'from': keeper_address,
                'nonce': self.w3.eth.get_transaction_count(keeper_address)
            })
            
            # 构建交易
            transaction = update_function.build_transaction({
                'from': keeper_address,
                'gas': gas_estimate + 10000,
                'gasPrice': self.w3.eth.gas_price,
                'nonce': self.w3.eth.get_transaction_count(keeper_address),
            })
            
            # 签名并发送交易
            signed_txn = self.w3.eth.account.sign_transaction(transaction, private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_txn.rawTransaction)
            
            # 等待交易确认
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            if receipt.status == 1:
                logger.info(f"✅ 成功更新WLTC价格到: {new_price/10**18:.2f} USD")
                return True
            else:
                logger.error(f"❌ 价格更新失败! 交易哈希: {tx_hash.hex()}")
                return False
                
        except Exception as e:
            logger.error(f"❌ 价格更新失败: {e}")
            return False
    
    def run_test(self):
        """运行测试"""
        logger.info("🚀 开始WLTC价格下跌测试...")
        
        # 1. 获取当前价格
        current_price = self.get_current_price()
        if current_price == 0:
            logger.error("无法获取当前价格")
            return False
        
        logger.info(f"当前WLTC价格: {current_price/10**18:.2f} USD")
        
        # 2. 模拟价格下跌到清算阈值以下
        # 假设当前有用户持有保守型杠杆代币(1:8)
        # 清算阈值是0.3，铸币价格假设是30 USD
        # 清算价格 = 30 * 0.3 * (8/9) ≈ 8 USD
        liquidation_price = int(Decimal("8") * 10**18)  # 8 USD
        
        logger.info(f"模拟WLTC价格下跌到: {liquidation_price/10**18:.2f} USD")
        logger.info("这个价格应该会导致持有保守型杠杆代币的用户净值跌破清算阈值")
        
        if not self.simulate_price_drop(liquidation_price):
            logger.error("价格下跌模拟失败")
            return False
        
        # 3. 验证价格更新
        new_price = self.get_current_price()
        if new_price == liquidation_price:
            logger.info("✅ 价格更新验证成功")
        else:
            logger.error(f"❌ 价格更新验证失败: 期望 {liquidation_price/10**18:.2f}, 实际 {new_price/10**18:.2f}")
            return False
        
        logger.info("🎯 WLTC价格下跌测试完成！")
        logger.info("现在可以启动清算机器人来测试清算功能")
        logger.info("运行命令: python run_bots.py")
        
        return True

if __name__ == "__main__":
    test = SimplePriceDropTest()
    success = test.run_test()
    
    if success:
        logger.info("✅ 测试场景设置成功！")
        logger.info("现在可以运行: python run_bots.py 来测试清算机器人")
    else:
        logger.error("❌ 测试场景设置失败")
