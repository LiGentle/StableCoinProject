//! 事件监控模块
//!
//! 负责监听三个主要合约的事件：InterestManager、LiquidationManager、AuctionManager。

use std::sync::Arc;
use web3::types::{FilterBuilder, H256};
use crate::database::Database;

/// 事件监控器
pub struct EventMonitor {
    web3: web3::Web3<web3::transports::Http>,
    database: Arc<Database>,
    config: crate::config::AppConfig,
}

impl EventMonitor {
    pub fn new(
        web3: web3::Web3<web3::transports::Http>,
        database: Arc<Database>,
        config: crate::config::AppConfig,
    ) -> anyhow::Result<Self> {
        tracing::info!("事件监控器初始化");
        Ok(Self { web3, database, config })
    }

    pub async fn run(&mut self) -> anyhow::Result<()> {
        tracing::info!("开始监听区块链事件...");

        let mut interval = tokio::time::interval(std::time::Duration::from_secs(10));

        loop {
            interval.tick().await;

            // 监听所有合约的事件
            if let Err(e) = self.monitor_all_events().await {
                tracing::error!("事件监听错误: {}", e);
                // 继续运行，不中断
            }
        }
    }

    async fn monitor_all_events(&self) -> anyhow::Result<()> {
        // 监听 InterestManager 事件
        self.monitor_interest_manager_events().await?;

        // 监听 LiquidationManager 事件
        self.monitor_liquidation_manager_events().await?;

        // 监听 AuctionManager 事件
        self.monitor_auction_manager_events().await?;

        Ok(())
    }

    async fn monitor_interest_manager_events(&self) -> anyhow::Result<()> {
        let contract_address = self.config.contracts.interest_manager.parse()?;

        // InterestManager 事件签名
        let events = vec![
            ("InterestRateChanged", "InterestRateChanged(uint256,uint256)"),
            ("PositionIncreased", "PositionIncreased(address,uint256,uint256,uint256)"),
            ("PositionOpened", "PositionOpened(address,uint256,uint256,uint256)"),
            ("InterestCollected", "InterestCollected(address,uint256,uint256,uint256)"),
            ("ParameterChanged", "ParameterChanged(bytes32,uint256)"),
            ("LiquidationConfigInfo", "LiquidationConfigInfo(uint256,uint256,uint256,bool)"),
        ];

        for (event_name, signature) in events {
            let topic = web3::signing::keccak256(signature.as_bytes());
            let filter = FilterBuilder::default()
                .address(vec![contract_address])
                .topics(Some(vec![H256::from_slice(&topic)]), None, None, None)
                .build();

            match self.web3.eth().logs(filter).await {
                Ok(logs) => {
                    for log in logs {
                        self.process_interest_event(event_name, &log).await?;
                    }
                }
                Err(e) => {
                    tracing::warn!("获取 {} 事件失败: {}", event_name, e);
                }
            }
        }

        Ok(())
    }

    async fn monitor_liquidation_manager_events(&self) -> anyhow::Result<()> {
        let contract_address = self.config.contracts.liquidation_manager.parse()?;

        let events = vec![
            ("ParameterChanged", "ParameterChanged(bytes32,uint256)"),
            ("LiquidationConfigInfo", "LiquidationConfigInfo(uint256,uint256,uint256,bool)"),
        ];

        for (event_name, signature) in events {
            let topic = web3::signing::keccak256(signature.as_bytes());
            let filter = FilterBuilder::default()
                .address(vec![contract_address])
                .topics(Some(vec![H256::from_slice(&topic)]), None, None, None)
                .build();

            match self.web3.eth().logs(filter).await {
                Ok(logs) => {
                    for log in logs {
                        self.process_liquidation_event(event_name, &log).await?;
                    }
                }
                Err(e) => {
                    tracing::warn!("获取 {} 事件失败: {}", event_name, e);
                }
            }
        }

        Ok(())
    }

    async fn monitor_auction_manager_events(&self) -> anyhow::Result<()> {
        let contract_address = self.config.contracts.auction_manager.parse()?;

        let events = vec![
            ("ParameterChanged", "ParameterChanged(bytes32,uint256)"),
            ("AuctionStarted", "AuctionStarted(uint256,uint256,uint256,address,uint256,address,uint256)"),
            ("PurchaseMade", "PurchaseMade(uint256,uint256,uint256,uint256,uint256,address,address)"),
            ("AuctionReset", "AuctionReset(uint256,uint256,uint256,address,uint256,address,uint256)"),
            ("AuctionRemoved", "AuctionRemoved(uint256)"),
            ("AuctionCancelled", "AuctionCancelled(uint256)"),
        ];

        for (event_name, signature) in events {
            let topic = web3::signing::keccak256(signature.as_bytes());
            let filter = FilterBuilder::default()
                .address(vec![contract_address])
                .topics(Some(vec![H256::from_slice(&topic)]), None, None, None)
                .build();

            match self.web3.eth().logs(filter).await {
                Ok(logs) => {
                    for log in logs {
                        self.process_auction_event(event_name, &log).await?;
                    }
                }
                Err(e) => {
                    tracing::warn!("获取 {} 事件失败: {}", event_name, e);
                }
            }
        }

        Ok(())
    }

    async fn process_interest_event(&self, event_name: &str, log: &web3::types::Log) -> anyhow::Result<()> {
        match event_name {
            "InterestRateChanged" => {
                // InterestRateChanged(uint256 oldRate, uint256 newRate)
                if log.topics.len() >= 3 {
                    let new_rate = web3::types::U256::from_big_endian(&log.topics[2].as_bytes());
                    self.database.update_annual_interest_rate(new_rate)?;
                    tracing::info!("InterestManager: 利率更新为 {}", new_rate);
                }
            }
            "PositionIncreased" => {
                tracing::info!("InterestManager: 用户持仓增加");
                // TODO: 处理持仓增加事件 - 更新数据库中的用户持仓信息
            }
            "PositionOpened" => {
                tracing::info!("InterestManager: 新持仓开启");
                // TODO: 处理新持仓开启 - 添加用户持仓到数据库
            }
            "InterestCollected" => {
                tracing::info!("InterestManager: 利息收集");
                // TODO: 处理利息收集 - 更新用户利息累计
            }
            "ParameterChanged" => {
                tracing::info!("InterestManager: 参数变更");
                // TODO: 处理参数变更 - 根据参数名更新数据库
            }
            "LiquidationConfigInfo" => {
                tracing::info!("InterestManager: 清算配置信息");
                // TODO: 处理清算配置变更
            }
            _ => {}
        }
        Ok(())
    }

    async fn process_liquidation_event(&self, event_name: &str, log: &web3::types::Log) -> anyhow::Result<()> {
        match event_name {
            "ParameterChanged" => {
                // ParameterChanged(bytes32 indexed parameter, uint256 value)
                // 需要解析 indexed parameter (topic[1]) 和 value (data)

                if log.topics.len() >= 2 {
                    // 解析 bytes32 parameter 从 topic[1] (字符串左对齐)
                    // 对于字符串参数，取整个32字节并找到第一个null字节之前的部分
                    let parameter_bytes = log.topics[1].as_bytes(); // 整个32字节

                    // 从 log.data 中解析 uint256 value
                    // event 数据会是 ABI 编码的，所以第一个32字节是 value
                    let value = if log.data.0.len() >= 32 {
                        web3::types::U256::from_big_endian(&log.data.0[0..32])
                    } else {
                        tracing::warn!("ParameterChanged event data too short");
                        return Ok(());
                    };

                    // 根据参数名更新数据库 - 传递32字节数组
                    self.update_liquidation_parameter(parameter_bytes, value).await?;
                } else {
                    tracing::warn!("ParameterChanged event has insufficient topics");
                }
            }
            "LiquidationConfigInfo" => {
                // LiquidationConfigInfo(uint256 adjustmentThreshold, uint256 liquidationThreshold, uint256 penalty, bool enabled)
                // 这是一个全配置事件，用于同步所有清算参数

                if log.data.0.len() >= 128 { // 4个uint256 = 128字节
                    let adjustment_threshold = web3::types::U256::from_big_endian(&log.data.0[0..32]);
                    let liquidation_threshold = web3::types::U256::from_big_endian(&log.data.0[32..64]);
                    let penalty = web3::types::U256::from_big_endian(&log.data.0[64..96]);

                    // 更新数据库中的所有相关参数
                    self.database.update_adjustment_threshold(adjustment_threshold)?;
                    self.database.update_liquidation_threshold(liquidation_threshold)?;
                    self.database.update_penalty(penalty)?;

                    tracing::info!("LiquidationManager: 清算配置同步 - adjustment_threshold: {}, liquidation_threshold: {}, penalty: {}",
                                 adjustment_threshold, liquidation_threshold, penalty);
                } else {
                    tracing::warn!("LiquidationConfigInfo event data too short, got {} bytes", log.data.0.len());
                }
            }
            _ => {
                tracing::debug!("Unknown liquidation event: {}", event_name);
            }
        }
        Ok(())
    }

    async fn process_auction_event(&self, event_name: &str, log: &web3::types::Log) -> anyhow::Result<()> {
        match event_name {
            "ParameterChanged" => {
                tracing::info!("AuctionManager: 参数变更");
                // TODO: 处理拍卖参数变更 - priceDropThreshold, resetTime, 等
            }
            "AuctionStarted" => {
                tracing::info!("AuctionManager: 拍卖开始");
                // TODO: 处理拍卖开始 - 保存拍卖信息到数据库
            }
            "PurchaseMade" => {
                tracing::info!("AuctionManager: 拍卖购买");
                // TODO: 处理拍卖购买 - 更新购买状态
            }
            "AuctionReset" => {
                tracing::info!("AuctionManager: 拍卖重置");
                // TODO: 处理拍卖重置
            }
            "AuctionRemoved" => {
                tracing::info!("AuctionManager: 拍卖移除");
                // TODO: 处理拍卖移除
            }
            "AuctionCancelled" => {
                tracing::info!("AuctionManager: 拍卖取消");
                // TODO: 处理拍卖取消
            }
            _ => {}
        }
        Ok(())
    }

    /// 根据 Solidity setParameter 函数更新相应的数据库参数
    async fn update_liquidation_parameter(&self, parameter_bytes: &[u8], value: web3::types::U256) -> anyhow::Result<()> {
        // 确保数据长度正确 (32字节)
        if parameter_bytes.len() != 32 {
            tracing::warn!("Parameter bytes length incorrect: {}, expected 32", parameter_bytes.len());
            return Ok(());
        }

        // 找到字符串结束位置 (第一个 null 字节或空格的索引)
        let end_pos = parameter_bytes.iter().position(|&b| b == 0 || b == b' ').unwrap_or(32);

        // 提取字符串并移除空白字符
        let parameter_slice = &parameter_bytes[0..end_pos];
        let parameter_str = String::from_utf8_lossy(parameter_slice);
        let parameter_name = parameter_str.trim();

        // 添加调试日志来验证字符串解析
        tracing::debug!(
            "LiquidationManager 参数解析 - 原始字节前12个: [{:x?}], 找到结束位置: {}, 解析出参数名: '{}'",
            &parameter_bytes[0..12.min(end_pos)], end_pos, parameter_name
        );

        match parameter_name {
            "adjustmentThreshold" => {
                self.database.update_adjustment_threshold(value)?;
                tracing::info!("LiquidationManager: adjustmentThreshold 更新为 {}", value);
            }
            "liquidationThreshold" => {
                self.database.update_liquidation_threshold(value)?;
                tracing::info!("LiquidationManager: liquidationThreshold 更新为 {}", value);
            }
            "penalty" => {
                self.database.update_penalty(value)?;
                tracing::info!("LiquidationManager: penalty 更新为 {}", value);
            }
            unrecognized => {
                // 根据 Solidity 代码，这应该会 revert，但是我们记录警告
                tracing::warn!("LiquidationManager: 未识别的参数名 '{}' (bytes: {:?})", parameter_name, parameter_bytes);
                return Ok(()); // 不中断处理
            }
        }

        Ok(())
    }
}
