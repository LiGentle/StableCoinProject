#!/usr/bin/env python3
"""
本地测试设置脚本
为本地测试环境配置keeper机器人
"""

import json
import os
import sys
from web3 import Web3
import subprocess

def get_deployer_info():
    """获取deployer地址和私钥"""
    # 从hardhat配置或环境变量获取deployer信息
    deployer_address = os.getenv("DEPLOYER_ADDRESS", "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")
    deployer_private_key = os.getenv("DEPLOYER_PRIVATE_KEY", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
    
    print(f"使用deployer地址: {deployer_address}")
    return deployer_address, deployer_private_key

def get_contract_addresses():
    """从部署文件获取合约地址"""
    deployment_files = [
        "scripts/deployments/deployment-latest.json",
        "scripts/auctions_test/deployments/deployment-latest.json"
    ]
    
    addresses = {}
    
    for file_path in deployment_files:
        if os.path.exists(file_path):
            try:
                with open(file_path, 'r') as f:
                    deployment = json.load(f)
                
                print(f"从 {file_path} 加载合约地址...")
                
                # 提取合约地址
                for contract_name, contract_info in deployment.items():
                    if 'address' in contract_info:
                        addresses[contract_name] = contract_info['address']
                        print(f"  {contract_name}: {contract_info['address']}")
                        
            except Exception as e:
                print(f"读取部署文件 {file_path} 失败: {e}")
    
    return addresses

def create_test_config(deployer_address, deployer_private_key, contract_addresses):
    """创建测试配置文件"""
    config = {
        "rpc_url": "http://localhost:8545",
        "is_poa": False,
        "keeper_address": deployer_address,
        "private_key": deployer_private_key,
        "check_interval": 10,  # 测试环境检查间隔较短
        "contracts": {
            "custodian": contract_addresses.get("CustodianFixed", "0xCustodianAddress"),
            "liquidation_manager": contract_addresses.get("LiquidationManager", "0xLiquidationManagerAddress"),
            "leverage_token": contract_addresses.get("MultiLeverageToken", "0xLeverageTokenAddress"),
            "price_oracle": contract_addresses.get("LTCPriceOracle", "0xPriceOracleAddress"),
            "auction_manager": contract_addresses.get("AuctionManager", "0xAuctionManagerAddress"),
            "price_calculator": contract_addresses.get("LinearDecrease", "0xPriceCalculatorAddress")
        },
        "abi_dir": "abis"
    }
    
    # 保存配置文件
    with open("config.json", 'w') as f:
        json.dump(config, f, indent=2)
    
    print("✅ 测试配置文件 config.json 创建成功")

def setup_abi_files():
    """设置ABI文件"""
    abi_dir = "abis"
    os.makedirs(abi_dir, exist_ok=True)
    
    # 从编译后的artifacts复制ABI文件
    artifact_paths = {
        "CustodianFixed": "contracts/artifacts/contracts/CustodianFixed.sol/CustodianFixed.json",
        "LiquidationManager": "contracts/artifacts/contracts/auctions/LiquidationManager.sol/LiquidationManager.json",
        "MultiLeverageToken": "contracts/artifacts/contracts/tokens/MultiLeverageToken.sol/MultiLeverageToken.json",
        "LTCPriceOracle": "contracts/artifacts/contracts/oracles/LTCPriceOracle.sol/LTCPriceOracle.json",
        "AuctionManager": "contracts/artifacts/contracts/auctions/AuctionManager.sol/AuctionManager.json",
        "LinearDecrease": "contracts/artifacts/contracts/auctions/abaci.sol/LinearDecrease.json"
    }
    
    print("设置ABI文件...")
    
    for contract_name, artifact_path in artifact_paths.items():
        if os.path.exists(artifact_path):
            try:
                with open(artifact_path, 'r') as f:
                    artifact = json.load(f)
                
                # 提取ABI
                abi = artifact.get("abi", [])
                
                # 保存ABI文件
                abi_file = os.path.join(abi_dir, f"{contract_name}.json")
                with open(abi_file, 'w') as f:
                    json.dump(abi, f, indent=2)
                
                print(f"✅ {contract_name} ABI文件创建成功")
                
            except Exception as e:
                print(f"❌ 创建 {contract_name} ABI文件失败: {e}")
        else:
            print(f"⚠️  未找到 {contract_name} 的artifact文件: {artifact_path}")

def check_local_network():
    """检查本地网络连接"""
    print("检查本地网络连接...")
    
    try:
        w3 = Web3(Web3.HTTPProvider("http://localhost:8545"))
        
        if w3.is_connected():
            print(f"✅ 本地网络连接成功")
            print(f"   网络ID: {w3.eth.chain_id}")
            print(f"   最新区块: {w3.eth.block_number}")
            print(f"   Gas价格: {w3.eth.gas_price}")
            
            # 检查deployer余额
            deployer_address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
            balance = w3.eth.get_balance(deployer_address)
            balance_eth = w3.from_wei(balance, 'ether')
            print(f"   Deployer余额: {balance_eth:.2f} ETH")
            
            return True
        else:
            print("❌ 本地网络连接失败")
            return False
            
    except Exception as e:
        print(f"❌ 网络连接检查失败: {e}")
        return False

def create_test_scenarios():
    """创建测试场景说明"""
    print("\n" + "="*50)
    print("本地测试场景说明")
    print("="*50)
    
    scenarios = [
        {
            "name": "清算测试场景",
            "steps": [
                "1. 部署完整的稳定币系统",
                "2. 创建一些杠杆代币持仓",
                "3. 降低LTC价格触发净值下降",
                "4. 运行清算机器人观察清算行为"
            ]
        },
        {
            "name": "拍卖重置测试场景", 
            "steps": [
                "1. 触发清算创建拍卖",
                "2. 等待拍卖超过重置时间",
                "3. 运行拍卖重置机器人观察重置行为"
            ]
        }
    ]
    
    for scenario in scenarios:
        print(f"\n📋 {scenario['name']}:")
        for step in scenario['steps']:
            print(f"   {step}")

def run_quick_test():
    """运行快速测试"""
    print("\n运行快速测试...")
    
    try:
        # 测试配置文件
        if os.path.exists("config.json"):
            with open("config.json", 'r') as f:
                config = json.load(f)
            print("✅ 配置文件验证通过")
        else:
            print("❌ 配置文件不存在")
            return False
        
        # 测试ABI文件
        abi_dir = config.get("abi_dir", "abis")
        required_abis = [
            "CustodianFixed.json", "LiquidationManager.json", "MultiLeverageToken.json",
            "LTCPriceOracle.json", "AuctionManager.json", "LinearDecrease.json"
        ]
        
        missing_abis = []
        for abi_file in required_abis:
            if not os.path.exists(os.path.join(abi_dir, abi_file)):
                missing_abis.append(abi_file)
        
        if missing_abis:
            print(f"❌ 缺少ABI文件: {', '.join(missing_abis)}")
            return False
        else:
            print("✅ ABI文件验证通过")
        
        # 测试网络连接
        w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
        if w3.is_connected():
            print("✅ 网络连接验证通过")
        else:
            print("❌ 网络连接失败")
            return False
        
        print("🎉 所有测试通过！可以启动机器人进行本地测试")
        return True
        
    except Exception as e:
        print(f"❌ 快速测试失败: {e}")
        return False

def main():
    """主函数"""
    print("="*50)
    print("   StableCoin Keeper机器人本地测试设置")
    print("="*50)
    
    # 检查本地网络
    if not check_local_network():
        print("\n⚠️  请确保本地Hardhat节点正在运行:")
        print("   npx hardhat node")
        return
    
    # 获取deployer信息
    deployer_address, deployer_private_key = get_deployer_info()
    
    # 获取合约地址
    contract_addresses = get_contract_addresses()
    
    if not contract_addresses:
        print("\n⚠️  未找到部署文件，请先部署合约:")
        print("   npx hardhat run scripts/auctions_test/deploy_full_system.js --network localhost")
        return
    
    # 创建配置文件
    create_test_config(deployer_address, deployer_private_key, contract_addresses)
    
    # 设置ABI文件
    setup_abi_files()
    
    # 创建测试场景说明
    create_test_scenarios()
    
    # 运行快速测试
    if run_quick_test():
        print("\n🎯 设置完成！现在可以运行机器人:")
        print("   python start_bots.py")
        print("   或单独运行: python liquidation_keeper.py 或 python auction_reset_keeper.py")
    else:
        print("\n❌ 设置失败，请检查上述错误信息")

if __name__ == "__main__":
    main()
