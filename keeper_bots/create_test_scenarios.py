#!/usr/bin/env python3
"""
测试场景生成器
在本地环境中创建测试数据，用于测试keeper机器人
"""

import json
import os
import time
from web3 import Web3
from web3.middleware import geth_poa_middleware

class TestScenarioCreator:
    """测试场景生成器"""
    
    def __init__(self, config_path: str = "config.json"):
        self.config = self._load_config(config_path)
        self.w3 = self._setup_web3()
        self.contracts = self._load_contracts()
        
    def _load_config(self, config_path: str) -> dict:
        """加载配置文件"""
        with open(config_path, 'r') as f:
            return json.load(f)
    
    def _setup_web3(self) -> Web3:
        """设置Web3连接"""
        w3 = Web3(Web3.HTTPProvider(self.config["rpc_url"]))
        
        if not w3.is_connected():
            raise ConnectionError("无法连接到以太坊节点")
            
        if self.config.get("is_poa", False):
            w3.middleware_onion.inject(geth_poa_middleware, layer=0)
            
        return w3
    
    def _load_contracts(self) -> dict:
        """加载合约实例"""
        contracts = {}
        abi_dir = self.config.get("abi_dir", "abis")
        
        # 加载所有需要的合约
        contract_files = {
            "custodian": "CustodianFixed.json",
            "liquidation_manager": "LiquidationManager.json",
            "leverage_token": "MultiLeverageToken.json",
            "price_oracle": "LTCPriceOracle.json",
            "auction_manager": "AuctionManager.json",
            "usdc": "USDCMock.json"
        }
        
        for name, file in contract_files.items():
            abi_path = os.path.join(abi_dir, file)
            if os.path.exists(abi_path):
                with open(abi_path, 'r') as f:
                    abi = json.load(f)
                address = self.config["contracts"].get(name)
                if address:
                    contracts[name] = self.w3.eth.contract(address=address, abi=abi)
        
        return contracts
    
    def get_accounts(self):
        """获取测试账户"""
        # Hardhat默认账户
        accounts = [
            "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",  # 账户0 - deployer
            "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",  # 账户1
            "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",  # 账户2
            "0x90F79bf6EB2c4f870365E785982E1f101E93b906",  # 账户3
        ]
        return accounts
    
    def create_liquidation_scenario(self):
        """创建清算测试场景"""
        print("创建清算测试场景...")
        
        try:
            accounts = self.get_accounts()
            deployer = accounts[0]
            test_user = accounts[1]
            
            # 1. 给测试用户一些USDC
            print("1. 给测试用户分配USDC...")
            usdc_contract = self.contracts.get("usdc")
            if usdc_contract:
                # 给测试用户mint一些USDC
                mint_amount = 10000 * 10**6  # 10,000 USDC
                tx = usdc_contract.functions.mint(test_user, mint_amount).build_transaction({
                    'from': deployer,
                    'gas': 100000,
                    'gasPrice': self.w3.eth.gas_price,
                    'nonce': self.w3.eth.get_transaction_count(deployer),
                })
                
                signed_tx = self.w3.eth.account.sign_transaction(tx, self.config["private_key"])
                tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
                receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
                print(f"   ✅ 分配USDC成功: {tx_hash.hex()}")
            
            # 2. 创建杠杆代币持仓
            print("2. 创建杠杆代币持仓...")
            custodian = self.contracts["custodian"]
            
            # 测试用户授权USDC给custodian
            if usdc_contract:
                approve_amount = 5000 * 10**6  # 5,000 USDC
                tx = usdc_contract.functions.approve(custodian.address, approve_amount).build_transaction({
                    'from': test_user,
                    'gas': 100000,
                    'gasPrice': self.w3.eth.gas_price,
                    'nonce': self.w3.eth.get_transaction_count(test_user),
                })
                
                signed_tx = self.w3.eth.account.sign_transaction(tx, self.config["private_key"])
                tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
                receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
                print(f"   ✅ USDC授权成功: {tx_hash.hex()}")
            
            # 创建保守型杠杆代币
            leverage_type = 0  # CONSERVATIVE
            amount = 1000 * 10**6  # 1,000 USDC
            
            tx = custodian.functions.mint(leverage_type, amount).build_transaction({
                'from': test_user,
                'gas': 300000,
                'gasPrice': self.w3.eth.gas_price,
                'nonce': self.w3.eth.get_transaction_count(test_user),
            })
            
            signed_tx = self.w3.eth.account.sign_transaction(tx, self.config["private_key"])
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
            print(f"   ✅ 创建杠杆代币成功: {tx_hash.hex()}")
            
            # 3. 获取创建的token ID
            print("3. 获取用户持仓信息...")
            token_info = custodian.functions.getAllLeverageTokenInfo(test_user).call()
            token_ids, balances, leverages, mint_prices, accrued_interests = token_info
            
            if token_ids:
                token_id = token_ids[0]
                print(f"   ✅ 创建的token ID: {token_id}")
                
                # 4. 模拟价格下跌触发清算
                print("4. 模拟价格下跌...")
                price_oracle = self.contracts["price_oracle"]
                
                # 获取当前价格
                current_price_data = price_oracle.functions.latestRoundData().call()
                current_price = current_price_data[1]
                
                # 设置一个较低的价格（触发清算）
                low_price = int(current_price * 0.5)  # 价格下跌50%
                
                tx = price_oracle.functions.setPrice(low_price).build_transaction({
                    'from': deployer,
                    'gas': 100000,
                    'gasPrice': self.w3.eth.gas_price,
                    'nonce': self.w3.eth.get_transaction_count(deployer),
                })
                
                signed_tx = self.w3.eth.account.sign_transaction(tx, self.config["private_key"])
                tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
                receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
                print(f"   ✅ 设置低价成功: {tx_hash.hex()}")
                print(f"   📉 当前价格: {low_price/10**18:.2f} USD")
                
                return {
                    "user": test_user,
                    "token_id": token_id,
                    "current_price": low_price,
                    "scenario": "liquidation"
                }
            else:
                print("❌ 未找到创建的token")
                return None
                
        except Exception as e:
            print(f"❌ 创建清算场景失败: {e}")
            return None
    
    def create_auction_scenario(self):
        """创建拍卖测试场景"""
        print("创建拍卖测试场景...")
        
        try:
            # 先创建清算场景
            liquidation_data = self.create_liquidation_scenario()
            if not liquidation_data:
                return None
            
            # 手动触发清算创建拍卖
            print("5. 手动触发清算...")
            liquidation_manager = self.contracts["liquidation_manager"]
            
            tx = liquidation_manager.functions.bark(
                liquidation_data["user"],
                liquidation_data["token_id"],
                self.config["keeper_address"]
            ).build_transaction({
                'from': self.config["keeper_address"],
                'gas': 500000,
                'gasPrice': self.w3.eth.gas_price,
                'nonce': self.w3.eth.get_transaction_count(self.config["keeper_address"]),
            })
            
            signed_tx = self.w3.eth.account.sign_transaction(tx, self.config["private_key"])
            tx_hash = self.w3.eth.send_raw_transaction(signed_tx.rawTransaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash)
            print(f"   ✅ 触发清算成功: {tx_hash.hex()}")
            
            # 获取创建的拍卖
            print("6. 获取拍卖信息...")
            auction_manager = self.contracts["auction_manager"]
            
            # 查找活跃拍卖
            active_count = auction_manager.functions.getActiveAuctionCount().call()
            print(f"   活跃拍卖数量: {active_count}")
            
            if active_count > 0:
                # 获取第一个拍卖
                auction_info = auction_manager.functions.auctions(1).call()
                print(f"   ✅ 拍卖创建成功 - ID: 1")
                
                return {
                    "auction_id": 1,
                    "scenario": "auction_reset"
                }
            else:
                print("❌ 未找到活跃拍卖")
                return None
                
        except Exception as e:
            print(f"❌ 创建拍卖场景失败: {e}")
            return None
    
    def fast_forward_time(self, seconds: int):
        """快速推进时间（用于测试时间相关的条件）"""
        print(f"快速推进时间 {seconds} 秒...")
        
        try:
            # 使用hardhat的evm_increaseTime
            payload = {
                "jsonrpc": "2.0",
                "method": "evm_increaseTime",
                "params": [seconds],
                "id": 1
            }
            
            import requests
            response = requests.post(self.config["rpc_url"], json=payload)
            result = response.json()
            
            if "result" in result:
                print(f"✅ 时间推进成功")
                
                # 挖一个区块确认时间变化
                payload = {
                    "jsonrpc": "2.0", 
                    "method": "evm_mine",
                    "params": [],
                    "id": 1
                }
                requests.post(self.config["rpc_url"], json=payload)
                
                return True
            else:
                print("❌ 时间推进失败")
                return False
                
        except Exception as e:
            print(f"❌ 时间推进失败: {e}")
            return False
    
    def run_liquidation_test(self):
        """运行完整的清算测试"""
        print("="*50)
        print("运行清算测试场景")
        print("="*50)
        
        result = self.create_liquidation_scenario()
        if result:
            print(f"\n🎯 清算测试场景创建成功!")
            print(f"   测试用户: {result['user']}")
            print(f"   Token ID: {result['token_id']}")
            print(f"   当前价格: {result['current_price']/10**18:.2f} USD")
            print(f"\n💡 现在可以运行清算机器人进行测试:")
            print(f"   python liquidation_keeper.py")
            return True
        else:
            print("❌ 清算测试场景创建失败")
            return False
    
    def run_auction_test(self):
        """运行完整的拍卖测试"""
        print("="*50)
        print("运行拍卖测试场景")
        print("="*50)
        
        result = self.create_auction_scenario()
        if result:
            print(f"\n🎯 拍卖测试场景创建成功!")
            print(f"   拍卖ID: {result['auction_id']}")
            
            # 推进时间到需要重置的状态
            print(f"\n⏰ 推进时间到需要重置的状态...")
            if self.fast_forward_time(7201):  # 超过2小时
                print(f"💡 现在可以运行拍卖重置机器人进行测试:")
                print(f"   python auction_reset_keeper.py")
                return True
            else:
                print("❌ 时间推进失败")
                return False
        else:
            print("❌ 拍卖测试场景创建失败")
            return False

def main():
    """主函数"""
    print("="*50)
    print("   StableCoin Keeper测试场景生成器")
    print("="*50)
    print("1. 创建清算测试场景")
    print("2. 创建拍卖重置测试场景")
    print("3. 创建完整测试场景")
    print("4. 退出")
    print("="*50)
    
    choice = input("请选择操作 (1-4): ").strip()
    
    if not os.path.exists("config.json"):
        print("❌ 配置文件不存在，请先运行 local_test_setup.py")
        return
    
    creator = TestScenarioCreator()
    
    if choice == "1":
        creator.run_liquidation_test()
    elif choice == "2":
        creator.run_auction_test()
    elif choice == "3":
        if creator.run_liquidation_test():
            print("\n" + "="*50)
            creator.run_auction_test()
    elif choice == "4":
        print("再见!")
    else:
        print("无效选择")

if __name__ == "__main__":
    main()
