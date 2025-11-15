//! 数据库模块
//!
//! 使用 RocksDB 存储系统参数、用户持仓、NAV数据和auction信息。

use std::path::Path;
use rocksdb::{DB, Options};
use web3::types::U256;

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

    pub fn update_min_auction_amount(&self, amount: U256) -> anyhow::Result<()> {
        let mut params = self.get_system_params()?;
        params.min_auction_amount = amount;
        self.set_system_params(&params)
    }

    pub fn update_annual_interest_rate(&self, rate: U256) -> anyhow::Result<()> {
        let mut params = self.get_system_params()?;
        params.annual_interest_rate = rate;
        self.set_system_params(&params)
    }
}
