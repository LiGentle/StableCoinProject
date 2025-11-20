//! 拍卖重置监控模块
//!
//! 精准监控拍卖生命周期，根据价格计算公式，在拍卖价格降至下界时自动触发重置。
//!
//! ## 核心机制：
//! - 监听新拍卖创建事件
//! - 根据起始价格和价格下界计算重置时刻
//! - 精确定时触发拍卖重置
//! - 如果拍卖提前结束，自动取消重置任务

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use web3::types::{Address, U256};
use web3::ethabi;
use tokio::time::{Duration, Instant};
use crate::database::Database;

/// 拍卖重置任务
#[derive(Debug)]
struct AuctionResetTask {
    auction_id: U256,
    reset_time: Instant,
    _handle_abort: tokio_util::sync::CancellationToken,
}

impl AuctionResetTask {
    fn new(auction_id: U256, reset_time: Instant) -> Self {
        Self {
            auction_id,
            reset_time,
            _handle_abort: tokio_util::sync::CancellationToken::new(),
        }
    }
}

/// 拍卖重置监控器
pub struct AuctionResetMonitor {
    web3: web3::Web3<web3::transports::Http>,
    database: Arc<Database>,
    auction_manager_address: Address,
    pending_resets: Arc<RwLock<HashMap<U256, AuctionResetTask>>>,
}

impl AuctionResetMonitor {
    pub fn new(
        web3: web3::Web3<web3::transports::Http>,
        database: Arc<Database>,
        auction_manager_address: String,
    ) -> anyhow::Result<Self> {
        let auction_manager = auction_manager_address.parse::<Address>()?;

        Ok(Self {
            web3,
            database,
            auction_manager_address: auction_manager,
            pending_resets: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    /// 添加新拍卖的重置任务
    pub async fn schedule_auction_reset(
        &self,
        auction_id: U256,
        starting_price: U256,
        price_drop_threshold: U256,
        reset_time: U256,
    ) -> anyhow::Result<()> {
        // 检查拍卖是否还在活跃状态
        if !self.database.is_auction_active(auction_id)? {
            tracing::debug!("拍卖 {} 已不活跃，跳过重置计划", auction_id);
            return Ok(());
        }

        // 计算达到价格下界所需的时间
        let reset_duration_secs = calculate_reset_duration(
            starting_price,
            price_drop_threshold,
            reset_time
        );

        if reset_duration_secs == 0 {
            tracing::info!("拍卖 {} 已经达到价格下界，需要立即重置", auction_id);
            // 立即执行重置
            if let Err(e) = self.execute_auction_reset(auction_id).await {
                tracing::error!("立即重置拍卖 {} 失败: {}", auction_id, e);
            }
            return Ok(());
        }

        let reset_instant = Instant::now() + Duration::from_secs(reset_duration_secs);

        tracing::info!(
            "为拍卖 {} 计划重置任务 - {} 秒后重置 (起始价格: {}, 阈值: {})",
            auction_id, reset_duration_secs, starting_price, price_drop_threshold
        );

        // 创建重置任务
        let task = AuctionResetTask::new(auction_id, reset_instant);

        // 启动异步任务执行重置
        self.start_reset_task(task);

        Ok(())
    }

    /// 启动重置任务
    fn start_reset_task(&self, task: AuctionResetTask) {
        let auction_id = task.auction_id;
        let reset_time = task.reset_time;
        let web3 = self.web3.clone();
        let database = self.database.clone();
        let auction_manager_address = self.auction_manager_address;

        tokio::spawn(async move {
            let now = Instant::now();
            if now < reset_time {
                tokio::time::sleep_until(reset_time).await;
            }

            // 重置时刻已到，检查拍卖是否还存在
            match database.is_auction_active(auction_id) {
                Ok(true) => {
                    // 拍卖还存在，执行重置
                    tracing::info!("拍卖 {} 重置时刻已到，执行重置", auction_id);

                    let reset_monitor = AuctionResetMonitor {
                        web3,
                        database,
                        auction_manager_address,
                        pending_resets: Arc::new(RwLock::new(HashMap::new())),
                    };

                    if let Err(e) = reset_monitor.execute_auction_reset(auction_id).await {
                        tracing::error!("重置拍卖 {} 失败: {}", auction_id, e);
                    }
                }
                Ok(false) => {
                    // 拍卖已被删除，取消重置
                    tracing::info!("拍卖 {} 在重置前已被删除，无需重置", auction_id);
                }
                Err(e) => {
                    tracing::error!("检查拍卖 {} 状态失败: {}", auction_id, e);
                }
            }
        });
    }

    /// 执行拍卖重置
    async fn execute_auction_reset(&self, auction_id: U256) -> anyhow::Result<()> {
        // 获取Keeper地址
        let keeper_address = web3::types::Address::from_low_u64_be(0x123456789abcdef);

        // 创建resetAuction函数调用数据
        let function_abi = r#"
            {
                "name": "resetAuction",
                "type": "function",
                "stateMutability": "nonpayable",
                "inputs": [
                    {"type": "uint256", "name": "auctionId"},
                    {"type": "address", "name": "triggerer"}
                ],
                "outputs": []
            }
        "#;

        let contract: ethabi::Contract = serde_json::from_str(&format!(r#"[{}]"#, function_abi))?;
        let function = contract.function("resetAuction")?;
        let data = function.encode_input(&[
            ethabi::Token::Uint(auction_id),
            ethabi::Token::Address(keeper_address),
        ])?;

        // 构建交易
        let accounts = self.web3.eth().accounts().await?;
        if accounts.is_empty() {
            return Err(anyhow::anyhow!("No available accounts for transaction"));
        }

        let tx = web3::types::TransactionRequest {
            from: accounts[0],
            to: Some(self.auction_manager_address),
            data: Some(web3::types::Bytes(data)),
            ..Default::default()
        };

        // 发送交易
        let tx_hash = self.web3.eth().send_transaction(tx).await?;
        tracing::info!("拍卖重置交易已发送: {:?}, 拍卖ID: {}", tx_hash, auction_id);

        // 等待交易确认 - 新的auction信息会由events.rs处理
        let receipt = self.web3.eth().transaction_receipt(tx_hash).await?;
        match receipt {
            Some(_) => Ok(()),
            None => Err(anyhow::anyhow!("拍卖重置交易未确认")),
        }
    }

    /// 取消拍卖重置任务（当拍卖被移除时调用）
    pub fn cancel_auction_reset(&self, auction_id: &U256) {
        if let Ok(mut pending_resets) = self.pending_resets.write() {
            if pending_resets.remove(auction_id).is_some() {
                tracing::debug!("取消了拍卖 {} 的重置任务", auction_id);
            }
        }
    }
}

/// 计算从起始价格降至价格下界所需的时间（秒）
/// 基于Linear Decrease公式：price = startingPrice * ((resetTime - duration) / resetTime)
/// 当 price/startingPrice <= price_drop_threshold 时需要重置
///
/// 返回0表示已经达到或超过下界，立即重置
fn calculate_reset_duration(
    starting_price: U256,
    price_drop_threshold: U256,
    max_reset_time: U256,
) -> u64 {
    if starting_price == U256::zero() {
        return 0; // 无效价格，立即重置
    }

    // 计算目标价格下界：starting_price * price_drop_threshold
    // price_drop_threshold通常是一个很小的分数，比如0.5表示50%
    // 这里将其转换为整数计算：threshold = price_drop_threshold / 1e18（假设是18位精度）
    let precision = U256::from(1_000_000_000_000_000_000_u64); // 1e18
    let target_price = starting_price
        .saturating_mul(price_drop_threshold)
        .saturating_div(precision);

    // 如果当前价格已经 <= 目标价格，返回0（立即重置）
    if target_price >= starting_price {
        return 0;
    }

    // 线性递减公式推导：
    // price = startingPrice * ((max_reset_time - duration) / max_reset_time)
    // target_price = startingPrice * ((max_reset_time - duration) / max_reset_time)
    // target_price / startingPrice = (max_reset_time - duration) / max_reset_time
    // max_reset_time - duration = (target_price * max_reset_time) / startingPrice
    // duration = max_reset_time - (target_price * max_reset_time) / startingPrice

    let max_reset_time_u64 = max_reset_time.as_u64();
    let numerator = target_price.saturating_mul(max_reset_time);
    let denominator = starting_price;

    if denominator == U256::zero() {
        return max_reset_time_u64; // 避免除零
    }

    let remaining_time = numerator / denominator;
    let duration = if remaining_time >= max_reset_time {
        0 // 已经达到价格下界
    } else {
        max_reset_time_u64.saturating_sub(remaining_time.as_u64())
    };

    duration
}
