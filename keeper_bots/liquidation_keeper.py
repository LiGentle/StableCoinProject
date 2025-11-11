#!/usr/bin/env python3
"""
清算Keeper机器人
监控用户持仓，链下计算净值，发现净值低于清算阈值的用户后调用bark函数
"""

import asyncio
import logging
import time
from typing import Dict, List, Tuple, Optional
from web3 import Web3
from web3.contract import Contract
# from web3.middleware import geth_poa_middleware  # 在较新版本中可能不可用
import json
import os
from dataclasses import dataclass
from decimal import Decimal

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('liquidation_keeper.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

@dataclass
class UserPosition:
    """用户持仓信息"""
    user: str
    token_id: int
    balance: int
    leverage_type: int  # 0=CONSERVATIVE, 1=MODERATE, 2=AGGRESSIVE
    mint_price: int
    accrued_interest: int

@dataclass
class TokenInfo:
    """Token信息"""
    leverage_type: int
    mint_price: int
    creation_time: int
    token_name: str
    is_static: bool

class LiquidationKeeper:
    """清算Keeper机器人"""
    
    def __init__(self, config_path: str = "config.json"):
        self.config = self._load_config(config_path)
        self.w3 = self._setup_web3()
        self.contracts = self._load_contracts()
        self.last_processed_block = self.w3.eth.block_number
        
        # 从合约获取清算参数
        self.liquidation_threshold = self._get_liquidation_threshold()
        self.adjustment_threshold = self._get_adjustment_threshold()
        self.penalty_rate = self._get_penalty_rate()
        
        logger.info("清算Keeper机器人初始化完成")
        logger.info(f"清算参数 - 清算阈值: {self.liquidation_threshold/10**18:.4f}, 调整阈值: {self.adjustment_threshold/10**18:.4f}, 惩罚率: {self.penalty_rate/10**18:.4f}")
        
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
            
        # 如果是POA网络，添加中间件
        if self.config.get("is_poa", False):
            try:
                from web3.middleware import geth_poa_middleware
                w3.middleware_onion.inject(geth_poa_middleware, layer=0)
            except ImportError:
                logger.warning("geth_poa_middleware不可用，跳过POA中间件注入")
            
        logger.info(f"Web3连接成功，网络ID: {w3.eth.chain_id}")
        return w3
    
    def _load_contracts(self) -> Dict[str, Contract]:
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
        
        logger.info("所有合约实例加载完成")
        return contracts
    
    def _get_liquidation_threshold(self) -> int:
        """从合约获取清算阈值"""
        try:
            global_config = self.contracts["liquidation_manager"].functions.globalConfig().call()
            liquidation_threshold = global_config[1]  # liquidationThreshold字段
            logger.info(f"从合约获取清算阈值: {liquidation_threshold/10**18:.4f}")
            return liquidation_threshold
        except Exception as e:
            logger.error(f"获取清算阈值失败，使用默认值: {e}")
            return int(Decimal("0.3") * 10**18)  # 默认值 0.3
    
    def _get_adjustment_threshold(self) -> int:
        """从合约获取调整阈值"""
        try:
            global_config = self.contracts["liquidation_manager"].functions.globalConfig().call()
            adjustment_threshold = global_config[0]  # adjustmentThreshold字段
            logger.info(f"从合约获取调整阈值: {adjustment_threshold/10**18:.4f}")
            return adjustment_threshold
        except Exception as e:
            logger.error(f"获取调整阈值失败，使用默认值: {e}")
            return int(Decimal("0.5") * 10**18)  # 默认值 0.5
    
    def _get_penalty_rate(self) -> int:
        """从合约获取惩罚率"""
        try:
            global_config = self.contracts["liquidation_manager"].functions.globalConfig().call()
            penalty_rate = global_config[2]  # penalty字段
            logger.info(f"从合约获取惩罚率: {penalty_rate/10**18:.4f}")
            return penalty_rate
        except Exception as e:
            logger.error(f"获取惩罚率失败，使用默认值: {e}")
            return int(Decimal("0.03") * 10**18)  # 默认值 0.03
    
    def get_current_price(self) -> int:
        """获取当前LTC价格"""
        try:
            # 从预言机获取最新价格
            price_data = self.contracts["price_oracle"].functions.latestRoundData().call()
            current_price = price_data[1]  # answer字段
            logger.info(f"当前LTC价格: {current_price / 10**18:.2f} USD")
            return current_price
        except Exception as e:
            logger.error(f"获取价格失败: {e}")
            return 0
    
    def get_all_users_with_positions(self) -> List[str]:
        """获取所有有持仓的用户地址（简化版本，用于测试）"""
        # 由于Hardhat本地节点不支持eth_getLogs，我们使用简化方法
        # 在实际生产环境中，应该使用事件日志或其他方法
        users = []
        
        try:
            # 简化方法：使用已知的测试用户地址
            # 在实际部署中，应该从合约状态或事件中获取
            test_users = [
                "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",  # 默认Hardhat账户0
                "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",  # 默认Hardhat账户1
                "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"   # 默认Hardhat账户2
            ]
            
            # 检查哪些用户有持仓
            for user in test_users:
                try:
                    positions = self.get_user_positions(user)
                    if positions:
                        users.append(user)
                except:
                    continue
                    
            logger.info(f"找到 {len(users)} 个有持仓的用户")
        except Exception as e:
            logger.error(f"获取用户列表失败: {e}")
            
        return users
    
    def get_user_positions(self, user_address: str) -> List[UserPosition]:
        """获取用户的所有持仓"""
        positions = []
        
        try:
            # 获取用户所有token信息
            token_info = self.contracts["custodian"].functions.getAllLeverageTokenInfo(
                user_address
            ).call()
            
            token_ids, balances, leverages, mint_prices, accrued_interests = token_info
            
            for i in range(len(token_ids)):
                if balances[i] > 0:  # 只处理有余额的持仓
                    position = UserPosition(
                        user=user_address,
                        token_id=token_ids[i],
                        balance=balances[i],
                        leverage_type=leverages[i],
                        mint_price=mint_prices[i],
                        accrued_interest=accrued_interests[i]
                    )
                    positions.append(position)
                    
            logger.debug(f"用户 {user_address} 有 {len(positions)} 个持仓")
        except Exception as e:
            logger.error(f"获取用户 {user_address} 持仓失败: {e}")
            
        return positions
    
    def calculate_net_value(self, position: UserPosition, current_price: int) -> int:
        """计算除息净值（链下计算）"""
        try:
            # 根据杠杆类型计算总净值
            leverage = position.leverage_type
            mint_price = position.mint_price
            balance = position.balance
            
            if leverage == 0:  # CONSERVATIVE (1:8)
                # NAV = (9*Pt - P0) / (8*P0)
                numerator = 9 * current_price - mint_price
                denominator = 8 * mint_price
                gross_nav = (numerator * 10**18) // denominator
                
            elif leverage == 1:  # MODERATE (1:4)
                # NAV = (5*Pt - P0) / (4*P0)
                numerator = 5 * current_price - mint_price
                denominator = 4 * mint_price
                gross_nav = (numerator * 10**18) // denominator
                
            elif leverage == 2:  # AGGRESSIVE (1:1)
                # NAV = (2*Pt - P0) / (1*P0)
                numerator = 2 * current_price - mint_price
                denominator = mint_price
                gross_nav = (numerator * 10**18) // denominator
                
            else:
                logger.error(f"未知杠杆类型: {leverage}")
                return 0
            
            # 计算总价值
            total_value = (balance * gross_nav) // 10**18
            
            # 计算除息净值 = (总价值 - 累计利息) / 余额
            if total_value >= position.accrued_interest:
                net_nav = ((total_value - position.accrued_interest) * 10**18) // balance
            else:
                net_nav = 0
                
            return net_nav
            
        except Exception as e:
            logger.error(f"计算净值失败: {e}")
            return 0
    
    def check_liquidation_eligibility(self, position: UserPosition, current_price: int) -> bool:
        """检查是否满足清算条件"""
        try:
            # 获取用户清算状态
            status = self.contracts["liquidation_manager"].functions.userLiquidationStatus(
                position.user, position.token_id
            ).call()
            
            is_freezed = status[5]  # isFreezed字段
            is_under_liquidation = status[4]  # isUnderLiquidation字段
            
            if is_freezed or is_under_liquidation:
                logger.debug(f"用户 {position.user} 的token {position.token_id} 已被冻结或正在清算中")
                return False
            
            # 链下计算净值
            net_nav = self.calculate_net_value(position, current_price)
            
            if net_nav == 0:
                logger.info(f"用户 {position.user} 的token {position.token_id} 净值为0，低于清算阈值 {self.liquidation_threshold/10**18:.4f}")
                return True
            
            # 检查净值是否低于清算阈值
            if net_nav < self.liquidation_threshold:
                logger.info(f"用户 {position.user} 的token {position.token_id} 净值 {net_nav/10**18:.4f} 低于清算阈值 {self.liquidation_threshold/10**18:.4f}")
                return True
            else:
                logger.debug(f"用户 {position.user} 的token {position.token_id} 净值 {net_nav/10**18:.4f} 高于清算阈值")
                return False
                
        except Exception as e:
            logger.error(f"检查清算资格失败: {e}")
            return False
    
    def execute_liquidation(self, position: UserPosition) -> bool:
        """执行清算操作"""
        try:
            keeper_address = self.config["keeper_address"]
            private_key = self.config["private_key"]
            
            # 构建bark交易
            bark_function = self.contracts["liquidation_manager"].functions.bark(
                position.user,
                position.token_id,
                keeper_address
            )
            
            # 估算gas
            gas_estimate = bark_function.estimate_gas({
                'from': keeper_address,
                'nonce': self.w3.eth.get_transaction_count(keeper_address)
            })
            
            # 构建交易
            transaction = bark_function.build_transaction({
                'from': keeper_address,
                'gas': gas_estimate + 10000,  # 增加一些缓冲
                'gasPrice': self.w3.eth.gas_price,
                'nonce': self.w3.eth.get_transaction_count(keeper_address),
            })
            
            # 签名并发送交易
            signed_txn = self.w3.eth.account.sign_transaction(transaction, private_key)
            tx_hash = self.w3.eth.send_raw_transaction(signed_txn.rawTransaction)
            
            # 等待交易确认
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
            
            if receipt.status == 1:
                logger.info(f"清算成功! 用户: {position.user}, Token: {position.token_id}, 交易哈希: {tx_hash.hex()}")
                return True
            else:
                logger.error(f"清算失败! 交易哈希: {tx_hash.hex()}")
                return False
                
        except Exception as e:
            logger.error(f"执行清算失败: {e}")
            return False
    
    async def monitor_and_liquidate(self):
        """监控并执行清算的主循环"""
        logger.info("开始监控清算机会...")
        
        while True:
            try:
                # 获取当前价格
                current_price = self.get_current_price()
                if current_price == 0:
                    logger.warning("无法获取有效价格，跳过本轮检查")
                    await asyncio.sleep(60)
                    continue
                
                # 获取所有有持仓的用户
                users = self.get_all_users_with_positions()
                
                liquidation_opportunities = []
                
                # 检查每个用户的持仓
                for user in users:
                    positions = self.get_user_positions(user)
                    
                    for position in positions:
                        if self.check_liquidation_eligibility(position, current_price):
                            liquidation_opportunities.append(position)
                
                # 执行清算
                for opportunity in liquidation_opportunities:
                    logger.info(f"发现清算机会: 用户 {opportunity.user}, Token {opportunity.token_id}")
                    
                    # 执行清算
                    success = self.execute_liquidation(opportunity)
                    
                    if success:
                        logger.info(f"成功清算用户 {opportunity.user}")
                    else:
                        logger.error(f"清算用户 {opportunity.user} 失败")
                    
                    # 短暂延迟，避免过于频繁的交易
                    await asyncio.sleep(5)
                
                # 更新最后处理的区块
                self.last_processed_block = self.w3.eth.block_number
                
                logger.info(f"本轮检查完成，发现 {len(liquidation_opportunities)} 个清算机会")
                
                # 等待下一轮检查
                await asyncio.sleep(self.config.get("check_interval", 30))
                
            except Exception as e:
                logger.error(f"监控循环出错: {e}")
                await asyncio.sleep(60)  # 出错后等待1分钟再重试
    
    def run(self):
        """运行keeper机器人"""
        try:
            asyncio.run(self.monitor_and_liquidate())
        except KeyboardInterrupt:
            logger.info("清算Keeper机器人已停止")
        except Exception as e:
            logger.error(f"机器人运行出错: {e}")

if __name__ == "__main__":
    # 示例配置文件
    sample_config = {
        "rpc_url": "http://localhost:8545",
        "is_poa": False,
        "keeper_address": "0xYourKeeperAddress",
        "private_key": "YourPrivateKey",
        "check_interval": 30,
        "contracts": {
            "custodian": "0xCustodianAddress",
            "liquidation_manager": "0xLiquidationManagerAddress", 
            "leverage_token": "0xLeverageTokenAddress",
            "price_oracle": "0xPriceOracleAddress"
        },
        "abi_dir": "abis"
    }
    
    # 如果配置文件不存在，创建示例配置
    if not os.path.exists("config.json"):
        with open("config.json", 'w') as f:
            json.dump(sample_config, f, indent=2)
        logger.info("已创建示例配置文件 config.json，请修改配置后重新运行")
    else:
        keeper = LiquidationKeeper()
        keeper.run()
