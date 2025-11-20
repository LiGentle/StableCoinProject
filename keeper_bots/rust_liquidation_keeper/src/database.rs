//! 数据库模块
//!
//! 使用 RocksDB 存储系统参数、用户持仓、NAV数据和auction信息。

use rocksdb::{DB, Options};
use web3::types::{Address, U256};
use serde::{Deserialize, Serialize};

/// 杠杆类型枚举 - 对应 Solidity 的 LeverageType
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LeverageType {
    Conservative,  // 保守型 (1S8L)
    Moderate,      // 温和型 (1S4L)
    Aggressive,    // 激进型 (1S1L)
}

impl LeverageType {
    /// 从uint8值转换为LeverageType枚举
    pub fn from_u8(value: u8) -> anyhow::Result<Self> {
        match value {
            0 => Ok(LeverageType::Conservative),
            1 => Ok(LeverageType::Moderate),
            2 => Ok(LeverageType::Aggressive),
            _ => Err(anyhow::anyhow!("Invalid leverage type value: {}", value)),
        }
    }
}

/// 拍卖信息结构体 - 存储在数据库中
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuctionInfo {
    pub auction_id: U256,
    pub starting_price: U256,
    pub underlying_amount: U256,
    pub original_owner: Address,
    pub token_id: U256,
    pub triggerer: Address,
    pub reward_amount: U256,
    pub start_time: u64,      // 拍卖开始时间戳
}

/// 用户持仓信息结构体
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPosition {
    pub user: Address,
    pub token_id: U256,
    pub amount: U256,           // 总持仓数量
    pub timestamp: u64,         // 最后更新时间戳
    pub total_interest: U256,   // 累计利息
    pub leverage: LeverageType, // 杠杆类型
    pub mint_price: U256,       // 铸币价格
}



/// 数据库连接
pub struct Database {
    db: DB,
}

/// 系统参数结构体
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SystemParams {
    // 清算相关参数
    pub liquidation_threshold: U256,     // 强制清算阈值
    pub adjustment_threshold: U256,      // 净值调整阈值
    pub penalty: U256,                   // 清算惩罚金

    // Auction相关参数
    pub price_multiplier: U256,
    pub reset_time: U256,
    pub price_drop_threshold: U256,
    pub percentage_reward: U256,
    pub fixed_reward: U256,
    pub min_auction_amount: U256,

    // 利息相关参数
    pub annual_interest_rate: U256,
}

impl Default for SystemParams {
    fn default() -> Self {
        Self {
            // 清算相关参数 (来自LiquidationManager)
            liquidation_threshold: U256::from(300000000000000000u64), // 0.3 (30%)
            adjustment_threshold: U256::from(500000000000000000u64), // 0.5 (50%)
            penalty: U256::from(3000000000000000u64), // 0.03 (3%)

            // Auction相关参数
            price_multiplier: U256::from(1000u64),      // 示例值
            reset_time: U256::from(3600u64),             // 1小时
            price_drop_threshold: U256::from(500u64),    // 示例值
            percentage_reward: U256::from(100u64),       // 1%
            fixed_reward: U256::from(1000000000000000000u64), // 1e18
            min_auction_amount: U256::from(1000000000000000000u64), // 1e18

            // 利息相关参数
            annual_interest_rate: U256::from(300u64),    // 3%
        }
    }
}

impl Database {
    pub async fn new() -> anyhow::Result<Self> {
        let mut opts = Options::default();
        opts.create_if_missing(true);

        // 设置数据库打开选项
        opts.set_max_open_files(512);

        let db_path = "keeper_data";
        let db = DB::open(&opts, db_path)?;

        tracing::info!("数据库初始化成功: {}", db_path);

        Ok(Self { db })
    }

    pub async fn close(self) -> anyhow::Result<()> {
        // RocksDB 会自动处理关闭，这里主要是为了API一致性
        drop(self.db);
        tracing::info!("数据库连接关闭");
        Ok(())
    }

    /// 获取系统参数
    pub fn get_system_params(&self) -> anyhow::Result<SystemParams> {
        let key = b"system_params";

        match self.db.get(key)? {
            Some(data) => {
                let params: SystemParams = serde_json::from_slice(&data)?;
                Ok(params)
            }
            None => {
                // 返回默认值，并存储到数据库
                let default_params = SystemParams::default();
                self.set_system_params(&default_params)?;
                Ok(default_params)
            }
        }
    }

    /// 设置系统参数
    pub fn set_system_params(&self, params: &SystemParams) -> anyhow::Result<()> {
        let key = b"system_params";
        let data = serde_json::to_vec(params)?;
        self.db.put(key, data)?;
        tracing::info!("系统参数已更新: {:?}", params);
        Ok(())
    }

    /// 更新单个系统参数
    pub fn update_adjustment_threshold(&self, threshold: U256) -> anyhow::Result<()> {
        let mut params = self.get_system_params()?;
        params.adjustment_threshold = threshold;
        self.set_system_params(&params)
    }

    pub fn update_liquidation_threshold(&self, threshold: U256) -> anyhow::Result<()> {
        let mut params = self.get_system_params()?;
        params.liquidation_threshold = threshold;
        self.set_system_params(&params)
    }

    pub fn update_penalty(&self, penalty: U256) -> anyhow::Result<()> {
        let mut params = self.get_system_params()?;
        params.penalty = penalty;
        self.set_system_params(&params)
    }

    // Auction 参数更新方法
    pub fn update_price_multiplier(&self, multiplier: U256) -> anyhow::Result<()> {
        let mut params = self.get_system_params()?;
        params.price_multiplier = multiplier;
        self.set_system_params(&params)
    }

    pub fn update_reset_time(&self, reset_time: U256) -> anyhow::Result<()> {
        let mut params = self.get_system_params()?;
        params.reset_time = reset_time;
        self.set_system_params(&params)
    }

    pub fn update_min_auction_amount(&self, amount: U256) -> anyhow::Result<()> {
        let mut params = self.get_system_params()?;
        params.min_auction_amount = amount;
        self.set_system_params(&params)
    }

    pub fn update_price_drop_threshold(&self, threshold: U256) -> anyhow::Result<()> {
        let mut params = self.get_system_params()?;
        params.price_drop_threshold = threshold;
        self.set_system_params(&params)
    }

    pub fn update_percentage_reward(&self, reward: U256) -> anyhow::Result<()> {
        let mut params = self.get_system_params()?;
        params.percentage_reward = reward;
        self.set_system_params(&params)
    }

    pub fn update_fixed_reward(&self, reward: U256) -> anyhow::Result<()> {
        let mut params = self.get_system_params()?;
        params.fixed_reward = reward;
        self.set_system_params(&params)
    }

    pub fn update_annual_interest_rate(&self, rate: U256) -> anyhow::Result<()> {
        let mut params = self.get_system_params()?;
        params.annual_interest_rate = rate;
        self.set_system_params(&params)
    }

    /// 获取最后同步的区块号
    pub fn get_last_synced_block(&self) -> anyhow::Result<Option<u64>> {
        let key = b"last_synced_block";

        match self.db.get(key)? {
            Some(data) => {
                let block_number: u64 = serde_json::from_slice(&data)?;
                Ok(Some(block_number))
            }
            None => Ok(None),
        }
    }

    /// 设置最后同步的区块号
    pub fn set_last_synced_block(&self, block_number: u64) -> anyhow::Result<()> {
        let key = b"last_synced_block";
        let data = serde_json::to_vec(&block_number)?;
        self.db.put(key, data)?;
        tracing::debug!("最后同步区块号已更新: {}", block_number);
        Ok(())
    }

    /// 获取区块时间戳（从缓存中获取）
    pub fn get_block_timestamp(&self, block_number: u64) -> anyhow::Result<Option<u64>> {
        let key = format!("block_timestamp_{}", block_number);

        match self.db.get(key.as_bytes())? {
            Some(data) => {
                let timestamp: u64 = serde_json::from_slice(&data)?;
                Ok(Some(timestamp))
            }
            None => Ok(None),
        }
    }

    /// 缓存区块时间戳
    pub fn cache_block_timestamp(&self, block_number: u64, timestamp: u64) -> anyhow::Result<()> {
        let key = format!("block_timestamp_{}", block_number);
        let data = serde_json::to_vec(&timestamp)?;
        self.db.put(key.as_bytes(), data)?;
        tracing::trace!("区块时间戳已缓存: 区块={}, 时间戳={}", block_number, timestamp);
        Ok(())
    }

    /// 批量缓存区块时间戳
    pub fn cache_block_timestamps(&self, timestamps: &[(u64, u64)]) -> anyhow::Result<()> {
        for (block_number, timestamp) in timestamps {
            self.cache_block_timestamp(*block_number, *timestamp)?;
        }
        tracing::debug!("批量缓存了 {} 个区块时间戳", timestamps.len());
        Ok(())
    }

    /// 清理过期的区块时间戳缓存（保留最近的5,000个区块的缓存）
    pub fn cleanup_old_block_timestamps(&self, current_block: u64) -> anyhow::Result<()> {
        let mut to_delete = Vec::new();
        let keep_threshold = current_block.saturating_sub(5000);

        // 收集需要删除的键
        let iter = self.db.iterator(rocksdb::IteratorMode::Start);
        for item in iter {
            let (key, _) = item?;
            let key_str = String::from_utf8(key.to_vec())?;

            if key_str.starts_with("block_timestamp_") {
                if let Some(block_str) = key_str.strip_prefix("block_timestamp_") {
                    if let Ok(block_num) = block_str.parse::<u64>() {
                        if block_num < keep_threshold {
                            to_delete.push(key.to_vec());
                        }
                    }
                }
            }
        }

        // 批量删除
        if !to_delete.is_empty() {
            for key in &to_delete {
                self.db.delete(key)?;
            }
            tracing::debug!("清理了 {} 个过期的区块时间戳缓存", to_delete.len());
        }

        Ok(())
    }

    /// 拍卖相关数据库方法

    /// 存储拍卖信息
    pub fn store_auction(&self, auction: &AuctionInfo) -> anyhow::Result<()> {
        let key = format!("auction_{}", auction.auction_id);
        let data = serde_json::to_vec(auction)?;
        self.db.put(key.as_bytes(), data)?;
        tracing::info!("拍卖已存储: ID={}", auction.auction_id);
        Ok(())
    }

    /// 获取拍卖信息
    pub fn get_auction(&self, auction_id: U256) -> anyhow::Result<Option<AuctionInfo>> {
        let key = format!("auction_{}", auction_id);

        match self.db.get(key.as_bytes())? {
            Some(data) => {
                let auction: AuctionInfo = serde_json::from_slice(&data)?;
                Ok(Some(auction))
            }
            None => Ok(None),
        }
    }



    /// 删除拍卖信息
    pub fn delete_auction(&self, auction_id: U256) -> anyhow::Result<()> {
        let key = format!("auction_{}", auction_id);
        self.db.delete(key.as_bytes())?;
        tracing::info!("拍卖已删除: ID={}", auction_id);
        Ok(())
    }

    /// 获取所有拍卖（通过存在性判断活跃状态）
    pub fn get_all_auctions(&self) -> anyhow::Result<Vec<AuctionInfo>> {
        let mut auctions = Vec::new();

        // 遍历所有auction_开头的记录
        let iter = self.db.iterator(rocksdb::IteratorMode::Start);
        for item in iter {
            let (key, value) = item?;
            let key_str = String::from_utf8(key.to_vec())?;

            if key_str.starts_with("auction_") {
                let auction: AuctionInfo = serde_json::from_slice(&value)?;
                auctions.push(auction);
            }
        }

        Ok(auctions)
    }

    /// 检查拍卖记录是否存在（存在即为活跃）
    pub fn auction_exists(&self, auction_id: U256) -> anyhow::Result<bool> {
        let key = format!("auction_{}", auction_id);
        match self.db.get(key.as_bytes())? {
            Some(_) => Ok(true),
            None => Ok(false),
        }
    }

    /// 用户持仓相关数据库方法

    /// 存储用户持仓信息
    pub fn store_user_position(&self, position: &UserPosition) -> anyhow::Result<()> {
        let key = format!("position_{}_{}", position.user, position.token_id);
        let data = serde_json::to_vec(position)?;
        self.db.put(key.as_bytes(), data)?;
        tracing::info!("用户持仓已记录 - 用户: {:?}, TokenID: {}, 数量: {}", position.user, position.token_id, position.amount);
        Ok(())
    }

    /// 获取用户特定token的持仓
    pub fn get_user_position(&self, user: Address, token_id: U256) -> anyhow::Result<Option<UserPosition>> {
        let key = format!("position_{}_{}", user, token_id);

        match self.db.get(key.as_bytes())? {
            Some(data) => {
                let position: UserPosition = serde_json::from_slice(&data)?;
                Ok(Some(position))
            }
            None => Ok(None),
        }
    }

    /// 获取用户所有持仓信息
    pub fn get_user_positions(&self, user: Address) -> anyhow::Result<Vec<UserPosition>> {
        let mut positions = Vec::new();
        let prefix = format!("position_{}_", user);

        let iter = self.db.iterator(rocksdb::IteratorMode::Start);
        for item in iter {
            let (key, value) = item?;
            let key_str = String::from_utf8(key.to_vec())?;

            if key_str.starts_with(&prefix) {
                let position: UserPosition = serde_json::from_slice(&value)?;
                positions.push(position);
            }
        }

        Ok(positions)
    }

    /// 删除用户持仓信息
    pub fn delete_user_position(&self, user: Address, token_id: U256) -> anyhow::Result<()> {
        let key = format!("position_{}_{}", user, token_id);
        self.db.delete(key.as_bytes())?;
        tracing::info!("用户持仓已删除 - 用户: {:?}, TokenID: {}", user, token_id);
        Ok(())
    }

    /// 获取所有用户的持仓信息
    pub fn get_all_user_positions(&self) -> anyhow::Result<Vec<UserPosition>> {
        let mut positions = Vec::new();

        // 遍历所有以"position_"开头的记录
        let iter = self.db.iterator(rocksdb::IteratorMode::Start);
        for item in iter {
            let (key, value) = item?;
            let key_str = String::from_utf8(key.to_vec())?;

            if key_str.starts_with("position_") {
                let position: UserPosition = serde_json::from_slice(&value)?;
                positions.push(position);
            }
        }

        Ok(positions)
    }
}
