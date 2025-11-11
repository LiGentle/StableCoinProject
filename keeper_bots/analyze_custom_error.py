#!/usr/bin/env python3
"""
分析自定义错误并检查余额和allowance
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

class ErrorAnalyzer:
    """错误分析器"""
    
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
        
        # 加载LiquidationManager合约
        with open(os.path.join(abi_dir, "LiquidationManager.json"), 'r') as f:
            liquidation_artifact = json.load(f)
            liquidation_abi = liquidation_artifact["abi"]
        liquidation_address = self.config["contracts"]["liquidation_manager"]
        contracts["liquidation_manager"] = self.w3.eth.contract(
            address=liquidation_address,
            abi=liquidation_abi
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
        
        # 加载MultiLeverageToken合约
        with open(os.path.join(abi_dir, "MultiLeverageToken.json"), 'r') as f:
            leverage_artifact = json.load(f)
            leverage_abi = leverage_artifact["abi"]
        leverage_address = self.config["contracts"]["leverage_token"]
        contracts["leverage_token"] = self.w3.eth.contract(
            address=leverage_address,
            abi=leverage_abi
        )
        
        logger.info("合约实例加载完成")
        return contracts
    
    def analyze_custom_error(self, error_data: str):
        """分析自定义错误数据"""
        logger.info(f"分析自定义错误数据: {error_data}")
        
        # 错误数据格式: 0xcf479181... (函数选择器 + 参数)
        if error_data.startswith('0x'):
            error_data = error_data[2:]
        
        # 提取函数选择器 (前8个字符)
        function_selector = error_data[:8]
        logger.info(f"函数选择器: 0x{function_selector}")
        
        # 提取参数数据
        params_data = error_data[8:]
        logger.info(f"参数数据: 0x{params_data}")
        
        # 分析可能的错误类型
        if function_selector == 'cf479181':
            logger.info("这可能是一个自定义错误，需要检查合约代码")
        
        return function_selector, params_data
    
    def check_keeper_balance(self):
        """检查keeper账户余额"""
        keeper_address = self.config["keeper_address"]
        
        # 检查ETH余额
        eth_balance = self.w3.eth.get_balance(keeper_address)
        logger.info(f"Keeper账户 {keeper_address} ETH余额: {self.w3.from_wei(eth_balance, 'ether')} ETH")
        
        # 检查gas价格
        gas_price = self.w3.eth.gas_price
        logger.info(f"当前gas价格: {self.w3.from_wei(gas_price, 'gwei')} Gwei")
        
        # 估算清算交易需要的gas
        try:
            # 获取用户持仓信息
            accounts = self.w3.eth.accounts
            for account in accounts:
                try:
                    token_info = self.contracts["custodian"].functions.getAllLeverageTokenInfo(account).call()
                    token_ids, balances, leverages, mint_prices, accrued_interests = token_info
                    
                    for i in range(len(token_ids)):
                        if balances[i] > 0:
                            # 估算bark函数gas
                            gas_estimate = self.contracts["liquidation_manager"].functions.bark(
                                account,
                                token_ids[i],
                                keeper_address
                            ).estimate_gas({
                                'from': keeper_address,
                                'nonce': self.w3.eth.get_transaction_count(keeper_address)
                            })
                            
                            logger.info(f"清算交易预估gas: {gas_estimate}")
                            
                            # 计算需要的ETH
                            required_eth = gas_estimate * gas_price
                            logger.info(f"清算交易需要ETH: {self.w3.from_wei(required_eth, 'ether')} ETH")
                            
                            if eth_balance < required_eth:
                                logger.error(f"❌ ETH余额不足! 需要: {self.w3.from_wei(required_eth, 'ether')} ETH, 当前: {self.w3.from_wei(eth_balance, 'ether')} ETH")
                            else:
                                logger.info(f"✅ ETH余额充足")
                            
                            return
                except Exception as e:
                    continue
        except Exception as e:
            logger.error(f"估算gas失败: {e}")
    
    def check_allowance(self):
        """检查allowance"""
        keeper_address = self.config["keeper_address"]
        
        # 检查LiquidationManager是否有权限操作keeper的资产
        logger.info("检查LiquidationManager合约权限...")
        
        # 检查keeper是否在LiquidationManager的允许列表中
        try:
            # 检查keeper是否有AUCTION_ROLE权限
            auction_role = self.contracts["liquidation_manager"].functions.AUCTION_ROLE().call()
            has_auction_role = self.contracts["liquidation_manager"].functions.hasRole(auction_role, keeper_address).call()
            logger.info(f"Keeper是否有AUCTION_ROLE权限: {has_auction_role}")
            
            if not has_auction_role:
                logger.error("❌ Keeper没有AUCTION_ROLE权限!")
        except Exception as e:
            logger.error(f"检查权限失败: {e}")
    
    def check_user_position_status(self):
        """检查用户持仓状态"""
        accounts = self.w3.eth.accounts
        for account in accounts:
            try:
                token_info = self.contracts["custodian"].functions.getAllLeverageTokenInfo(account).call()
                token_ids, balances, leverages, mint_prices, accrued_interests = token_info
                
                for i in range(len(token_ids)):
                    if balances[i] > 0:
                        logger.info(f"检查用户 {account} 的持仓:")
                        logger.info(f"  - Token ID: {token_ids[i]}")
                        logger.info(f"  - 余额: {balances[i] / 10**18:.4f}")
                        
                        # 检查清算状态
                        try:
                            status = self.contracts["liquidation_manager"].functions.userLiquidationStatus(
                                account, token_ids[i]
                            ).call()
                            
                            is_freezed = status[5]
                            is_under_liquidation = status[4]
                            
                            logger.info(f"  - 是否冻结: {is_freezed}")
                            logger.info(f"  - 是否正在清算: {is_under_liquidation}")
                            
                            if is_freezed:
                                logger.error("❌ Token已被冻结，无法清算!")
                            if is_under_liquidation:
                                logger.error("❌ Token正在清算中，无法重复清算!")
                                
                        except Exception as e:
                            logger.error(f"检查清算状态失败: {e}")
                        
                        return
            except Exception as e:
                continue

if __name__ == "__main__":
    analyzer = ErrorAnalyzer()
    
    # 分析自定义错误
    error_data = "0xcf47918100000000000000000000000000000000000000000000d3c5f52178c65e922e0000000000000000000000000000000000000000000001177efd995e57a8992eff"
    analyzer.analyze_custom_error(error_data)
    
    # 检查余额和allowance
    analyzer.check_keeper_balance()
    analyzer.check_allowance()
    
    # 检查用户持仓状态
    analyzer.check_user_position_status()
