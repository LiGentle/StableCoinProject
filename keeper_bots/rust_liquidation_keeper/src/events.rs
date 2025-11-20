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
use crate::database::{Database, AuctionInfo, UserPosition, LeverageType};
use crate::reset::AuctionResetMonitor;

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

/// 事件清理紧急程度
#[derive(Debug, Clone, Copy)]
enum CleanupUrgency {
    Light,      // 轻度：维护性清理
    Moderate,   // 中度：预防性清理
    Critical,   // 紧急：必须清理
}

/// 事件元数据结构
#[derive(Debug, Clone)]
struct EventMetadata {
    event_id: EventId,
    timestamp: u64,
    is_hot: bool,      // 是否在热点时间窗口内
    priority: i8,      // 清理优先级 (负数优先保留，正数优先清理)
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
    /// 拍卖重置监控器
    auction_reset_monitor: AuctionResetMonitor,
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
        // PositionOpened 事件不再监控，根据用户的指示
        // event_signatures.insert("PositionOpened".to_string(), H256::from_slice(&web3::signing::keccak256("PositionOpened(address,uint256,uint256,uint256)".as_bytes())));
        event_signatures.insert("InterestCollected".to_string(), H256::from_slice(&web3::signing::keccak256("InterestCollected(address,uint256,uint256,uint256)".as_bytes())));

        // CustodianFixed 事件签名
        event_signatures.insert("Mint".to_string(), H256::from_slice(&web3::signing::keccak256("Mint(address,uint256,uint256,uint8,uint256,uint256,uint256)".as_bytes())));

        // LiquidationManager 事件签名
        event_signatures.insert("LiquidationParameterChanged".to_string(), H256::from_slice(&web3::signing::keccak256("ParameterChanged(bytes32,uint256)".as_bytes())));
        event_signatures.insert("LiquidationConfigInfo".to_string(), H256::from_slice(&web3::signing::keccak256("LiquidationConfigInfo(uint256,uint256,uint256,bool)".as_bytes())));
        event_signatures.insert("NetValueAdjusted".to_string(), H256::from_slice(&web3::signing::keccak256("NetValueAdjusted(address,uint256,uint256,uint8,uint256,uint256,uint256)".as_bytes())));

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

        // 初始化拍卖重置监控器
        let web3_for_reset = web3_http.clone();
        let auction_reset_monitor = AuctionResetMonitor::new(
            web3_for_reset,
            database.clone(),
            config.contracts.auction_manager.clone(),
        )?;

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
            auction_reset_monitor,
        })
    }

    pub async fn run(&mut self) -> anyhow::Result<()> {
        tracing::info!("开始监听区块链事件...");

        // 执行初始历史同步
        if let Err(e) = self.perform_initial_sync().await {
            tracing::error!("初始历史同步失败: {}", e);
            // 继续运行，但记录错误
        }

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

    /// 执行初始历史同步
    async fn perform_initial_sync(&self) -> anyhow::Result<()> {
        tracing::info!("开始执行初始历史同步...");

        let web3 = self.web3_http.as_ref().ok_or_else(|| anyhow::anyhow!("HTTP客户端未初始化"))?;

        // 获取当前最新区块号
        let latest_block = web3.eth().block_number().await?;
        let latest_block_num = latest_block.as_u64();
        tracing::info!("当前链上最新区块号: {}", latest_block_num);

        // 获取最后同步的区块号
        let last_synced_block = self.database.get_last_synced_block()?;

        match last_synced_block {
            Some(last_block) => {
                if last_block >= latest_block_num {
                    tracing::info!("最后同步区块 {} 已是最新的，无需同步", last_block);
                    return Ok(());
                }

                tracing::info!("检测到区块差距: 最后同步区块 {}, 当前区块 {}, 需要同步 {} 个区块",
                             last_block, latest_block_num, latest_block_num - last_block);

                // 从最后同步区块的下一个区块开始同步
                let start_block = last_block + 1;
                let end_block = latest_block_num;

                self.sync_block_range(web3, start_block, end_block).await?;
            }
            None => {
                // 如果没有最后同步记录，执行冷启动
                self.perform_cold_start_sync(web3, latest_block_num).await?;
            }
        }

        Ok(())
    }

    /// 执行冷启动同步
    async fn perform_cold_start_sync(&self, web3: &web3::Web3<web3::transports::Http>, latest_block: u64) -> anyhow::Result<()> {
        if self.config.event_monitoring.cold_start_backtrace_blocks == 0 {
            // 不回溯历史，只从最新区块开始
            tracing::info!("冷启动配置: 只从最新区块 {} 开始同步，不回溯历史", latest_block);
            self.database.set_last_synced_block(latest_block)?;
            return Ok(());
        }

        // 回溯指定数量的区块
        let backtrace_blocks = self.config.event_monitoring.cold_start_backtrace_blocks;
        let start_block = if latest_block > backtrace_blocks {
            latest_block - backtrace_blocks
        } else {
            0 // 从创世区块开始
        };

        tracing::info!("冷启动配置: 从区块 {} 回溯 {} 个区块到区块 {}",
                     start_block, backtrace_blocks, latest_block);

        self.sync_block_range(web3, start_block, latest_block).await?;

        Ok(())
    }

    /// 同步指定区块范围
    async fn sync_block_range(&self, web3: &web3::Web3<web3::transports::Http>, start_block: u64, end_block: u64) -> anyhow::Result<()> {
        if start_block > end_block {
            tracing::info!("同步范围无效: start_block={} > end_block={}", start_block, end_block);
            return Ok(());
        }

        tracing::info!("开始从区块 {} 同步到区块 {}", start_block, end_block);

        // 批量同步区块，每次处理一批
        let batch_size = 100; // 每批处理的区块数量
        let mut current_block = start_block;
        let mut total_events_processed = 0;

        while current_block <= end_block {
            let batch_end = std::cmp::min(current_block + batch_size - 1, end_block);
            tracing::debug!("处理区块批次: {} - {}", current_block, batch_end);

            // 并行处理一批区块
            let mut handles = vec![];

            for block_num in current_block..=batch_end {
                let web3_clone = web3.clone();
                let database_clone = self.database.clone();
                let config_clone = self.config.clone();
                let event_signatures_clone = self.event_signatures.clone();

                let handle = tokio::spawn(async move {
                    Self::sync_single_block(
                        web3_clone,
                        database_clone,
                        config_clone,
                        event_signatures_clone,
                        block_num,
                    ).await
                });
                handles.push(handle);
            }

            // 等待这一批的所有任务完成
            for handle in handles {
                match handle.await {
                    Ok(Ok(events_count)) => {
                        total_events_processed += events_count;
                    }
                    Ok(Err(e)) => {
                        tracing::error!("同步区块失败: {}", e);
                    }
                    Err(e) => {
                        tracing::error!("任务执行失败: {}", e);
                    }
                }
            }

            // 更新最后同步区块号为当前批次的结束区块
            self.database.set_last_synced_block(batch_end)?;
            tracing::debug!("已同步至区块 {}，累计处理事件数量: {}", batch_end, total_events_processed);

            current_block = batch_end + 1;
        }

        tracing::info!("历史同步完成! 从区块 {} 同步到 {}, 总共处理了 {} 个事件",
                     start_block, end_block, total_events_processed);

        Ok(())
    }

    /// 同步单个区块的事件（静态方法，用于并行处理）
    async fn sync_single_block(
        web3: web3::Web3<web3::transports::Http>,
        database: Arc<Database>,
        config: crate::config::AppConfig,
        event_signatures: HashMap<String, H256>,
        block_number: u64,
    ) -> anyhow::Result<usize> {
        // 获取区块号范围进行过滤（单个区块）
        let filter = FilterBuilder::default()
            .from_block(BlockNumber::Number(U64::from(block_number)))
            .to_block(BlockNumber::Number(U64::from(block_number)))
            .address(vec![
                config.contracts.interest_manager.parse()?,
                config.contracts.liquidation_manager.parse()?,
                config.contracts.auction_manager.parse()?,
                config.contracts.custodian.parse()?, // 添加CustodianFixed地址
            ])
            .build();

        match web3.eth().logs(filter).await {
            Ok(logs) => {
                let mut processed_count = 0;

                for log in logs {
                    // 根据合约地址确定事件类型并处理
                    // log.address 在有address过滤器的情况下总是Some
                    if Self::contract_matches_static(&log.address, &config.contracts.interest_manager) {
                        if let Err(e) = Self::process_interest_event_from_log_static(&database, &event_signatures, &log).await {
                            tracing::error!("处理InterestManager事件失败: {}", e);
                        }
                    } else if Self::contract_matches_static(&log.address, &config.contracts.liquidation_manager) {
                        if let Err(e) = Self::process_liquidation_event_from_log_static(&database, &event_signatures, &log).await {
                            tracing::error!("处理LiquidationManager事件失败: {}", e);
                        }
                    } else if Self::contract_matches_static(&log.address, &config.contracts.auction_manager) {
                        if let Err(e) = Self::process_auction_event_from_log_static(&database, &event_signatures, &log).await {
                            tracing::error!("处理AuctionManager事件失败: {}", e);
                        }
                    } else if Self::contract_matches_static(&log.address, &config.contracts.custodian) {
                        // 处理CustodianFixed事件
                        if let Err(e) = Self::process_custodian_event_from_log_static(&database, &event_signatures, &log).await {
                            tracing::error!("处理CustodianFixed事件失败: {}", e);
                        }
                    }

                    processed_count += 1;
                }

                if processed_count > 0 {
                    tracing::debug!("区块 {} 处理了 {} 个事件", block_number, processed_count);
                }

                Ok(processed_count)
            }
            Err(e) => {
                tracing::warn!("获取区块 {} 日志失败: {}", block_number, e);
                Ok(0)
            }
        }
    }

    /// 静态方法版本的事件处理函数（用于历史同步）

    async fn process_interest_event_from_log_static(
        database: &Arc<Database>,
        event_signatures: &HashMap<String, H256>,
        log: &web3::types::Log,
    ) -> anyhow::Result<()> {
        if log.topics.is_empty() {
            return Ok(());
        }

        let event_signature = H256::from_slice(&log.topics[0].as_bytes());
        let event_name = event_signatures.iter()
            .find(|(_, &sig)| sig == event_signature)
            .map(|(name, _)| name.as_str())
            .unwrap_or("Unknown");

        Self::process_interest_event_static(database, event_name, log).await
    }

    async fn process_liquidation_event_from_log_static(
        database: &Arc<Database>,
        event_signatures: &HashMap<String, H256>,
        log: &web3::types::Log,
    ) -> anyhow::Result<()> {
        if log.topics.is_empty() {
            return Ok(());
        }

        let event_signature = H256::from_slice(&log.topics[0].as_bytes());
        let event_name = if event_signature == event_signatures["LiquidationParameterChanged"] {
            "ParameterChanged"
        } else if event_signature == event_signatures["LiquidationConfigInfo"] {
            "LiquidationConfigInfo"
        } else if event_signature == event_signatures["NetValueAdjusted"] {
            "NetValueAdjusted"
        } else {
            "Unknown"
        };

        Self::process_liquidation_event_static(database, event_name, log).await
    }

    async fn process_auction_event_from_log_static(
        database: &Arc<Database>,
        event_signatures: &HashMap<String, H256>,
        log: &web3::types::Log,
    ) -> anyhow::Result<()> {
        if log.topics.is_empty() {
            return Ok(());
        }

        let event_signature = H256::from_slice(&log.topics[0].as_bytes());
        let event_name = if event_signature == event_signatures["AuctionParameterChanged"] {
            "ParameterChanged"
        } else if event_signature == event_signatures["AuctionStarted"] {
            "AuctionStarted"
        } else if event_signature == event_signatures["AuctionReset"] {
            "AuctionReset"
        } else if event_signature == event_signatures["AuctionRemoved"] {
            "AuctionRemoved"
        } else {
            "Unknown"
        };

        Self::process_auction_event_static(database, event_name, log).await
    }

    async fn process_custodian_event_from_log_static(
        database: &Arc<Database>,
        event_signatures: &HashMap<String, H256>,
        log: &web3::types::Log,
    ) -> anyhow::Result<()> {
        if log.topics.is_empty() {
            return Ok(());
        }

        let event_signature = H256::from_slice(&log.topics[0].as_bytes());
        let event_name = if event_signature == event_signatures["Mint"] {
            "Mint"
        } else {
            "Unknown"
        };

        Self::process_custodian_event_static(database, event_name, log).await
    }

    async fn process_interest_event_static(
        database: &Arc<Database>,
        event_name: &str,
        log: &web3::types::Log,
    ) -> anyhow::Result<()> {
        match event_name {
            "InterestRateChanged" => {
                if log.topics.len() >= 3 {
                    let new_rate = web3::types::U256::from_big_endian(&log.topics[2].as_bytes());
                    database.update_annual_interest_rate(new_rate)?;
                    tracing::trace!("同步历史事件：InterestManager: 利率更新为 {}", new_rate);
                }
            }
            "PositionIncreased" => {
                if log.topics.len() >= 3 {
                    let user = Address::from_slice(&log.topics[1].as_bytes()[12..32]);
                    let token_id = web3::types::U256::from_big_endian(&log.topics[2].as_bytes());

                    if log.data.0.len() >= 96 {
                        let total_amount = web3::types::U256::from_big_endian(&log.data.0[32..64]);
                        let total_interest = web3::types::U256::from_big_endian(&log.data.0[64..96]);

                        let position = match database.get_user_position(user, token_id) {
                            Ok(Some(mut existing)) => {
                                existing.amount = total_amount;
                                existing.total_interest = total_interest;
                                existing.timestamp = current_timestamp();
                                existing
                            },
                            _ => {
                                UserPosition {
                                    user,
                                    token_id,
                                    amount: total_amount,
                                    timestamp: current_timestamp(),
                                    total_interest,
                                    leverage: LeverageType::Conservative,
                                    mint_price: web3::types::U256::zero(),
                                }
                            }
                        };

                        database.store_user_position(&position)?;
                        tracing::trace!("同步历史事件：InterestManager: 持仓更新 - 用户: {:?}, TokenID: {}, 总数量: {}", user, token_id, total_amount);
                    }
                }
            }
            "InterestCollected" => {
                if log.topics.len() >= 3 {
                    let user = Address::from_slice(&log.topics[1].as_bytes()[12..32]);
                    let token_id = web3::types::U256::from_big_endian(&log.topics[2].as_bytes());

                    if log.data.0.len() >= 64 {
                        let deduct_amount = web3::types::U256::from_big_endian(&log.data.0[0..32]);
                        let interest_amount = web3::types::U256::from_big_endian(&log.data.0[32..64]);

                        if let Ok(Some(mut position)) = database.get_user_position(user, token_id) {
                            position.amount = position.amount - deduct_amount;
                            position.total_interest = position.total_interest - interest_amount;
                            position.timestamp = current_timestamp();

                            if position.amount == web3::types::U256::zero() {
                                database.delete_user_position(user, token_id)?;
                            } else {
                                database.store_user_position(&position)?;
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }

    async fn process_liquidation_event_static(
        database: &Arc<Database>,
        event_name: &str,
        log: &web3::types::Log,
    ) -> anyhow::Result<()> {
        match event_name {
            "ParameterChanged" => {
                if log.topics.len() >= 2 {
                    let parameter_bytes = log.topics[1].as_bytes();
                    let value = if log.data.0.len() >= 32 {
                        web3::types::U256::from_big_endian(&log.data.0[0..32])
                    } else {
                        return Ok(());
                    };
                    Self::update_liquidation_parameter_static(database, parameter_bytes, value).await?;
                }
            }
            "LiquidationConfigInfo" => {
                if log.data.0.len() >= 128 {
                    let adjustment_threshold = web3::types::U256::from_big_endian(&log.data.0[0..32]);
                    let liquidation_threshold = web3::types::U256::from_big_endian(&log.data.0[32..64]);
                    let penalty = web3::types::U256::from_big_endian(&log.data.0[64..96]);

                    database.update_adjustment_threshold(adjustment_threshold)?;
                    database.update_liquidation_threshold(liquidation_threshold)?;
                    database.update_penalty(penalty)?;
                }
            }
            "NetValueAdjusted" => {
                if log.topics.len() >= 4 {
                    let user = Address::from_slice(&log.topics[1].as_bytes()[12..32]);
                    let to_token_id = web3::types::U256::from_big_endian(&log.topics[3].as_bytes());

                    if log.data.0.len() >= 97 {
                        let leverage_value = log.data.0[0];
                        let new_mint_price = web3::types::U256::from_big_endian(&log.data.0[1..33]);
                        let adjust_amount_in_wei = web3::types::U256::from_big_endian(&log.data.0[33..65]);

                        let leverage = LeverageType::from_u8(leverage_value)?;

                        let existing_position = database.get_user_position(user, to_token_id)?;

                        match existing_position {
                            Some(mut position) => {
                                position.leverage = leverage.clone();
                                position.mint_price = new_mint_price;
                                database.store_user_position(&position)?;
                            }
                            None => {
                                let new_position = UserPosition {
                                    user,
                                    token_id: to_token_id,
                                    amount: adjust_amount_in_wei,
                                    timestamp: current_timestamp(),
                                    total_interest: web3::types::U256::zero(),
                                    leverage: leverage.clone(),
                                    mint_price: new_mint_price,
                                };
                                database.store_user_position(&new_position)?;
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }

    async fn process_auction_event_static(
        database: &Arc<Database>,
        event_name: &str,
        log: &web3::types::Log,
    ) -> anyhow::Result<()> {
        match event_name {
            "ParameterChanged" => {
                if log.topics.len() >= 2 {
                    let parameter_bytes = log.topics[1].as_bytes();
                    let value = if log.data.0.len() >= 32 {
                        web3::types::U256::from_big_endian(&log.data.0[0..32])
                    } else {
                        return Ok(());
                    };
                    Self::update_auction_parameter_static(database, parameter_bytes, value).await?;
                }
            }
            "AuctionStarted" => {
                if log.topics.len() >= 4 {
                    let auction_id = web3::types::U256::from_big_endian(&log.topics[1].as_bytes());
                    let token_id = web3::types::U256::from_big_endian(&log.topics[2].as_bytes());

                    if log.data.0.len() >= 128 {
                        let starting_price = web3::types::U256::from_big_endian(&log.data.0[0..32]);
                        let underlying_amount = web3::types::U256::from_big_endian(&log.data.0[32..64]);
                        let original_owner = Address::from_slice(&log.data.0[76..96]);
                        let reward_amount = web3::types::U256::from_big_endian(&log.data.0[96..128]);
                        let triggerer = Address::from_slice(&log.topics[3].as_bytes()[12..32]);

                        let auction_info = AuctionInfo {
                            auction_id,
                            starting_price,
                            underlying_amount,
                            original_owner,
                            token_id,
                            triggerer: triggerer.clone(),
                            reward_amount,
                            start_time: current_timestamp(),
                        };

                        database.store_auction(&auction_info)?;
                        tracing::trace!("同步历史事件：AuctionManager: 新拍卖开始 - ID: {}", auction_id);
                    }
                }
            }
            "AuctionReset" => {
                if log.topics.len() >= 4 {
                    let auction_id = web3::types::U256::from_big_endian(&log.topics[1].as_bytes());

                    if log.data.0.len() >= 32 {
                        let new_starting_price = web3::types::U256::from_big_endian(&log.data.0[0..32]);

                        if let Ok(Some(mut auction_info)) = database.get_auction(auction_id) {
                            auction_info.starting_price = new_starting_price;
                            auction_info.start_time = current_timestamp();
                            database.store_auction(&auction_info)?;
                        }
                    }
                }
            }
            "AuctionRemoved" => {
                if log.topics.len() >= 2 {
                    let auction_id = web3::types::U256::from_big_endian(&log.topics[1].as_bytes());
                    database.delete_auction(auction_id)?;
                    tracing::trace!("同步历史事件：拍卖 {} 已结束/取消", auction_id);
                }
            }
            _ => {}
        }
        Ok(())
    }

    async fn process_custodian_event_static(
        database: &Arc<Database>,
        event_name: &str,
        log: &web3::types::Log,
    ) -> anyhow::Result<()> {
        match event_name {
            "Mint" => {
                if log.topics.len() >= 2 {
                    let user = Address::from_slice(&log.topics[1].as_bytes()[12..32]);

                    if log.data.0.len() >= 161 {
                        let token_id = web3::types::U256::from_big_endian(&log.data.0[0..32]);
                        let leverage_value = log.data.0[64];
                        let mint_price = web3::types::U256::from_big_endian(&log.data.0[65..97]);
                        let l_amount = web3::types::U256::from_big_endian(&log.data.0[129..161]);

                        let leverage = LeverageType::from_u8(leverage_value)?;

                        let existing_position = database.get_user_position(user, token_id)?;

                        match existing_position {
                            Some(mut position) => {
                                position.mint_price = mint_price;
                                position.leverage = leverage.clone();
                                database.store_user_position(&position)?;
                            }
                            None => {
                                let new_position = UserPosition {
                                    user,
                                    token_id,
                                    amount: l_amount,
                                    timestamp: current_timestamp(),
                                    total_interest: web3::types::U256::zero(),
                                    leverage: leverage.clone(),
                                    mint_price,
                                };
                                database.store_user_position(&new_position)?;
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }

    async fn update_liquidation_parameter_static(
        database: &Arc<Database>,
        parameter_bytes: &[u8],
        value: web3::types::U256,
    ) -> anyhow::Result<()> {
        if parameter_bytes.len() != 32 {
            return Ok(());
        }

        let end_pos = parameter_bytes.iter().position(|&b| b == 0 || b == b' ').unwrap_or(32);
        let parameter_slice = &parameter_bytes[0..end_pos];
        let parameter_str = String::from_utf8_lossy(parameter_slice);
        let parameter_name = parameter_str.trim();

        match parameter_name {
            "adjustmentThreshold" => {
                database.update_adjustment_threshold(value)?;
            }
            "liquidationThreshold" => {
                database.update_liquidation_threshold(value)?;
            }
            "penalty" => {
                database.update_penalty(value)?;
            }
            _ => {}
        }

        Ok(())
    }

    async fn update_auction_parameter_static(
        database: &Arc<Database>,
        parameter_bytes: &[u8],
        value: web3::types::U256,
    ) -> anyhow::Result<()> {
        if parameter_bytes.len() != 32 {
            return Ok(());
        }

        let end_pos = parameter_bytes.iter().position(|&b| b == 0 || b == b' ').unwrap_or(32);
        let parameter_slice = &parameter_bytes[0..end_pos];
        let parameter_str = String::from_utf8_lossy(parameter_slice);
        let parameter_name = parameter_str.trim();

        match parameter_name {
            "priceMultiplier" => database.update_price_multiplier(value)?,
            "resetTime" => database.update_reset_time(value)?,
            "minAuctionAmount" => database.update_min_auction_amount(value)?,
            "priceDropThreshold" => database.update_price_drop_threshold(value)?,
            "percentageReward" => database.update_percentage_reward(value)?,
            "fixedReward" => database.update_fixed_reward(value)?,
            _ => {}
        }

        Ok(())
    }

    fn contract_matches_static(contract_address: &web3::types::Address, config_address: &str) -> bool {
        if let Ok(parsed_address) = config_address.parse::<web3::types::Address>() {
            contract_address == &parsed_address
        } else {
            false
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
                self.config.contracts.custodian.parse()?, // 添加CustodianFixed地址
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
                    } else if self.contract_matches(&log.address, &self.config.contracts.custodian) {
                        // 处理CustodianFixed事件
                        if let Err(e) = self.process_custodian_event_from_log(&log).await {
                            tracing::error!("处理CustodianFixed事件失败: {}", e);
                        }
                    }

                    // 标记为已处理
                    self.processed_events.insert(event_id);
                    processed_count += 1;
                }

                if processed_count > 0 {
                    tracing::info!("处理了区块 {} 的事件数量: {}", block_number, processed_count);
                }

                // 实时监听模式下，处理完区块后更新最后同步区块号
                if processed_count > 0 || block_number > 0 {
                    self.database.set_last_synced_block(block_number)?;
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
        } else if event_signature == self.event_signatures["NetValueAdjusted"] {
            "NetValueAdjusted"
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

    async fn process_custodian_event_from_log(&self, log: &web3::types::Log) -> anyhow::Result<()> {
        if log.topics.is_empty() {
            return Ok(());
        }

        let event_signature = H256::from_slice(&log.topics[0].as_bytes());
        let event_name = if event_signature == self.event_signatures["Mint"] {
            "Mint"
        } else {
            "Unknown"
        };

        self.process_custodian_event(event_name, log).await
    }

    /// 生产级事件缓存清理策略
    ///
    /// 采用多层次的智能清理策略，结合：
    /// - 内存阈值控制：防止内存溢出
    /// - 时间窗口策略：优先清理过期事件
    /// - 自适应批次清理：分阶段渐进式清理
    /// - 重要事件保护：确保最近事件不被过度清理
    /// - 性能监控：详细的清理统计和耗时追踪
    fn cleanup_processed_events_cache(&mut self) {
        let cleanup_start = std::time::Instant::now();
        let initial_size = self.processed_events.len();

        // === 第一阶段：快速健康检查 ===
        // 获取配置参数（生产环境中应该从配置加载）
        const MAX_CACHE_SIZE: usize = 5000;      // 硬性内存限制，超过必须清理
        const SOFT_CACHE_SIZE: usize = 3500;     // 软性阈值，开始轻量级清理
        const TARGET_CACHE_SIZE: usize = 2000;   // 理想缓存大小
        const MIN_RETAIN_SIZE: usize = 500;      // 最少保留的事件数，防过度清理
        const CLEANUP_TIME_WINDOW: u64 = 300;    // 5分钟时间窗口

        // 如果缓存大小正常，跳过清理
        if initial_size <= SOFT_CACHE_SIZE {
            return;
        }

        // 决定清理紧急程度
        let cleanup_urgency = if initial_size >= MAX_CACHE_SIZE {
            CleanupUrgency::Critical     // 必须清理，系统压力大
        } else if initial_size >= SOFT_CACHE_SIZE {
            CleanupUrgency::Moderate     // 适度清理，预防性
        } else {
            CleanupUrgency::Light         // 轻度清理，维护性
        };

        tracing::debug!(
            "启动事件缓存清理 - 大小: {}, 紧急程度: {:?}",
            initial_size, cleanup_urgency
        );

        // === 第二阶段：收集事件元数据 ===
        let current_timestamp = current_timestamp();
        let cleanup_deadline = current_timestamp.saturating_sub(CLEANUP_TIME_WINDOW);

        // 预分配合理的容量，避免频繁重分配
        let estimated_capacity = initial_size;
        let mut event_metadata = Vec::with_capacity(estimated_capacity);
        let mut block_timestamp_cache = HashMap::with_capacity(initial_size / 4); // 区块倾向于连续

        // 为每个事件收集元数据
        for event_id in &self.processed_events {
            let block_num = event_id.block_number;
            let estimated_ts = self.get_or_cache_block_timestamp(block_num, &mut block_timestamp_cache);
            let is_hot = estimated_ts >= cleanup_deadline;

            event_metadata.push(EventMetadata {
                event_id: event_id.clone(),
                timestamp: estimated_ts,
                is_hot,
                priority: self.calculate_event_priority(event_id),
            });
        }

        // === 第三阶段：智能事件评分排序 ===
        // 按清理优先级排序：先清理低优先级的过期事件
        event_metadata.sort_by(|a, b| {
            match (a.is_hot, b.is_hot) {
                (true, false) => std::cmp::Ordering::Greater,  // 热点事件优先保留
                (false, true) => std::cmp::Ordering::Less,     // 过期事件后处理
                _ => match a.priority.cmp(&b.priority) {
                    std::cmp::Ordering::Equal => a.timestamp.cmp(&b.timestamp), // 同优先级按时间排序
                    ordering => ordering,
                }
            }
        });

        // === 第四阶段：分层清理策略 ===
        let mut events_to_remove = Vec::new();
        let mut retained_events = HashSet::new();

        // 根据清理紧急程度采用不同策略
        match cleanup_urgency {
            CleanupUrgency::Critical => {
                // 紧急清理：快速达到安全阈值
                self.aggressive_cleanup(&event_metadata, &mut events_to_remove, &mut retained_events);
            }
            CleanupUrgency::Moderate => {
                // 适度清理：平衡性能和内存
                self.balanced_cleanup(&event_metadata, &mut events_to_remove, &mut retained_events);
            }
            CleanupUrgency::Light => {
                // 轻度清理：最小化影响，保留近期事件
                self.conservative_cleanup(&event_metadata, &mut events_to_remove, &mut retained_events);
            }
        }

        // === 第五阶段：后处理验证 ===
        // 确保清理后的状态满足基本要求
        self.post_cleanup_validation(&mut events_to_remove, &mut retained_events, MIN_RETAIN_SIZE);

        // === 第六阶段：执行清理 ===
        let remove_count = events_to_remove.len();
        for event_id in &events_to_remove {
            self.processed_events.remove(event_id);
        }

        // === 第七阶段：统计和监控 ===
        let final_size = self.processed_events.len();
        let cleanup_duration = cleanup_start.elapsed();
        let cleanup_efficiency = if initial_size > 0 {
            (remove_count as f64 / initial_size as f64) * 100.0
        } else { 0.0 };

        // 输出详细的清理报告
        tracing::info!(
            "事件缓存清理完成 - 大小: {}=>{}(减少{}), 效率: {:.1}%, 用时: {:.2}ms",
            initial_size, final_size, remove_count, cleanup_efficiency, cleanup_duration.as_millis()
        );

        // 额外监控指标
        if final_size >= MAX_CACHE_SIZE {
            tracing::error!(
                "缓存大小仍超出限制 - 当前: {}, 可能存在清理策略问题",
                final_size
            );
        } else if final_size <= MIN_RETAIN_SIZE && initial_size > MIN_RETAIN_SIZE {
            tracing::warn!(
                "事件缓存过小 - 当前: {}, 可能影响事件去重效果",
                final_size
            );
        }

        // 验证清理后的缓存完整性
        debug_assert!(final_size <= MAX_CACHE_SIZE, "清理后缓存大小应在安全范围内");
        debug_assert!(final_size >= MIN_RETAIN_SIZE || final_size == 0,
                     "保留的事件数应该足够或者缓存为空");
    }

    ///  计算事件的清理优先级
    /// 负数=优先保留，正数=优先清理，0=中性
    fn calculate_event_priority(&self, event_id: &EventId) -> i8 {
        // 简单的优先级策略：区块号越大越新，越应该保留
        // 生产环境中可以根据事件类型、合约重要性等因素调整

        // 基础优先级：较新的事件获得保留优先级
        if event_id.block_number > 20_000_000 {
            // 较新的主网区块，优先保留
            -1
        } else {
            // 较旧的区块，可以考虑清理
            1
        }
    }

    /// 获取或缓存区块时间戳
    fn get_or_cache_block_timestamp(&self, block_number: u64, cache: &mut HashMap<u64, u64>) -> u64 {
        if let Some(&cached) = cache.get(&block_number) {
            cached
        } else {
            let estimated = self.estimate_block_timestamp(block_number);
            cache.insert(block_number, estimated);
            estimated
        }
    }

    /// 紧急清理策略：快速达到安全阈值
    fn aggressive_cleanup(&self, metadata: &[EventMetadata], to_remove: &mut Vec<EventId>, retained: &mut HashSet<EventId>) {
        let mut remove_count = 0;

        // 第一轮：清理所有过期事件
        for meta in metadata {
            if meta.timestamp < current_timestamp().saturating_sub(300) { // 5分钟前
                to_remove.push(meta.event_id.clone());
                remove_count += 1;
            } else {
                retained.insert(meta.event_id.clone());
                if retained.len() >= 1000 { // 至少保留1000个最近事件
                    break;
                }
            }
        }

        // 如果还没达到安全阈值，继续清理
        if self.processed_events.len() - remove_count > 2500 {
            // 继续清理直到达到安全大小
            for meta in metadata.iter().rev() { // 从最老的开始清理
                if !retained.contains(&meta.event_id) {
                    to_remove.push(meta.event_id.clone());
                    remove_count += 1;
                    if self.processed_events.len() - remove_count <= 2000 {
                        break;
                    }
                }
            }
        }
    }

    /// 平衡清理策略：考虑时间窗口和事件优先级
    fn balanced_cleanup(&self, metadata: &[EventMetadata], to_remove: &mut Vec<EventId>, retained: &mut HashSet<EventId>) {
        let mut target_removals = self.processed_events.len().saturating_sub(2000).saturating_sub(500);

        // 优先清理低优先级的过期事件
        for meta in metadata.iter().rev() { // 从最旧的开始遍历
            if target_removals == 0 {
                break;
            }

            if meta.priority > 0 && !meta.is_hot { // 低优先级且过期
                to_remove.push(meta.event_id.clone());
                target_removals -= 1;
            } else {
                retained.insert(meta.event_id.clone());
            }
        }
    }

    /// 保守清理策略：仅清理明显过期且低价值的事件
    fn conservative_cleanup(&self, metadata: &[EventMetadata], to_remove: &mut Vec<EventId>, retained: &mut HashSet<EventId>) {
        // 只清理明显过期且低优先级的事件
        for meta in metadata.iter().rev() {
            if meta.priority > 1 && meta.timestamp < current_timestamp().saturating_sub(600) { // 10分钟前
                to_remove.push(meta.event_id.clone());
            } else {
                retained.insert(meta.event_id.clone());
            }
        }
    }

    /// 清理后验证和修正
    fn post_cleanup_validation(&self, to_remove: &mut Vec<EventId>, retained: &mut HashSet<EventId>, min_retain: usize) {
        // 确保至少保留最小数量的事件
        if retained.len() < min_retain && !self.processed_events.is_empty() {
            // 如果保留的事件太少，从删除列表中恢复一些
            let need_recover = min_retain.saturating_sub(retained.len());

            // 从删除列表末尾恢复最近的几条（模拟栈的行为）
            for i in (0..need_recover.min(to_remove.len())).rev() {
                retained.insert(to_remove.swap_remove(i));
                // 成功恢复了一条事件
            }
        }
    }

    /// 根据区块号获取区块时间戳（生产级实现）
    /// 优先从数据库缓存获取，如果没有则从RPC获取并缓存
    async fn get_block_timestamp(&self, block_number: u64) -> u64 {
        // 首先尝试从数据库缓存获取
        if let Ok(Some(cached_timestamp)) = self.database.get_block_timestamp(block_number) {
            return cached_timestamp;
        }

        // 缓存未命中，从RPC获取
        if let Some(web3) = &self.web3_http {
            // 尝试获取区块信息
            match web3.eth().block(web3::types::BlockId::Number(web3::types::BlockNumber::Number(U64::from(block_number)))).await {
                Ok(Some(block)) => {
                    let timestamp_u64 = block.timestamp.as_u64();
                    // 缓存到数据库
                    if let Err(e) = self.database.cache_block_timestamp(block_number, timestamp_u64) {
                        tracing::warn!("缓存区块时间戳失败: 区块={}, 时间戳={}, 错误={}", block_number, timestamp_u64, e);
                    }
                    tracing::debug!("从RPC获取并缓存区块时间戳: 区块={}, 时间戳={}", block_number, timestamp_u64);
                    return timestamp_u64;
                }
                Ok(None) => {
                    tracing::warn!("区块 {} 不存在（可能超出当前链高度）", block_number);
                }
                Err(e) => {
                    tracing::warn!("从RPC获取区块 {} 时间戳失败，将使用估算值: {}", block_number, e);
                }
            }
        }

        // RPC获取失败，使用估算算法作为fallback
        let estimated = self.estimate_block_timestamp_fallback(block_number);
        tracing::debug!("使用估算值作为区块时间戳fallback: 区块={}, 时间戳={}", block_number, estimated);
        estimated
    }

    /// 根据区块号估算区块时间戳（fallback算法）
    /// 当RPC不可用时使用，用于确保服务连续性
    fn estimate_block_timestamp_fallback(&self, block_number: u64) -> u64 {
        // 简化的估算实现：基于已知的以太坊出块规律（约12秒一个区块）
        // 这些基准值应该是定期更新的，不应该是hardcoded

        // 基准点：使用一个相对较新的区块作为基准
        // 注意：这些值在生产环境中应该根据当前链状态定期更新
        const BASE_BLOCK: u64 = 18_000_000;
        const BASE_TIMESTAMP: u64 = 1_670_534_400; // 2022-12-15 00:00:00 UTC（已校准的基准值）
        const BLOCKS_PER_SECOND: f64 = 1.0 / 12.0; // 以太坊平均出块时间

        if block_number >= BASE_BLOCK {
            let blocks_diff = block_number - BASE_BLOCK;
            BASE_TIMESTAMP + (blocks_diff as f64 / BLOCKS_PER_SECOND) as u64
        } else {
            let blocks_diff = BASE_BLOCK - block_number;
            BASE_TIMESTAMP.saturating_sub((blocks_diff as f64 / BLOCKS_PER_SECOND) as u64)
        }
    }

    /// 同步版本的区块时间戳获取（用于事件缓存清理）
    /// 这个方法主要用于不需要async的方法中，如缓存清理时的优先级计算
    fn estimate_block_timestamp(&self, block_number: u64) -> u64 {
        // 首先尝试从缓存获取
        if let Ok(Some(cached_timestamp)) = self.database.get_block_timestamp(block_number) {
            return cached_timestamp;
        }

        // 缓存不可用，使用估算fallback
        self.estimate_block_timestamp_fallback(block_number)
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
            ("PositionIncreased", "PositionIncreased(address,uint256,uint256,uint256,uint256,uint8)"),
            ("PositionOpened", "PositionOpened(address,uint256,uint256,uint256,uint8)"),
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
            ("NetValueAdjusted", "NetValueAdjusted(address,uint256,uint256,uint8,uint256,uint256,uint256)"),
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

                    // 从 log.data 中解析非 indexed 参数: 3个uint256 = 96字节
                    if log.data.0.len() >= 96 { // 3*32 = 96字节
                        let _amount = web3::types::U256::from_big_endian(&log.data.0[0..32]); // 增加的量，不需要
                        let total_amount = web3::types::U256::from_big_endian(&log.data.0[32..64]); // 最新的总持仓量
                        let total_interest = web3::types::U256::from_big_endian(&log.data.0[64..96]); // 当前的累计利息

                        // 获取或创建持仓记录 - PositionIncreased可能会早于Mint事件被监测到
                        let position = match self.database.get_user_position(user, token_id) {
                            Ok(Some(mut existing)) => {
                                // 更新现有持仓：最新的总数量、累计利息和更新时间戳
                                existing.amount = total_amount;
                                existing.total_interest = total_interest;
                                existing.timestamp = current_timestamp();
                                existing
                            },
                            _ => {
                                // 如果没有现存记录，创建新记录，杠杆比例和mintPrice都设为0
                                // PositionIncreased可能会早于Mint或NetValueAdjusted事件被监测到
                                tracing::info!("PositionIncreased: 创建新的持仓记录，杠杆和铸币价格设为0 - 用户: {:?}, TokenID: {}", user, token_id);
                                UserPosition {
                                    user,
                                    token_id,
                                    amount: total_amount,
                                    timestamp: current_timestamp(),
                                    total_interest,
                                    leverage: LeverageType::Conservative, // 杠杆设置为默认Conservative
                                    mint_price: web3::types::U256::zero(), // 铸币价格设为0
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
            "NetValueAdjusted" => {
                // NetValueAdjusted(address indexed user, uint256 indexed fromTokenId, uint256 indexed toTokenId,
                //                  LeverageType leverage, uint256 newMintPrice, uint256 adjustAmountInWei, uint256 underlyingAmountInWei)

                if log.topics.len() >= 4 {
                    // 解析 indexed 参数
                    let user = Address::from_slice(&log.topics[1].as_bytes()[12..32]); // indexed address
                    let _from_token_id = web3::types::U256::from_big_endian(&log.topics[2].as_bytes()); // indexed fromTokenId
                    let to_token_id = web3::types::U256::from_big_endian(&log.topics[3].as_bytes()); // indexed toTokenId

                    // 从 log.data 中解析非 indexed 参数: 4个参数（uint8 + 3个uint256） = 1 + 96 = 97字节
                    if log.data.0.len() >= 97 { // 1*uint8 + 3*uint256 = 97字节
                        let leverage_value = log.data.0[0]; // uint8 LeverageType
                        let new_mint_price = web3::types::U256::from_big_endian(&log.data.0[1..33]); // 从1开始的32字节
                        let adjust_amount_in_wei = web3::types::U256::from_big_endian(&log.data.0[33..65]); // adjustAmountInWei
                        let _underlying_amount_in_wei = web3::types::U256::from_big_endian(&log.data.0[65..97]); // 未使用

                        let leverage = LeverageType::from_u8(leverage_value)?;

                        // 检查database中有没有该user对于toTokenId的记录
                        let existing_position = self.database.get_user_position(user, to_token_id)?;

                        match existing_position {
                            Some(mut position) => {
                                // 如果有该记录，只需要更新杠杆比例和铸币价格
                                position.leverage = leverage.clone();
                                position.mint_price = new_mint_price;
                                self.database.store_user_position(&position)?;
                                tracing::info!("LiquidationManager: NetValueAdjusted - 更新现有持仓杠杆和铸币价格 - 用户: {:?}, 到TokenID: {}, 杠杆: {:?}, 新铸币价格: {}",
                                             user, to_token_id, leverage, new_mint_price);
                            }
                            None => {
                                // 如果没有记录，创建新记录：杠杆比例为leverage，铸币价格为newMintPrice，持仓数量为adjustAmountInWei
                                let new_position = UserPosition {
                                    user,
                                    token_id: to_token_id,
                                    amount: adjust_amount_in_wei, // 使用adjustAmountInWei作为持仓数量
                                    timestamp: current_timestamp(),
                                    total_interest: web3::types::U256::zero(),
                                    leverage: leverage.clone(),
                                    mint_price: new_mint_price,
                                };
                                self.database.store_user_position(&new_position)?;
                                tracing::info!("LiquidationManager: NetValueAdjusted - 创建新持仓记录 - 用户: {:?}, 到TokenID: {}, 杠杆: {:?}, 铸币价格: {}, 持仓数量: {}",
                                             user, to_token_id, leverage, new_mint_price, adjust_amount_in_wei);
                            }
                        }
                    } else {
                        tracing::warn!("NetValueAdjusted event data too short, got {} bytes (expected 97)", log.data.0.len());
                    }
                } else {
                    tracing::warn!("NetValueAdjusted event has insufficient topics: {}", log.topics.len());
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
                        };

                        // 存储到数据库
                        self.database.store_auction(&auction_info)?;

                        tracing::info!(
                            "AuctionManager: 新拍卖开始 - ID: {}, 起始价格: {}, 标的总量: {}, 原始持有者: {:?}, 触发者: {:?}",
                            auction_id, starting_price, underlying_amount, original_owner, triggerer
                        );

                        // 为新拍卖设置自动重置定时器
                        match self.auction_reset_monitor.schedule_auction_reset(auction_id, starting_price).await {
                            Ok(()) => {
                                tracing::debug!("AuctionManager: 拍卖 {} 重置定时器设置成功", auction_id);
                            }
                            Err(e) => {
                                tracing::error!("AuctionManager: 拍卖 {} 重置定时器设置失败: {}", auction_id, e);
                            }
                        }
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

                        // 重置后的拍卖需要重新设置重置定时器，因为它还是活跃的拍卖
                        match self.auction_reset_monitor.schedule_auction_reset(auction_id, new_starting_price).await {
                            Ok(()) => {
                                tracing::debug!("AuctionManager: 重置后的拍卖 {} 重置定时器设置成功", auction_id);
                            }
                            Err(e) => {
                                tracing::error!("AuctionManager: 重置后的拍卖 {} 重置定时器设置失败: {}", auction_id, e);
                            }
                        }
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

                    // 首先取消对应的重置定时器
                    self.auction_reset_monitor.cancel_auction_reset(&auction_id);

                    // 然后删除数据库中的拍卖记录
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
            _unrecognized => {
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
            _unrecognized => {
                // 根据 Solidity 代码，这应该会 revert，但是我们记录警告
                tracing::warn!("AuctionManager: 未识别的参数名 '{}' (bytes: {:?})", parameter_name, parameter_bytes);
                return Ok(()); // 不中断处理
            }
        }

        Ok(())
    }

    async fn process_custodian_event(&self, event_name: &str, log: &web3::types::Log) -> anyhow::Result<()> {
        match event_name {
            "Mint" => {
                // Mint(address indexed user, uint256 tokenId, uint256 underlyingAmountInWei, LeverageType leverageLevel, uint256 mintPriceInWei, uint256 sAmountInWei, uint256 lAmountInWei)

                if log.topics.len() >= 2 {
                    // 解析 indexed 参数
                    let user = Address::from_slice(&log.topics[1].as_bytes()[12..32]); // indexed address

                    // 从 log.data 中解析非 indexed 参数: 6个参数（uint256*5 + uint8*1） = 160 + 1 = 161字节
                    if log.data.0.len() >= 161 { // 5*32 + 1 = 161字节
                        let token_id = web3::types::U256::from_big_endian(&log.data.0[0..32]);
                        let _underlying_amount = web3::types::U256::from_big_endian(&log.data.0[32..64]); // 未使用
                        let leverage_value = log.data.0[64]; // uint8 LeverageType
                        let mint_price = web3::types::U256::from_big_endian(&log.data.0[65..97]); // 从65开始的32字节
                        let _s_amount = web3::types::U256::from_big_endian(&log.data.0[97..129]); // 未使用
                        let l_amount = web3::types::U256::from_big_endian(&log.data.0[129..161]); // 使用

                        let leverage = LeverageType::from_u8(leverage_value)?;

                        // 检查数据库中是否已有此用户此tokenID的持仓记录
                        let existing_position = self.database.get_user_position(user, token_id)?;

                        match existing_position {
                            Some(mut position) => {
                                // 如果数据库中已有记录，只更新mintPrice和杠杆比例
                                position.mint_price = mint_price;
                                position.leverage = leverage.clone();
                                self.database.store_user_position(&position)?;
                                tracing::info!("CustodianFixed: 更新现有持仓杠杆和铸币价格 - 用户: {:?}, TokenID: {}, 杠杆: {:?}, 铸币价格: {}",
                                             user, token_id, leverage, mint_price);
                            }
                            None => {
                                // 如果数据库中没有记录，使用l_amount作为初始持仓量
                                let new_position = UserPosition {
                                    user,
                                    token_id,
                                    amount: l_amount, // 使用l_amount作为初始持仓量
                                    timestamp: current_timestamp(),
                                    total_interest: web3::types::U256::zero(),
                                    leverage: leverage.clone(),
                                    mint_price,
                                };
                                self.database.store_user_position(&new_position)?;
                                tracing::info!("CustodianFixed: 创建新持仓记录 - 用户: {:?}, TokenID: {}, 杠杆: {:?}, 铸币价格: {}, 初始持仓量: {}",
                                             user, token_id, leverage, mint_price, l_amount);
                            }
                        }
                    } else {
                        tracing::warn!("Mint event data too short, got {} bytes (expected 161)", log.data.0.len());
                    }
                } else {
                    tracing::warn!("Mint event has insufficient topics: {}", log.topics.len());
                }
            }
            _ => {
                tracing::debug!("Unknown custodian event: {}", event_name);
            }
        }
        Ok(())
    }
}
