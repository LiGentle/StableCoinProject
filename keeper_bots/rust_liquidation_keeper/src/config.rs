//! 配置模块
//!
//! 负责加载和管理应用的配置。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// RPC节点URL
    pub rpc_url: String,
    /// WebSocket URL (用于实时监听)
    pub ws_url: Option<String>,
    /// 私钥（用于签名交易）
    pub private_key: Option<String>,
    /// NAV重新计算间隔（秒）
    pub nav_recalc_interval: u64,
    /// 清算检查间隔（秒）
    pub liquidation_check_interval: u64,

    /// 合约地址们
    pub contracts: ContractAddresses,

    /// 事件监控配置
    pub event_monitoring: EventMonitoringConfig,
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
            ws_url: Some("ws://localhost:8546".to_string()), // 默认WebSocket URL
            private_key: None,
            nav_recalc_interval: 300,     // 5分钟
            liquidation_check_interval: 30, // 30秒
            contracts: ContractAddresses::default(),
            event_monitoring: EventMonitoringConfig::default(),
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

/// 事件监控配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventMonitoringConfig {
    /// 事件监听轮询间隔（秒）
    pub polling_interval_secs: u64,
    /// 每次请求获取的最大日志数量
    pub max_logs_per_request: usize,
    /// 批处理大小
    pub batch_size: usize,
    /// 冷启动时回溯的区块数量（0代表只从最新区块开始，不同步历史）
    pub cold_start_backtrace_blocks: u64,
}

impl Default for EventMonitoringConfig {
    fn default() -> Self {
        Self {
            polling_interval_secs: 10,     // 20秒轮询间隔（降低频率）
            max_logs_per_request: 1000,     // 每次最多获取1000条日志
            batch_size: 50,                 // 批处理大小
            cold_start_backtrace_blocks: 100000,  // 冷启动时回溯最近10万个区块
        }
    }
}
