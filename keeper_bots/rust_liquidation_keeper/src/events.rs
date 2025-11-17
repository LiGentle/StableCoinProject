//! 事件监控模块
//!
//! 负责监听三个主要合约的事件：InterestManager、LiquidationManager、AuctionManager。
//!
//! ## 特性概述：
//! - 支持实时监听（WebSocket）和轮询两种模式
//! - 事件去重机制防止重复处理
//! - 预计算事件签名提升性能
//! - 内存缓存管理防止内存泄漏
//! - 细粒度的事件处理和参数更新逻辑

use std::sync::Arc;
use std::collections::{HashMap, HashSet};
use web3::types::{Address, BlockNumber, FilterBuilder, H256, U64};
use futures_util::StreamExt;
use crate::database::{Database, AuctionInfo, AuctionStatus, UserPosition};

/// 事件唯一标识符 - 用于去重
#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct EventId {
    block_number: u64,
    transaction_index: usize,
    log_index: usize,
}

/// 获取当前时间戳的工具函数
fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// 监听模式
#[derive(Debug, Clone)]
pub enum MonitorMode {
    /// 轮询模式 (fallback)
    Polling,
    /// 实时监听模式 (推荐)
    Realtime,
}

/// 事件监控器
pub struct EventMonitor {
    web3_http: Option<web3::Web3<web3::transports::Http>>,
    web3_ws: Option<web3::Web3<web3::transports::WebSocket>>,
    database: Arc<Database>,
    config: crate::config::AppConfig,
    /// 预计算的事件签名缓存
    event_signatures: HashMap<String, H256>,
    /// 已处理的事件ID缓存 - 用于去重
    processed_events: HashSet<EventId>,
    /// 监听模式
    mode: MonitorMode,
}

impl EventMonitor {
    pub async fn new(
        web3_http: web3::Web3<web3::transports::Http>,
        database: Arc<Database>,
        config: crate::config::AppConfig,
    ) -> anyhow::Result<Self> {
        // 预计算所有事件签名以提高性能
        let mut event_signatures = HashMap::new();

        // InterestManager 事件签名
        event_signatures.insert("InterestRateChanged".to_string(), H256::from_slice(&web3::signing::keccak256("InterestRateChanged(uint256,uint256)".as_bytes())));
        event_signatures.insert("PositionIncreased".to_string(), H256::from_slice(&web3::signing::keccak256("PositionIncreased(address,uint256,uint256,uint256,uint256)".as_bytes())));
        event_signatures.insert("PositionOpened".to_string(), H256::from_slice(&web3::signing::keccak256("PositionOpened(address,uint256,uint256,uint256)".as_bytes())));
        event_signatures.insert("InterestCollected".to_string(), H256::from_slice(&web3::signing::keccak256("InterestCollected(address,uint256,uint256,uint256)".as_bytes())));

        // LiquidationManager 事件签名
        event_signatures.insert("LiquidationParameterChanged".to_string(), H256::from_slice(&web3::signing::keccak256("ParameterChanged(bytes32,uint256)".as_bytes())));
        event_signatures.insert("LiquidationConfigInfo".to_string(), H256::from_slice(&web3::signing::keccak256("LiquidationConfigInfo(uint256,uint256,uint256,bool)".as_bytes())));

        // AuctionManager 事件签名
        event_signatures.insert("AuctionParameterChanged".to_string(), H256::from_slice(&web3::signing::keccak256("ParameterChanged(bytes32,uint256)".as_bytes())));
        event_signatures.insert("AuctionStarted".to_string(), H256::from_slice(&web3::signing::keccak256("AuctionStarted(uint256,uint256,uint256,address,uint256,address,uint256)".as_bytes())));
        event_signatures.insert("AuctionReset".to_string(), H256::from_slice(&web3::signing::keccak256("AuctionReset(uint256,uint256,uint256,address,uint256,address,uint256)".as_bytes())));
        event_signatures.insert("AuctionRemoved".to_string(), H256::from_slice(&web3::signing::keccak256("AuctionRemoved(uint256)".as_bytes())));

        // 验证合约地址可以正确解析
        let _ = config.contracts.interest_manager.parse::<Address>()?;
        let _ = config.contracts.liquidation_manager.parse::<Address>()?;
        let _ = config.contracts.auction_manager.parse::<Address>()?;

        // 尝试初始化WebSocket连接（实时模式）
        let (web3_ws, mode) = if let Some(ref ws_url) = config.ws_url {
            match web3::transports::WebSocket::new(ws_url).await {
                Ok(ws_transport) => {
                    let ws_web3 = web3::Web3::new(ws_transport);
                    tracing::info!("WebSocket连接成功，使用实时监听模式");
                    (Some(ws_web3), MonitorMode::Realtime)
                }
                Err(e) => {
                    tracing::warn!("WebSocket连接失败，回退到轮询模式: {}", e);
                    (None, MonitorMode::Polling)
                }
            }
        } else {
            (None, MonitorMode::Polling)
        };

        tracing::info!(
            "事件监控器初始化完成 - 模式: {:?}, 预计算了 {} 个事件签名",
            mode, event_signatures.len()
        );

        Ok(Self {
            web3_http: Some(web3_http),
            web3_ws,
            database,
            config,
            event_signatures,
            processed_events: HashSet::new(),
            mode,
        })
    }

    pub async fn run(&mut self) -> anyhow::Result<()> {
        tracing::info!("开始监听区块链事件...");

        match self.mode {
            MonitorMode::Realtime => {
                self.run_realtime_mode().await
            }
            MonitorMode::Polling => {
                self.run_polling_mode().await
            }
        }
    }

    /// 实时监听模式（推荐）
    async fn run_realtime_mode(&mut self) -> anyhow::Result<()> {
        tracing::info!("🚀 启动实时监听模式，使用WebSocket订阅新区块事件");

        let web3_ws = self.web3_ws.as_ref().ok_or_else(|| anyhow::anyhow!("WebSocket未初始化"))?;

        // 创建新的区块头订阅
        let mut subscription = web3_ws.eth_subscribe().subscribe_new_heads().await?;

        tracing::info!("✅ 已订阅新区块头，实时监听开始...");

        while let Some(block_header) = subscription.next().await {
            match block_header {
                Ok(header) => {
                    tracing::debug!("收到新区块: {}", header.number.unwrap_or_default());

                    // 处理区块中的事件
                    if let Err(e) = self.process_block_events(header.number.unwrap_or_default().as_u64()).await {
                        tracing::error!("处理区块事件失败: {}", e);
                        // 继续监听，不中断
                    }
                }
                Err(e) => {
                    tracing::error!("WebSocket订阅错误: {}", e);
                    // WebSocket断开，回退到轮询模式
                    tracing::warn!("WebSocket断开，正在回退到轮询模式...");
                    self.mode = MonitorMode::Polling;
                    return self.run_polling_mode().await;
                }
            }
        }

        Ok(())
    }

    /// 轮询监听模式（fallback）
    async fn run_polling_mode(&mut self) -> anyhow::Result<()> {
        tracing::info!("⏰ 启动轮询监听模式，间隔: {}秒", self.config.event_monitoring.polling_interval_secs);

        let mut interval = tokio::time::interval(std::time::Duration::from_secs(self.config.event_monitoring.polling_interval_secs));

        loop {
            interval.tick().await;

            // 定期清理长时间没有活跃的已处理事件缓存，避免内存泄漏
            self.cleanup_processed_events_cache();

            // 监听所有合约的事件
            if let Err(e) = self.monitor_all_events().await {
                tracing::error!("事件监听错误: {}", e);
                // 继续运行，不中断
            }
        }
    }

    /// 处理指定区块的事件（实时模式使用）
    async fn process_block_events(&mut self, block_number: u64) -> anyhow::Result<()> {
        let web3 = self.web3_http.as_ref().ok_or_else(|| anyhow::anyhow!("HTTP客户端未初始化"))?;

        // 获取区块号范围进行过滤（当前区块）
        let filter = FilterBuilder::default()
            .from_block(BlockNumber::Number(U64::from(block_number)))
            .to_block(BlockNumber::Number(U64::from(block_number)))
            .address(vec![
                self.config.contracts.interest_manager.parse()?,
                self.config.contracts.liquidation_manager.parse()?,
                self.config.contracts.auction_manager.parse()?,
            ])
            .build();

        match web3.eth().logs(filter).await {
            Ok(logs) => {
                let mut processed_count = 0;
                for log in logs {
                    // 去重检查
                    let event_id = EventId {
                        block_number: log.block_number.unwrap_or_default().as_u64(),
                        transaction_index: log.transaction_index.unwrap_or_default().as_usize(),
                        log_index: log.log_index.unwrap_or_default().as_usize(),
                    };

                    if self.processed_events.contains(&event_id) {
                        tracing::debug!("跳过已处理的事件: {:?}", event_id);
                        continue;
                    }

                    // 根据合约地址确定事件类型并处理
                    // log.address 在有address过滤器的情况下总是Some
                    if self.contract_matches(&log.address, &self.config.contracts.interest_manager) {
                        if let Err(e) = self.process_interest_event_from_log(&log).await {
                            tracing::error!("处理InterestManager事件失败: {}", e);
                        }
                    } else if self.contract_matches(&log.address, &self.config.contracts.liquidation_manager) {
                        if let Err(e) = self.process_liquidation_event_from_log(&log).await {
                            tracing::error!("处理LiquidationManager事件失败: {}", e);
                        }
                    } else if self.contract_matches(&log.address, &self.config.contracts.auction_manager) {
                        if let Err(e) = self.process_auction_event_from_log(&log).await {
                            tracing::error!("处理AuctionManager事件失败: {}", e);
                        }
                    }

                    // 标记为已处理
                    self.processed_events.insert(event_id);
                    processed_count += 1;
                }

                if processed_count > 0 {
                    tracing::info!("处理了区块 {} 的事件数量: {}", block_number, processed_count);
                }
            }
            Err(e) => {
                tracing::warn!("获取区块 {} 日志失败: {}", block_number, e);
            }
        }

        Ok(())
    }

    /// 根据事件签名确定事件名称并处理
    async fn process_interest_event_from_log(&self, log: &web3::types::Log) -> anyhow::Result<()> {
        if log.topics.is_empty() {
            return Ok(());
        }

        let event_signature = H256::from_slice(&log.topics[0].as_bytes());
        let event_name = self.event_signatures.iter()
            .find(|(_, &sig)| sig == event_signature)
            .map(|(name, _)| name.as_str())
            .unwrap_or("Unknown");

        self.process_interest_event(event_name, log).await
    }

    async fn process_liquidation_event_from_log(&self, log: &web3::types::Log) -> anyhow::Result<()> {
        if log.topics.is_empty() {
            return Ok(());
        }

        let event_signature = H256::from_slice(&log.topics[0].as_bytes());
        let event_name = if event_signature == self.event_signatures["LiquidationParameterChanged"] {
            "ParameterChanged"
        } else if event_signature == self.event_signatures["LiquidationConfigInfo"] {
            "LiquidationConfigInfo"
        } else {
            "Unknown"
        };

        self.process_liquidation_event(event_name, log).await
    }

    async fn process_auction_event_from_log(&self, log: &web3::types::Log) -> anyhow::Result<()> {
        if log.topics.is_empty() {
            return Ok(());
        }

        let event_signature = H256::from_slice(&log.topics[0].as_bytes());
        let event_name = if event_signature == self.event_signatures["AuctionParameterChanged"] {
            "ParameterChanged"
        } else if event_signature == self.event_signatures["AuctionStarted"] {
            "AuctionStarted"
        } else if event_signature == self.event_signatures["AuctionReset"] {
            "AuctionReset"
        } else if event_signature == self.event_signatures["AuctionRemoved"] {
            "AuctionRemoved"
        } else {
            "Unknown"
        };

        self.process_auction_event(event_name, log).await
    }

    /// 定期清理已处理事件缓存，防止内存泄漏
    fn cleanup_processed_events_cache(&mut self) {
        // 如果缓存大于5000则清理到2500个事件
        // 这里简化实现，实际项目中可能需要更复杂的清理策略
        if self.processed_events.len() > 5000 {
            tracing::debug!("清理已处理事件缓存，当前大小: {}", self.processed_events.len());

            // 简单的清理策略：保留最小的2500个事件（HashSet是无序的，这里只是减少大小）
            // 实际实现应该考虑事件时间戳，从最老的开始清理
            let mut retained = HashSet::with_capacity(2500);
            let mut count = 0;

            for event_id in &self.processed_events {
                if count >= 2500 {
                    break;
                }
                retained.insert(event_id.clone());
                count += 1;
            }

            self.processed_events = retained;
            tracing::debug!("已清理事件缓存到大小: {}", self.processed_events.len());
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
            ("PositionIncreased", "PositionIncreased(address,uint256,uint256,uint256,uint256)"),
            ("PositionOpened", "PositionOpened(address,uint256,uint256,uint256)"),
            ("InterestCollected", "InterestCollected(address,uint256,uint256,uint256)"),
        ];

        for (event_name, signature) in events {
            let topic = web3::signing::keccak256(signature.as_bytes());
            let filter = FilterBuilder::default()
                .address(vec![contract_address])
                .topics(Some(vec![H256::from_slice(&topic)]), None, None, None)
                .build();

            match self.web3_http.as_ref().ok_or_else(|| anyhow::anyhow!("HTTP客户端未初始化"))?.eth().logs(filter).await {
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

            match self.web3_http.as_ref().ok_or_else(|| anyhow::anyhow!("HTTP客户端未初始化"))?.eth().logs(filter).await {
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
            ("AuctionReset", "AuctionReset(uint256,uint256,uint256,address,uint256,address,uint256)"),
            ("AuctionRemoved", "AuctionRemoved(uint256)"),
        ];

        for (event_name, signature) in events {
            let topic = web3::signing::keccak256(signature.as_bytes());
            let filter = FilterBuilder::default()
                .address(vec![contract_address])
                .topics(Some(vec![H256::from_slice(&topic)]), None, None, None)
                .build();

            match self.web3_http.as_ref().ok_or_else(|| anyhow::anyhow!("HTTP客户端未初始化"))?.eth().logs(filter).await {
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
                // PositionIncreased(address indexed user, uint256 indexed tokenId, uint256 amount, uint256 totalAmount, uint256 totalInterest)

                if log.topics.len() >= 3 {
                    // 解析 indexed 参数
                    let user = Address::from_slice(&log.topics[1].as_bytes()[12..32]); // indexed address
                    let token_id = web3::types::U256::from_big_endian(&log.topics[2].as_bytes()); // indexed uint256

                    // 从 log.data 中解析非 indexed 参数
                    if log.data.0.len() >= 96 { // 3个参数 * 32字节
                        // amount 是增加的量，我们不需要
                        // let amount = web3::types::U256::from_big_endian(&log.data.0[0..32]);
                        let total_amount = web3::types::U256::from_big_endian(&log.data.0[32..64]); // 最新的总持仓量
                        let total_interest = web3::types::U256::from_big_endian(&log.data.0[64..96]); // 当前的累计利息

                        // 获取或创建持仓记录
                        let position = match self.database.get_user_position(user, token_id) {
                            Ok(Some(mut existing)) => {
                                // 更新现有持仓：最新的总数量、累计利息和更新时间戳
                                existing.amount = total_amount;
                                existing.total_interest = total_interest;
                                existing.timestamp = current_timestamp();
                                existing
                            },
                            _ => {
                                // 如果没有现存记录，创建新的持仓记录
                                UserPosition {
                                    user,
                                    token_id,
                                    amount: total_amount,
                                    timestamp: current_timestamp(),
                                    total_interest,
                                }
                            }
                        };

                        // 保存到数据库
                        self.database.store_user_position(&position)?;

                        tracing::info!("InterestManager: 持仓更新 - 用户: {:?}, TokenID: {}, 总数量: {}, 累计利息: {}",
                                     user, token_id, total_amount, total_interest);
                    } else {
                        tracing::warn!("PositionIncreased event data too short, got {} bytes (expected 96)", log.data.0.len());
                    }
                } else {
                    tracing::warn!("PositionIncreased event has insufficient topics: {}", log.topics.len());
                }
            }
            "PositionOpened" => {
                // PositionOpened(address indexed user, uint256 indexed tokenId, uint256 amount, uint256 timestamp)

                if log.topics.len() >= 3 {
                    // 解析 indexed 参数
                    let user = Address::from_slice(&log.topics[1].as_bytes()[12..32]); // indexed address
                    let token_id = web3::types::U256::from_big_endian(&log.topics[2].as_bytes()); // indexed uint256

                    // 从 log.data 中解析已非 indexed 参数
                    if log.data.0.len() >= 64 { // 2个参数 * 32字节
                        let amount = web3::types::U256::from_big_endian(&log.data.0[0..32]);
                        let timestamp = web3::types::U256::from_big_endian(&log.data.0[32..64]);

                        // 创建用户持仓信息并存储到数据库
                        let position = UserPosition {
                            user: user.clone(),
                            token_id,
                            amount,
                            timestamp: timestamp.low_u64(), // U256转换为u64时间戳
                            total_interest: web3::types::U256::zero(), // 新持仓初始利息为0
                        };

                        // 存储到数据库
                        self.database.store_user_position(&position)?;

                        tracing::info!("InterestManager: 新持仓开启 - 用户: {:?}, TokenID: {}, 数量: {}, 时间戳: {}",
                                     user, token_id, amount, timestamp);
                    } else {
                        tracing::warn!("PositionOpened event data too short, got {} bytes (expected 64)", log.data.0.len());
                    }
                } else {
                    tracing::warn!("PositionOpened event has insufficient topics: {}", log.topics.len());
                }
            }
            "InterestCollected" => {
                // InterestCollected(address indexed user, uint256 indexed tokenId, uint256 deductLAmountInWei, uint256 interestAmount)

                if log.topics.len() >= 3 {
                    // 解析 indexed 参数
                    let user = Address::from_slice(&log.topics[1].as_bytes()[12..32]); // indexed address
                    let token_id = web3::types::U256::from_big_endian(&log.topics[2].as_bytes()); // indexed uint256

                    // 从 log.data 中解析非 indexed 参数
                    if log.data.0.len() >= 64 { // 2个参数 * 32字节
                        let deduct_amount = web3::types::U256::from_big_endian(&log.data.0[0..32]); // deductLAmountInWei
                        let interest_amount = web3::types::U256::from_big_endian(&log.data.0[32..64]); // interestAmount

                        // 检查用户持仓是否存在
                        if let Ok(Some(mut position)) = self.database.get_user_position(user, token_id) {
                            // 更新持仓：balance = balance - deductLAmountInWei
                            position.amount = position.amount - deduct_amount;

                            // 更新累计利息：totalInterest = totalInterest - interestAmount
                            position.total_interest = position.total_interest - interest_amount;

                            // 更新时间戳
                            position.timestamp = current_timestamp();

                            if position.amount == web3::types::U256::zero() {
                                // balance == 0，删除这个代币持仓
                                self.database.delete_user_position(user, token_id)?;
                                tracing::info!("InterestManager: 利息收集后持仓清零，已删除 - 用户: {:?}, TokenID: {}, 扣除量: {}, 利息金额: {}",
                                             user, token_id, deduct_amount, interest_amount);
                            } else {
                                // 保存更新后的持仓信息
                                self.database.store_user_position(&position)?;
                                tracing::info!("InterestManager: 利息收集更新 - 用户: {:?}, TokenID: {}, 扣除量: {}, 利息金额: {}, 剩余持仓: {}, 剩余累计利息: {}",
                                             user, token_id, deduct_amount, interest_amount, position.amount, position.total_interest);
                            }
                        } else {
                            tracing::warn!("InterestCollected: 用户持仓不存在 - 用户: {:?}, TokenID: {}", user, token_id);
                        }
                    } else {
                        tracing::warn!("InterestCollected event data too short, got {} bytes (expected 64)", log.data.0.len());
                    }
                } else {
                    tracing::warn!("InterestCollected event has insufficient topics: {}", log.topics.len());
                }
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
                // 在ABI编码中：uint256=32字节，bool=32字节，总共4*32=128字节

                if log.data.0.len() >= 128 { // 3*uint256 + 1*bool = 4*32 = 128字节
                    let adjustment_threshold = web3::types::U256::from_big_endian(&log.data.0[0..32]);
                    let liquidation_threshold = web3::types::U256::from_big_endian(&log.data.0[32..64]);
                    let penalty = web3::types::U256::from_big_endian(&log.data.0[64..96]);
                    let enabled = web3::types::U256::from_big_endian(&log.data.0[96..128]);

                    // 更新数据库中的清算参数（enabled是个开关状态，不需要存储在参数库中）
                    self.database.update_adjustment_threshold(adjustment_threshold)?;
                    self.database.update_liquidation_threshold(liquidation_threshold)?;
                    self.database.update_penalty(penalty)?;

                    let enabled_flag = enabled.low_u32() != 0; // U256转换为bool：非0即true
                    tracing::info!("LiquidationManager: 清算配置同步 - adjustment_threshold: {}, liquidation_threshold: {}, penalty: {}, enabled: {}",
                                 adjustment_threshold, liquidation_threshold, penalty, enabled_flag);
                } else {
                    tracing::warn!("LiquidationConfigInfo event data too short, got {} bytes (expected 128)", log.data.0.len());
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

                    // 根据参数名更新数据库
                    self.update_auction_parameter(parameter_bytes, value).await?;
                } else {
                    tracing::warn!("ParameterChanged event has insufficient topics");
                }
            }
            "AuctionStarted" => {
                // AuctionStarted(uint256 indexed auctionId, uint256 startingPrice, uint256 underlyinglAmount,
                //                 address originalOwner, uint256 indexed tokenId, address indexed triggerer, uint256 rewardAmount)

                if log.topics.len() >= 4 {
                    // 解析 indexed 参数
                    let auction_id = web3::types::U256::from_big_endian(&log.topics[1].as_bytes());
                    let token_id = web3::types::U256::from_big_endian(&log.topics[2].as_bytes());

                    // 从 log.data 中解析非 indexed 参数
                    if log.data.0.len() >= 128 { // 4个参数 * 32字节
                        let starting_price = web3::types::U256::from_big_endian(&log.data.0[0..32]);
                        let underlying_amount = web3::types::U256::from_big_endian(&log.data.0[32..64]);
                        let original_owner = Address::from_slice(&log.data.0[76..96]); // address 在第12-32字节位置
                        let reward_amount = web3::types::U256::from_big_endian(&log.data.0[96..128]);

                        // topics[3] 包含 triggerer 地址 (indexed)
                        let triggerer = Address::from_slice(&log.topics[3].as_bytes()[12..32]);

                        // 创建拍卖信息并存储到数据库
                        let auction_info = AuctionInfo {
                            auction_id,
                            starting_price,
                            underlying_amount,
                            original_owner,
                            token_id,
                            triggerer: triggerer.clone(),
                            reward_amount,
                            start_time: current_timestamp(),
                            status: AuctionStatus::Active,
                        };

                        // 存储到数据库
                        self.database.store_auction(&auction_info)?;

                        tracing::info!(
                            "AuctionManager: 新拍卖开始 - ID: {}, 起始价格: {}, 标的总量: {}, 原始持有者: {:?}, 触发者: {:?}",
                            auction_id, starting_price, underlying_amount, original_owner, triggerer
                        );
                    } else {
                        tracing::warn!("AuctionStarted event data too short, got {} bytes (expected 128)", log.data.0.len());
                    }
                } else {
                    tracing::warn!("AuctionStarted event has insufficient topics: {}", log.topics.len());
                }
            }
            "AuctionReset" => {
                // AuctionReset(uint256 indexed auctionId, uint256 newStartingPrice, uint256 underlyingAmount,
                //               address originalOwner, uint256 indexed tokenId, address indexed triggerer, uint256 rewardAmount)

                if log.topics.len() >= 4 {
                    // 解析 indexed 参数
                    let auction_id = web3::types::U256::from_big_endian(&log.topics[1].as_bytes());

                    // 从 log.data 中解析 newStartingPrice
                    if log.data.0.len() >= 32 {
                        let new_starting_price = web3::types::U256::from_big_endian(&log.data.0[0..32]);

                        // 更新拍卖数据库记录：新的起始价格和起始时间
                        if let Ok(Some(mut auction_info)) = self.database.get_auction(auction_id) {
                            auction_info.starting_price = new_starting_price;
                            auction_info.start_time = current_timestamp();

                            // 重新保存更新后的拍卖信息
                            self.database.store_auction(&auction_info)?;

                            tracing::info!("AuctionManager: 拍卖 {} 重置 - 新起始价格: {}, 新起始时间: {}",
                                         auction_id, new_starting_price, auction_info.start_time);
                        } else {
                            tracing::warn!("AuctionReset: 尝试重置不存在的拍卖 {}", auction_id);
                        }
                    } else {
                        tracing::warn!("AuctionReset event data too short, got {} bytes (expected at least 32)", log.data.0.len());
                    }
                } else {
                    tracing::warn!("AuctionReset event has insufficient topics: {}", log.topics.len());
                }
            }
            "AuctionRemoved" => {
                // AuctionRemoved(uint256 indexed auctionId)
                // 单参数事件，auctionId 在 topic[1] 中
                // AuctionRemoved 会在两种情况下发出：
                // 1. 拍卖正常结束 (underlyingAmount == 0)
                // 2. 管理员主动取消拍卖

                if log.topics.len() >= 2 {
                    // topics[0]: 事件签名哈希
                    // topics[1]: indexed auctionId 参数
                    let auction_id = web3::types::U256::from_big_endian(&log.topics[1].as_bytes());

                    // 删除数据库中的拍卖记录
                    self.database.delete_auction(auction_id)?;
                    tracing::info!("拍卖 {} 已结束/取消，已从数据库删除", auction_id);
                } else {
                    tracing::warn!("AuctionRemoved event has insufficient topics: {}", log.topics.len());
                }
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

    /// 检查合约地址是否匹配配置的字符串地址
    fn contract_matches(&self, contract_address: &web3::types::Address, config_address: &str) -> bool {
        if let Ok(parsed_address) = config_address.parse::<web3::types::Address>() {
            contract_address == &parsed_address
        } else {
            false
        }
    }

    /// 根据 AuctionManager setParameter 函数更新相应的数据库参数
    async fn update_auction_parameter(&self, parameter_bytes: &[u8], value: web3::types::U256) -> anyhow::Result<()> {
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
            "AuctionManager 参数解析 - 原始字节前12个: [{:x?}], 找到结束位置: {}, 解析出参数名: '{}'",
            &parameter_bytes[0..12.min(end_pos)], end_pos, parameter_name
        );

        match parameter_name {
            "priceMultiplier" => {
                self.database.update_price_multiplier(value)?;
                tracing::info!("AuctionManager: priceMultiplier 更新为 {}", value);
            }
            "resetTime" => {
                self.database.update_reset_time(value)?;
                tracing::info!("AuctionManager: resetTime 更新为 {}", value);
            }
            "minAuctionAmount" => {
                self.database.update_min_auction_amount(value)?;
                tracing::info!("AuctionManager: minAuctionAmount 更新为 {}", value);
            }
            "priceDropThreshold" => {
                self.database.update_price_drop_threshold(value)?;
                tracing::info!("AuctionManager: priceDropThreshold 更新为 {}", value);
            }
            "percentageReward" => {
                self.database.update_percentage_reward(value)?;
                tracing::info!("AuctionManager: percentageReward 更新为 {}", value);
            }
            "fixedReward" => {
                self.database.update_fixed_reward(value)?;
                tracing::info!("AuctionManager: fixedReward 更新为 {}", value);
            }
            "circuitBreaker" => {
                // circuitBreaker 是一个特殊的参数，用于控制拍卖断路器
                // 这个参数可能需要单独处理，目前我们只记录日志
                tracing::info!("AuctionManager: circuitBreaker 更新为 {} (break when > 0)", value);
                // TODO: 根据需要存储或处理 circuitBreaker 状态
            }
            unrecognized => {
                // 根据 Solidity 代码，这应该会 revert，但是我们记录警告
                tracing::warn!("AuctionManager: 未识别的参数名 '{}' (bytes: {:?})", parameter_name, parameter_bytes);
                return Ok(()); // 不中断处理
            }
        }

        Ok(())
    }
}
