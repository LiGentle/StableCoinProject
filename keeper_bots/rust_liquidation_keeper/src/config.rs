//! 配置模块
//!
//! 负责加载和管理应用的配置。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// RPC节点URL
    pub rpc_url: String,
    /// 私钥（用于签名交易）
    pub private_key: Option<String>,
    /// 清算阈值 (基础点, 例如 8000 = 80%)
    pub liquidation_threshold: u64,
    /// 调整阈值 (基础点)
    pub adjustment_threshold: u64,
    /// NAV重新计算间隔（秒）
    pub nav_recalc_interval: u64,
    /// 清算检查间隔（秒）
    pub liquidation_check_interval: u64,

    /// 合约地址们
    pub contracts: ContractAddresses,

    /// 当前利率 (基础点)
    pub current_interest_rate: u64,
}

/// 合约地址配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContractAddresses {
    pub custodian: String,
    pub liquidation_manager: String,
    pub auction_manager: String,
    pub interest_manager: String,
    pub token: String,
    pub oracle: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            rpc_url: "http://localhost:8545".to_string(),
            private_key: None,
            liquidation_threshold: 8000, // 80%
            adjustment_threshold: 8500,  // 85%
            nav_recalc_interval: 300,     // 5分钟
            liquidation_check_interval: 30, // 30秒
            contracts: ContractAddresses::default(),
            current_interest_rate: 300, // 3%
        }
    }
}

impl Default for ContractAddresses {
    fn default() -> Self {
        Self {
            custodian: "0x0000000000000000000000000000000000000000".to_string(),
            liquidation_manager: "0x0000000000000000000000000000000000000000".to_string(),
            auction_manager: "0x0000000000000000000000000000000000000000".to_string(),
            interest_manager: "0x0000000000000000000000000000000000000000".to_string(),
            token: "0x0000000000000000000000000000000000000000".to_string(),
            oracle: "0x0000000000000000000000000000000000000000".to_string(),
        }
    }
}

/// 加载配置
pub fn load_config() -> anyhow::Result<AppConfig> {
    // 支持多种配置来源：环境变量、配置文件、命令行参数
    // 这里先用默认配置

    let settings = config::Config::builder()
        .add_source(config::File::with_name("config").required(false))
        .add_source(config::Environment::with_prefix("KEEPER"))
        .build()?;

    let config: AppConfig = settings.try_deserialize()?;

    Ok(config)
}
