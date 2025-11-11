#!/usr/bin/env python3
"""
Keeper机器人启动脚本
可以同时启动清算和拍卖重置机器人
"""

import asyncio
import logging
import signal
import sys
import os
from liquidation_keeper import LiquidationKeeper
from auction_reset_keeper import AuctionResetKeeper

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('keeper_bots.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

class KeeperBotManager:
    """Keeper机器人管理器"""
    
    def __init__(self, config_path: str = "config.json"):
        self.config_path = config_path
        self.liquidation_keeper = None
        self.auction_reset_keeper = None
        self.running = False
        
        # 设置信号处理
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)
    
    def signal_handler(self, signum, frame):
        """信号处理函数"""
        logger.info(f"收到信号 {signum}，正在停止机器人...")
        self.running = False
    
    async def start_liquidation_keeper(self):
        """启动清算机器人"""
        try:
            logger.info("启动清算Keeper机器人...")
            self.liquidation_keeper = LiquidationKeeper(self.config_path)
            await self.liquidation_keeper.monitor_and_liquidate()
        except Exception as e:
            logger.error(f"清算机器人运行出错: {e}")
    
    async def start_auction_reset_keeper(self):
        """启动拍卖重置机器人"""
        try:
            logger.info("启动拍卖重置Keeper机器人...")
            self.auction_reset_keeper = AuctionResetKeeper(self.config_path)
            await self.auction_reset_keeper.monitor_and_reset()
        except Exception as e:
            logger.error(f"拍卖重置机器人运行出错: {e}")
    
    async def run_all_bots(self):
        """运行所有机器人"""
        logger.info("开始运行所有Keeper机器人...")
        self.running = True
        
        # 创建任务
        tasks = [
            asyncio.create_task(self.start_liquidation_keeper()),
            asyncio.create_task(self.start_auction_reset_keeper())
        ]
        
        try:
            # 等待所有任务完成（实际上会一直运行直到被中断）
            await asyncio.gather(*tasks)
        except asyncio.CancelledError:
            logger.info("机器人任务被取消")
        except Exception as e:
            logger.error(f"机器人运行出错: {e}")
        finally:
            # 取消所有任务
            for task in tasks:
                task.cancel()
            
            # 等待任务完成取消
            await asyncio.gather(*tasks, return_exceptions=True)
            logger.info("所有机器人已停止")
    
    def run(self):
        """运行机器人管理器"""
        try:
            asyncio.run(self.run_all_bots())
        except KeyboardInterrupt:
            logger.info("收到键盘中断信号，正在停止...")
        except Exception as e:
            logger.error(f"机器人管理器运行出错: {e}")

def check_config():
    """检查配置文件是否存在"""
    if not os.path.exists("config.json"):
        print("错误: 配置文件 config.json 不存在")
        print("请先创建配置文件，或运行单个机器人来自动生成示例配置")
        return False
    return True

def main():
    """主函数"""
    print("=" * 50)
    print("    StableCoin Keeper机器人管理器")
    print("=" * 50)
    print("1. 启动清算Keeper机器人")
    print("2. 启动拍卖重置Keeper机器人") 
    print("3. 同时启动所有机器人")
    print("4. 退出")
    print("=" * 50)
    
    choice = input("请选择操作 (1-4): ").strip()
    
    if choice == "1":
        if check_config():
            keeper = LiquidationKeeper()
            keeper.run()
    elif choice == "2":
        if check_config():
            keeper = AuctionResetKeeper()
            keeper.run()
    elif choice == "3":
        if check_config():
            manager = KeeperBotManager()
            manager.run()
    elif choice == "4":
        print("再见!")
        sys.exit(0)
    else:
        print("无效选择，请重新运行程序")

if __name__ == "__main__":
    main()
