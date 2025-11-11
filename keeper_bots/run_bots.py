#!/usr/bin/env python3
"""
Keeper机器人启动脚本
用于启动清算和拍卖重置keeper机器人
"""

import json
import os
import sys
import time
import threading
from web3 import Web3

# 导入keeper模块
from liquidation_keeper import LiquidationKeeper
from auction_reset_keeper import AuctionResetKeeper

def load_config(config_path: str = "config.json"):
    """加载配置文件"""
    try:
        with open(config_path, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"❌ 加载配置文件失败: {e}")
        return None

def setup_web3_connection(config):
    """设置Web3连接"""
    try:
        w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
        if not w3.is_connected():
            print("❌ Web3连接失败")
            return None
        return w3
    except Exception as e:
        print(f"❌ Web3连接设置失败: {e}")
        return None

def run_liquidation_keeper(config, w3):
    """运行清算keeper"""
    print("🚀 启动清算Keeper...")
    try:
        keeper = LiquidationKeeper()
        keeper.run()
    except Exception as e:
        print(f"❌ 清算Keeper运行失败: {e}")

def run_auction_reset_keeper(config, w3):
    """运行拍卖重置keeper"""
    print("🚀 启动拍卖重置Keeper...")
    try:
        keeper = AuctionResetKeeper()
        keeper.run()
    except Exception as e:
        print(f"❌ 拍卖重置Keeper运行失败: {e}")

def main():
    """主函数"""
    print("=" * 50)
    print("   StableCoin Keeper机器人启动")
    print("=" * 50)
    
    # 加载配置
    config = load_config()
    if not config:
        sys.exit(1)
    
    # 设置Web3连接
    w3 = setup_web3_connection(config)
    if not w3:
        sys.exit(1)
    
    print(f"✅ 连接到网络: {w3.eth.chain_id}")
    print(f"✅ 当前区块: {w3.eth.block_number}")
    print(f"✅ Keeper地址: {config['keeper_address']}")
    
    # 检查余额
    balance = w3.eth.get_balance(config['keeper_address'])
    balance_eth = w3.from_wei(balance, 'ether')
    print(f"✅ Keeper余额: {balance_eth:.6f} ETH")
    
    if balance_eth < 0.01:
        print("⚠️  余额较低，建议充值")
    
    print("\n" + "=" * 50)
    print("启动keeper机器人...")
    print("=" * 50)
    
    # 创建并启动线程
    threads = []
    
    # 清算keeper线程
    liquidation_thread = threading.Thread(
        target=run_liquidation_keeper, 
        args=(config, w3),
        daemon=True
    )
    threads.append(liquidation_thread)
    
    # 拍卖重置keeper线程
    auction_reset_thread = threading.Thread(
        target=run_auction_reset_keeper, 
        args=(config, w3),
        daemon=True
    )
    threads.append(auction_reset_thread)
    
    # 启动所有线程
    for thread in threads:
        thread.start()
    
    print("✅ 所有keeper机器人已启动")
    print("📝 按 Ctrl+C 停止机器人")
    
    try:
        # 主线程保持运行
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n🛑 正在停止keeper机器人...")
        print("👋 再见！")

if __name__ == "__main__":
    main()
