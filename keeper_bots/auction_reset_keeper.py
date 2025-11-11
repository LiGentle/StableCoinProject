#!/usr/bin/env python3
"""
拍卖Reset Keeper机器人
监控活跃拍卖，发现需要重置的拍卖后调用resetAuction函数
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
        logging.FileHandler('auction_reset_keeper.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

@dataclass
class AuctionInfo:
    """拍卖信息"""
    auction_id: int
    underlying_amount: int
    original_owner: str
    token_id: int
    start_time: int
    starting_price: int
    current_price: int
    total_payment: int
    needs_reset: bool

class AuctionResetKeeper:
    """拍卖Reset Keeper机器人"""
    
    def __init__(self, config_path: str = "config.json"):
        self.config = self._load_config(config_path)
        self.w3 = self._setup_web3()
        self.contracts = self._load_contracts()
        
        # 从合约获取拍卖参数
        self.reset_time = self._get_reset_time()
        self.price_drop_threshold = self._get_price_drop_threshold()
        self.min_auction_amount = self._get_min_auction_amount()
        
        logger.info("拍卖Reset Keeper机器人初始化完成")
        logger.info(f"拍卖参数 - 重置时间: {self.reset_time}秒, 价格下降阈值: {self.price_drop_threshold/10**18:.4f}, 最小拍卖金额: {self.min_auction_amount/10**18:.2f}")
        
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
        
        # 加载AuctionManager合约
        with open(os.path.join(abi_dir, "AuctionManager.json"), 'r') as f:
            auction_artifact = json.load(f)
            auction_abi = auction_artifact["abi"]
        auction_address = self.config["contracts"]["auction_manager"]
        contracts["auction_manager"] = self.w3.eth.contract(
            address=auction_address,
            abi=auction_abi
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
        
        logger.info("所有合约实例加载完成")
        return contracts
    
    def _get_reset_time(self) -> int:
        """从合约获取重置时间"""
        try:
            auction_params = self.get_auction_params()
            reset_time = auction_params.get("reset_time", 7200)
            logger.info(f"从合约获取重置时间: {reset_time}秒")
            return reset_time
        except Exception as e:
            logger.error(f"获取重置时间失败，使用默认值: {e}")
            return 7200  # 默认值 2小时
    
    def _get_price_drop_threshold(self) -> int:
        """从合约获取价格下降阈值"""
        try:
            auction_params = self.get_auction_params()
            price_drop_threshold = auction_params.get("price_drop_threshold", int(Decimal("0.8") * 10**18))
            logger.info(f"从合约获取价格下降阈值: {price_drop_threshold/10**18:.4f}")
            return price_drop_threshold
        except Exception as e:
            logger.error(f"获取价格下降阈值失败，使用默认值: {e}")
            return int(Decimal("0.8") * 10**18)  # 默认值 0.8
    
    def _get_min_auction_amount(self) -> int:
        """从合约获取最小拍卖金额"""
        try:
            auction_params = self.get_auction_params()
            min_auction_amount = auction_params.get("min_auction_amount", int(Decimal("100") * 10**18))
            logger.info(f"从合约获取最小拍卖金额: {min_auction_amount/10**18:.2f}")
            return min_auction_amount
        except Exception as e:
            logger.error(f"获取最小拍卖金额失败，使用默认值: {e}")
            return int(Decimal("100") * 10**18)  # 默认值 100
    
    def get_auction_params(self) -> Dict:
        """从合约获取拍卖参数"""
        try:
            auction_manager = self.contracts["auction_manager"]
            
            # 获取拍卖参数
            params = auction_manager.functions.auctionParams().call()
            
            auction_params = {
                "price_multiplier": params[0],
                "reset_time": params[1],
                "min_auction_amount": params[2],
                "price_drop_threshold": params[3],
                "percentage_reward": params[4],
                "fixed_reward": params[5]
            }
            
            logger.info(f"拍卖参数: 重置时间={auction_params['reset_time']}秒, 价格下降阈值={auction_params['price_drop_threshold']/10**18:.2f}")
            return auction_params
            
        except Exception as e:
            logger.error(f"获取拍卖参数失败: {e}")
            return {}
    
    def get_active_auctions(self) -> List[int]:
        """获取所有活跃拍卖的ID"""
        active_auctions = []
        
        try:
            # 获取活跃拍卖数量
            active_count = self.contracts["auction_manager"].functions.getActiveAuctionCount().call()
            
            # 遍历所有可能的拍卖ID（简化版本，实际需要更智能的方法）
            # 这里假设拍卖ID是连续的，从1开始
            for auction_id in range(1, active_count + 100):  # 增加一些缓冲
                try:
                    is_active = self.contracts["auction_manager"].functions.auctionIsActive(auction_id).call()
                    if is_active:
                        active_auctions.append(auction_id)
                except:
                    # 如果拍卖不存在，跳过
                    continue
                    
            logger.info(f"找到 {len(active_auctions)} 个活跃拍卖")
            return active_auctions
            
        except Exception as e:
            logger.error(f"获取活跃拍卖失败: {e}")
            return []
    
    def get_auction_info(self, auction_id: int) -> Optional[AuctionInfo]:
        """获取拍卖详细信息"""
        try:
            auction_manager = self.contracts["auction_manager"]
            
            # 获取拍卖基础信息
            auction_data = auction_manager.functions.auctions(auction_id).call()
            
            # 获取拍卖状态
            status_data = auction_manager.functions.getAuctionStatus(auction_id).call()
            needs_reset, current_price, underlying_amount = status_data
            
            auction_info = AuctionInfo(
                auction_id=auction_id,
                underlying_amount=auction_data[1],  # underlyingAmount
                original_owner=auction_data[2],     # originalOwner
                token_id=auction_data[3],           # tokenId
                start_time=auction_data[4],         # startTime
                starting_price=auction_data[5],     # startingPrice
                current_price=current_price,
                total_payment=auction_data[7],      # totalPayment
                needs_reset=needs_reset
            )
            
            return auction_info
            
        except Exception as e:
            logger.error(f"获取拍卖 {auction_id} 信息失败: {e}")
            return None
    
    def calculate_current_price(self, auction_info: AuctionInfo) -> int:
        """计算当前价格（链下计算，用于验证）"""
        try:
            price_calculator = self.contracts["price_calculator"]
            
            # 计算拍卖持续时间
            duration = self.w3.eth.get_block('latest')['timestamp'] - auction_info.start_time
            
            # 使用价格计算器计算当前价格
            current_price = price_calculator.functions.price(
                auction_info.starting_price,
                duration
            ).call()
            
            return current_price
            
        except Exception as e:
            logger.error(f"计算当前价格失败: {e}")
            return 0
    
    def check_reset_eligibility(self, auction_info: AuctionInfo) -> bool:
        """检查拍卖是否需要重置"""
        try:
            # 检查合约返回的needs_reset标志
            if auction_info.needs_reset:
                logger.info(f"拍卖 {auction_info.auction_id} 需要重置 (合约标志)")
                return True
            
            # 链下验证重置条件
            current_time = self.w3.eth.get_block('latest')['timestamp']
            duration = current_time - auction_info.start_time
            
            # 检查时间条件
            if duration > self.reset_time:
                logger.info(f"拍卖 {auction_info.auction_id} 需要重置 (时间条件: {duration}秒 > {self.reset_time}秒)")
                return True
            
            # 检查价格下降条件
            if auction_info.starting_price > 0:
                price_ratio = (auction_info.current_price * 10**18) // auction_info.starting_price
                if price_ratio < self.price_drop_threshold:
                    logger.info(f"拍卖 {auction_info.auction_id} 需要重置 (价格条件: {price_ratio/10**18:.4f} < {self.price_drop_threshold/10**18:.4f})")
                    return True
            
            logger.debug(f"拍卖 {auction_info.auction_id} 不需要重置")
            return False
            
        except Exception as e:
            logger.error(f"检查重置资格失败: {e}")
            return False
    
    def execute_reset(self, auction_info: AuctionInfo) -> bool:
        """执行拍卖重置操作"""
        try:
            keeper_address = self.config["keeper_address"]
            private_key = self.config["private_key"]
            
            # 构建resetAuction交易
            reset_function = self.contracts["auction_manager"].functions.resetAuction(
                auction_info.auction_id,
                keeper_address
            )
            
            # 估算gas
            gas_estimate = reset_function.estimate_gas({
                'from': keeper_address,
                'nonce': self.w3.eth.get_transaction_count(keeper_address)
            })
            
            # 构建交易
            transaction = reset_function.build_transaction({
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
                logger.info(f"拍卖重置成功! 拍卖ID: {auction_info.auction_id}, 交易哈希: {tx_hash.hex()}")
                return True
            else:
                logger.error(f"拍卖重置失败! 交易哈希: {tx_hash.hex()}")
                return False
                
        except Exception as e:
            logger.error(f"执行拍卖重置失败: {e}")
            return False
    
    async def monitor_and_reset(self):
        """监控并执行拍卖重置的主循环"""
        logger.info("开始监控拍卖重置机会...")
        
        # 获取拍卖参数
        auction_params = self.get_auction_params()
        if auction_params:
            self.reset_time = auction_params.get("reset_time", self.reset_time)
            self.price_drop_threshold = auction_params.get("price_drop_threshold", self.price_drop_threshold)
        
        while True:
            try:
                # 获取所有活跃拍卖
                active_auctions = self.get_active_auctions()
                
                reset_opportunities = []
                
                # 检查每个拍卖是否需要重置
                for auction_id in active_auctions:
                    auction_info = self.get_auction_info(auction_id)
                    
                    if auction_info and self.check_reset_eligibility(auction_info):
                        reset_opportunities.append(auction_info)
                
                # 执行重置
                for opportunity in reset_opportunities:
                    logger.info(f"发现重置机会: 拍卖ID {opportunity.auction_id}")
                    
                    # 执行重置
                    success = self.execute_reset(opportunity)
                    
                    if success:
                        logger.info(f"成功重置拍卖 {opportunity.auction_id}")
                    else:
                        logger.error(f"重置拍卖 {opportunity.auction_id} 失败")
                    
                    # 短暂延迟，避免过于频繁的交易
                    await asyncio.sleep(5)
                
                logger.info(f"本轮检查完成，发现 {len(reset_opportunities)} 个重置机会")
                
                # 等待下一轮检查
                await asyncio.sleep(self.config.get("check_interval", 60))  # 默认60秒检查一次
                
            except Exception as e:
                logger.error(f"监控循环出错: {e}")
                await asyncio.sleep(60)  # 出错后等待1分钟再重试
    
    def run(self):
        """运行keeper机器人"""
        try:
            asyncio.run(self.monitor_and_reset())
        except KeyboardInterrupt:
            logger.info("拍卖Reset Keeper机器人已停止")
        except Exception as e:
            logger.error(f"机器人运行出错: {e}")

if __name__ == "__main__":
    # 示例配置文件
    sample_config = {
        "rpc_url": "http://localhost:8545",
        "is_poa": False,
        "keeper_address": "0xYourKeeperAddress",
        "private_key": "YourPrivateKey",
        "check_interval": 60,
        "contracts": {
            "auction_manager": "0xAuctionManagerAddress",
            "price_calculator": "0xPriceCalculatorAddress"
        },
        "abi_dir": "abis"
    }
    
    # 如果配置文件不存在，创建示例配置
    if not os.path.exists("config.json"):
        with open("config.json", 'w') as f:
            json.dump(sample_config, f, indent=2)
        logger.info("已创建示例配置文件 config.json，请修改配置后重新运行")
    else:
        keeper = AuctionResetKeeper()
        keeper.run()
