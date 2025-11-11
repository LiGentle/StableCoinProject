#!/usr/bin/env python3
"""
清算场景测试脚本
创建用户铸币，然后模拟价格下跌，测试清算机器人能否正常发起清算
"""

import asyncio
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
        logging.FileHandler('test_liquidation_scenario.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class LiquidationScenarioTest:
    """清算场景测试"""
    
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
        
        # 加载LeverageToken合约
        with open(os.path.join(abi_dir, "MultiLeverageToken.json"), 'r') as f:
            leverage_artifact = json.load(f)
            leverage_abi = leverage_artifact["abi"]
        leverage_address = self.config["contracts"]["leverage_token"]
        contracts["leverage_token"] = self.w3.eth.contract(
            address=leverage_address,
            abi=leverage_abi
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
        
        # 注意：在测试环境中，我们假设用户已经有USDC
        # 在实际部署中，需要USDC Mock合约
        # 这里简化处理，跳过USDC相关操作
        contracts["usdc"] = None
        
        logger.info("所有合约实例加载完成")
        return contracts
    
    def get_accounts(self):
        """获取测试账户"""
        accounts = self.w3.eth.accounts
        logger.info(f"可用账户: {len(accounts)}")
        return accounts
    
    def setup_test_accounts(self):
        """设置测试账户"""
        accounts = self.get_accounts()
        
        # 使用账户1作为测试用户（账户0是keeper）
        if len(accounts) >= 2:
            test_user = accounts[1]
            logger.info(f"测试用户: {test_user}")
            return test_user
        else:
            logger.error("没有足够的测试账户")
            return None
    
    def mint_test_tokens(self, user_address: str):
        """为用户铸币"""
        try:
            # 获取用户私钥（在测试环境中）
            private_key = self.config["private_key"]
            
            # 首先给用户一些USDC
            usdc_contract = self.contracts["usdc"]
            keeper_address = self.config["keeper_address"]
            
            # 给用户转账USDC
            mint_amount = int(Decimal("10000") * 10**18)  # 10000 USDC
            
            mint_function = usdc_contract.functions.mint(
                user_address,
                mint_amount
            )
            
            # 估算gas
            gas_estimate = mint_function.estimate_gas({
                'from': keeper_address,
                'nonce': self.w3.eth.get_transaction_count(keeper_address)
            })
            
            # 构建交易
            transaction = mint_function.build_transaction({
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
                logger.info(f"成功给用户 {user_address} 铸币 {mint_amount/10**18:.0f} USDC")
                
                # 检查用户USDC余额
                balance = usdc_contract.functions.balanceOf(user_address).call()
                logger.info(f"用户USDC余额: {balance/10**18:.2f}")
                return True
            else:
                logger.error(f"铸币失败! 交易哈希: {tx_hash.hex()}")
                return False
                
        except Exception as e:
            logger.error(f"铸币失败: {e}")
            return False
    
    def approve_usdc_for_custodian(self, user_address: str, user_private_key: str):
        """用户授权Custodian合约使用USDC"""
        try:
            usdc_contract = self.contracts["usdc"]
            custodian_address = self.config["contracts"]["custodian"]
            
            # 授权金额
            approve_amount = int(Decimal("10000") * 10**18)  # 10000 USDC
            
            approve_function = usdc_contract.functions.approve(
                custodian_address,
                approve_amount
            )
            
            # 估算gas
            gas_estimate = approve_function.estimate_gas({
                'from': user_address,
                'nonce': self.w3.eth.get_transaction_count(user_address)
            })
            
            # 构建交易
            transaction = approve_function.build_transaction({
                'from': user_address,
                'gas': gas_estimate + 10000,
                'gasPrice': self.w3.eth.gas_price,
                'nonce': self.w3.eth.get_transaction_count(user_address),
            })
            
            # 签名并发送交易
            signed_txn = self.w3.eth.account.sign_transaction(transaction, user_private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_txn.rawTransaction)
            
            # 等待交易确认
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            if receipt.status == 1:
                logger.info(f"用户 {user_address} 成功授权Custodian使用USDC")
                return True
            else:
                logger.error(f"授权失败! 交易哈希: {tx_hash.hex()}")
                return False
                
        except Exception as e:
            logger.error(f"授权失败: {e}")
            return False
    
    def user_mint_leverage_token(self, user_address: str, user_private_key: str):
        """用户铸造杠杆代币"""
        try:
            custodian_contract = self.contracts["custodian"]
            
            # 铸造参数
            leverage_type = 0  # CONSERVATIVE (1:8)
            amount = int(Decimal("1000") * 10**18)  # 1000 USDC
            min_amount_out = 0  # 最小输出数量
            
            mint_function = custodian_contract.functions.mint(
                leverage_type,
                amount,
                min_amount_out
            )
            
            # 估算gas
            gas_estimate = mint_function.estimate_gas({
                'from': user_address,
                'nonce': self.w3.eth.get_transaction_count(user_address)
            })
            
            # 构建交易
            transaction = mint_function.build_transaction({
                'from': user_address,
                'gas': gas_estimate + 10000,
                'gasPrice': self.w3.eth.gas_price,
                'nonce': self.w3.eth.get_transaction_count(user_address),
            })
            
            # 签名并发送交易
            signed_txn = self.w3.eth.account.sign_transaction(transaction, user_private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_txn.rawTransaction)
            
            # 等待交易确认
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            if receipt.status == 1:
                logger.info(f"用户 {user_address} 成功铸造杠杆代币")
                
                # 获取用户持仓
                positions = self.get_user_positions(user_address)
                logger.info(f"用户持仓数量: {len(positions)}")
                
                return True
            else:
                logger.error(f"铸造失败! 交易哈希: {tx_hash.hex()}")
                return False
                
        except Exception as e:
            logger.error(f"铸造失败: {e}")
            return False
    
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
            logger.error(f"获取用户持仓失败: {e}")
            return []
    
    def simulate_price_drop(self, new_price: int):
        """模拟价格下跌"""
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
                logger.info(f"成功更新价格到: {new_price/10**18:.2f} USD")
                return True
            else:
                logger.error(f"价格更新失败! 交易哈希: {tx_hash.hex()}")
                return False
                
        except Exception as e:
            logger.error(f"价格更新失败: {e}")
            return False
    
    def check_liquidation_status(self, user_address: str):
        """检查用户清算状态"""
        try:
            liquidation_contract = self.contracts["liquidation_manager"]
            
            positions = self.get_user_positions(user_address)
            for position in positions:
                status = liquidation_contract.functions.userLiquidationStatus(
                    user_address, position['token_id']
                ).call()
                
                is_freezed = status[5]
                is_under_liquidation = status[4]
                
                logger.info(f"Token {position['token_id']} 状态: 冻结={is_freezed}, 清算中={is_under_liquidation}")
                
        except Exception as e:
            logger.error(f"检查清算状态失败: {e}")
    
    def run_test_scenario(self):
        """运行测试场景"""
        logger.info("开始清算场景测试...")
        
        # 1. 设置测试用户
        test_user = self.setup_test_accounts()
        if not test_user:
            logger.error("无法设置测试用户")
            return False
        
        # 2. 给用户铸币USDC
        logger.info("步骤1: 给用户铸币USDC")
        if not self.mint_test_tokens(test_user):
            logger.error("铸币失败")
            return False
        
        # 3. 用户授权Custodian使用USDC
        logger.info("步骤2: 用户授权Custodian使用USDC")
        # 注意：在测试环境中，我们需要用户的私钥
        # 这里简化处理，假设我们有用户私钥
        user_private_key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"  # Hardhat账户1私钥
        
        if not self.approve_usdc_for_custodian(test_user, user_private_key):
            logger.error("授权失败")
            return False
        
        # 4. 用户铸造杠杆代币
        logger.info("步骤3: 用户铸造杠杆代币")
        if not self.user_mint_leverage_token(test_user, user_private_key):
            logger.error("铸造杠杆代币失败")
            return False
        
        # 5. 获取当前价格
        current_price = self.contracts["price_oracle"].functions.latestRoundData().call()[1]
        logger.info(f"当前LTC价格: {current_price/10**18:.2f} USD")
        
        # 6. 模拟价格下跌到清算阈值以下
        logger.info("步骤4: 模拟价格下跌")
        # 计算清算阈值价格
        # 对于保守型杠杆(1:8)，清算阈值是0.3
        # 假设铸币价格是30，那么清算价格 = 30 * 0.3 * (8/9) ≈ 8 USD
        liquidation_price = int(Decimal("8") * 10**18)  # 8 USD
        
        if not self.simulate_price_drop(liquidation_price):
            logger.error("价格下跌模拟失败")
            return False
        
        # 7. 检查清算状态
        logger.info("步骤5: 检查清算状态")
        self.check_liquidation_status(test_user)
        
        logger.info("测试场景设置完成！现在可以启动清算机器人来测试清算功能")
        return True

if __name__ == "__main__":
    test = LiquidationScenarioTest()
    success = test.run_test_scenario()
    
    if success:
        logger.info("✅ 测试场景设置成功！")
        logger.info("现在可以运行: python run_bots.py 来测试清算机器人")
    else:
        logger.error("❌ 测试场景设置失败")
