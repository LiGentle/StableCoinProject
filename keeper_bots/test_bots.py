#!/usr/bin/env python3
"""
Keeper机器人测试脚本
用于验证机器人基本功能是否正常
"""

import json
import os
import sys
from web3 import Web3

def test_web3_connection(config_path: str = "config.json"):
    """测试Web3连接"""
    print("测试Web3连接...")
    
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
        
        w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
        
        if w3.is_connected():
            print(f"✅ Web3连接成功")
            print(f"   网络ID: {w3.eth.chain_id}")
            print(f"   最新区块: {w3.eth.block_number}")
            return True
        else:
            print("❌ Web3连接失败")
            return False
            
    except Exception as e:
        print(f"❌ Web3连接测试失败: {e}")
        return False

def test_config_file(config_path: str = "config.json"):
    """测试配置文件"""
    print("测试配置文件...")
    
    if not os.path.exists(config_path):
        print("❌ 配置文件不存在")
        return False
    
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
        
        required_fields = [
            "rpc_url", "keeper_address", "private_key", "contracts"
        ]
        
        contract_fields = [
            "custodian", "liquidation_manager", "leverage_token", 
            "price_oracle", "auction_manager", "price_calculator"
        ]
        
        # 检查必需字段
        for field in required_fields:
            if field not in config:
                print(f"❌ 缺少必需字段: {field}")
                return False
        
        # 检查合约地址字段
        for contract in contract_fields:
            if contract not in config["contracts"]:
                print(f"❌ 缺少合约地址: {contract}")
                return False
        
        print("✅ 配置文件格式正确")
        return True
        
    except Exception as e:
        print(f"❌ 配置文件测试失败: {e}")
        return False

def test_abi_files(abi_dir: str = "abis"):
    """测试ABI文件"""
    print("测试ABI文件...")
    
    required_abis = [
        "CustodianFixed.json",
        "LiquidationManager.json", 
        "MultiLeverageToken.json",
        "LTCPriceOracle.json",
        "AuctionManager.json",
        "LinearDecrease.json"
    ]
    
    missing_files = []
    
    for abi_file in required_abis:
        abi_path = os.path.join(abi_dir, abi_file)
        if not os.path.exists(abi_path):
            missing_files.append(abi_file)
    
    if missing_files:
        print("❌ 缺少以下ABI文件:")
        for file in missing_files:
            print(f"   - {file}")
        return False
    else:
        print("✅ 所有ABI文件都存在")
        return True

def test_contract_connections(config_path: str = "config.json"):
    """测试合约连接"""
    print("测试合约连接...")
    
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
        
        w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
        
        if not w3.is_connected():
            print("❌ Web3未连接")
            return False
        
        abi_dir = config.get("abi_dir", "abis")
        contracts = config["contracts"]
        
        # 测试关键合约连接
        test_contracts = [
            ("CustodianFixed", contracts["custodian"]),
            ("LiquidationManager", contracts["liquidation_manager"]),
            ("AuctionManager", contracts["auction_manager"])
        ]
        
        for contract_name, address in test_contracts:
            try:
                abi_path = os.path.join(abi_dir, f"{contract_name}.json")
                with open(abi_path, 'r') as f:
                    abi_data = json.load(f)
                
                # 处理Hardhat artifact格式的ABI
                if isinstance(abi_data, dict) and 'abi' in abi_data:
                    abi = abi_data['abi']
                else:
                    abi = abi_data
                
                contract = w3.eth.contract(address=address, abi=abi)
                
                # 尝试调用一个简单的view函数
                if contract_name == "CustodianFixed":
                    result = contract.functions.totalSupplyS().call()
                elif contract_name == "LiquidationManager":
                    result = contract.functions.globalConfig().call()
                elif contract_name == "AuctionManager":
                    result = contract.functions.getActiveAuctionCount().call()
                
                print(f"✅ {contract_name} 连接成功")
                
            except Exception as e:
                print(f"❌ {contract_name} 连接失败: {e}")
                return False
        
        return True
        
    except Exception as e:
        print(f"❌ 合约连接测试失败: {e}")
        return False

def test_keeper_balance(config_path: str = "config.json"):
    """测试Keeper地址余额"""
    print("测试Keeper地址余额...")
    
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
        
        w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
        
        keeper_address = config["keeper_address"]
        balance = w3.eth.get_balance(keeper_address)
        balance_eth = w3.from_wei(balance, 'ether')
        
        print(f"✅ Keeper地址余额: {balance_eth:.6f} ETH")
        
        if balance_eth < 0.01:
            print("⚠️  余额较低，建议充值")
            return False
        else:
            return True
            
    except Exception as e:
        print(f"❌ 余额查询失败: {e}")
        return False

def main():
    """运行所有测试"""
    print("=" * 50)
    print("   StableCoin Keeper机器人测试")
    print("=" * 50)
    
    tests = [
        test_config_file,
        test_web3_connection,
        test_abi_files,
        test_contract_connections,
        test_keeper_balance
    ]
    
    results = []
    
    for test in tests:
        try:
            result = test()
            results.append(result)
        except Exception as e:
            print(f"❌ 测试 {test.__name__} 异常: {e}")
            results.append(False)
        
        print()  # 空行分隔
    
    # 汇总结果
    passed = sum(results)
    total = len(results)
    
    print("=" * 50)
    print(f"测试结果: {passed}/{total} 通过")
    
    if passed == total:
        print("🎉 所有测试通过！可以启动机器人")
        return True
    else:
        print("❌ 部分测试失败，请检查配置")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
