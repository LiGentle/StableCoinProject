//! 清算监控模块
//!
//! 负责定时监控用户持仓净值，并在净值低于清算阈值时执行清算操作。
//!
//! ## 主要功能：
//! - 定时获取底层资产价格
//! - 调用NAV计算所有用户持仓净值
//! - 检查净值是否低于清算阈值
//! - 触发清算：调用LiquidationManager.bark函数
//! - 处理清算退出的情况

use std::sync::Arc;
use web3::types::{Address, U256};
use web3::ethabi;
use crate::{nav::NavMonitor, database::Database};

pub struct LiquidationMonitor {
    web3: web3::Web3<web3::transports::Http>,
    nav_monitor: NavMonitor,
    database: Arc<Database>,
    config: crate::config::AppConfig,
    oracle_address: Address,
    liquidation_manager_address: Address,
}

impl LiquidationMonitor {
    pub fn new(
        web3: web3::Web3<web3::transports::Http>,
        nav_monitor: NavMonitor,
        database: Arc<Database>,
        config: crate::config::AppConfig,
        oracle_address: String,
        liquidation_manager_address: String,
        _auction_manager_address: String, // auction manager logic moved to reset.rs
    ) -> anyhow::Result<Self> {
        let oracle = oracle_address.parse::<Address>()?;
        let liquidation_manager = liquidation_manager_address.parse::<Address>()?;

        tracing::info!("清算监控器初始化 - Oracle: {}, LiquidationManager: {}, 检查间隔: {}秒",
                       oracle_address, liquidation_manager_address, config.liquidation_check_interval);

        Ok(Self {
            web3,
            nav_monitor,
            database,
            config,
            oracle_address: oracle,
            liquidation_manager_address: liquidation_manager,
        })
    }

    /// 启动清算监控循环
    pub async fn run(&mut self) -> anyhow::Result<()> {
        tracing::info!("清算监控器启动，监控间隔：{}秒...",
                      self.config.liquidation_check_interval);

        let mut interval = tokio::time::interval(
            std::time::Duration::from_secs(self.config.liquidation_check_interval)
        );

        loop {
            interval.tick().await;

            if let Err(e) = self.check_and_execute_liquidations().await {
                tracing::error!("清算检查执行失败: {}", e);
                // 继续监控，单次失败不会终止程序
            }
        }
    }

    /// 执行一次完整的清算检查
    async fn check_and_execute_liquidations(&self) -> anyhow::Result<()> {
        tracing::info!("开始清算检查...");

        // 1. 获取当前底层资产价格
        let current_price = self.get_current_price().await?;
        tracing::info!("当前底层资产价格: {:?}", current_price);

        // 2. 计算所有用户持仓的NAV
        let nav_results = self.nav_monitor.calculate_all_nav(current_price).await?;
        tracing::info!("NAV计算完成，共处理 {} 个持仓", nav_results.len());

        // 3. 获取清算阈值
        let system_params = self.database.get_system_params()?;
        let liquidation_threshold = system_params.liquidation_threshold;
        tracing::debug!("清算阈值: {:?}", liquidation_threshold);

        // 4. 检查需要清算的持仓
        let liquidatable_positions: Vec<_> = nav_results.iter()
            .filter(|result| {
                // 净值低于清算阈值即可触发清算，无论是否还有正净值
                result.net_nav < liquidation_threshold
            })
            .collect();

        tracing::info!("发现 {} 个持仓需要清算", liquidatable_positions.len());

        // 5. 执行清算
        for position_result in liquidatable_positions {
            if let Err(e) = self.execute_liquidation(&position_result.user, &position_result.token_id).await {
                tracing::error!("执行持仓清算失败 - 用户: {:?}, TokenID: {}, 错误: {}",
                              position_result.user, position_result.token_id, e);
                // 单个持仓清算失败不影响其他清算
            } else {
                tracing::info!("成功发起持仓清算 - 用户: {:?}, TokenID: {}",
                             position_result.user, position_result.token_id);
            }
        }

        Ok(())
    }

    /// 从Oracle合约获取当前价格
    async fn get_current_price(&self) -> anyhow::Result<U256> {
        // 创建调用数据：latestRoundData()
        let _function_abi = r#"[
            {
                "name": "latestRoundData",
                "type": "function",
                "stateMutability": "view",
                "inputs": [],
                "outputs": [
                    {"type": "uint80"},
                    {"type": "int256"},
                    {"type": "uint256"},
                    {"type": "uint256"},
                    {"type": "uint80"}
                ]
            }
        ]"#;

        let contract = get_contract()?;
        let function = contract.function("latestRoundData")?;
        let data = function.encode_input(&[])?;

        // 执行调用
        let result = self.web3.eth()
            .call(
                web3::types::CallRequest {
                    to: Some(self.oracle_address),
                    data: Some(web3::types::Bytes(data)),
                    ..Default::default()
                },
                None,
            )
            .await?;

        // 解码结果
        let tokens = function.decode_output(&result.0)?;
        let price: i128 = tokens[1].clone()
            .into_int()
            .ok_or_else(|| anyhow::anyhow!("无法将代币转换为整数"))?
            .try_into()
            .map_err(|_| anyhow::anyhow!("价格转换超出i128范围"))?;
        let price_u256 = U256::from(price.abs() as u128);

        Ok(price_u256)
    }

    /// 执行单个持仓的清算
    async fn execute_liquidation(&self, user: &Address, token_id: &U256) -> anyhow::Result<()> {
        // 获取Keeper地址（当前为默认地址，可根据需求修改）
        let keeper_address = web3::types::Address::from_low_u64_be(0x123456789abcdef); // 示例地址

        // 创建bark函数调用数据
        let _function_abi = r#"[
            {
                "name": "bark",
                "type": "function",
                "stateMutability": "nonpayable",
                "inputs": [
                    {"type": "address", "name": "user"},
                    {"type": "uint256", "name": "tokenId"},
                    {"type": "address", "name": "kpr"}
                ],
                "outputs": [{"type": "uint256"}]
            }
        ]"#;

        let contract = get_contract()?;
        let function = contract.function("bark")?;
        let data = function.encode_input(&[
            ethabi::Token::Address(*user),
            ethabi::Token::Uint(*token_id),
            ethabi::Token::Address(keeper_address),
        ])?;

        // 构建交易
        let accounts = self.web3.eth().accounts().await?;
        if accounts.is_empty() {
            return Err(anyhow::anyhow!("No available accounts for transaction"));
        }

        let tx = web3::types::TransactionRequest {
            from: accounts[0],
            to: Some(self.liquidation_manager_address),
            data: Some(web3::types::Bytes(data)),
            ..Default::default()
        };

        // 发送交易
        let tx_hash = self.web3.eth().send_transaction(tx).await?;
        tracing::info!("清算交易已发送: {:?}, 稍后events.rs会自动记录auction信息", tx_hash);


        // 等待交易确认 - auctionId会由events.rs中的AuctionStarted事件处理
        let receipt = self.web3.eth().transaction_receipt(tx_hash).await?;
        match receipt {
            Some(_) => Ok(()),
            None => Err(anyhow::anyhow!("交易未确认")),
        }
    }
}

/// 获取LiquidationManager合约的ABI
fn get_contract() -> anyhow::Result<ethabi::Contract> {
    // LiquidationManager的基本ABI，包含bark函数和latestRoundData
    let abi = r#"[
        {
            "name": "latestRoundData",
            "type": "function",
            "stateMutability": "view",
            "inputs": [],
            "outputs": [
                {"type": "uint80"},
                {"type": "int256"},
                {"type": "uint256"},
                {"type": "uint256"},
                {"type": "uint80"}
            ]
        },
        {
            "name": "bark",
            "type": "function",
            "stateMutability": "nonpayable",
            "inputs": [
                {"type": "address", "name": "user"},
                {"type": "uint256", "name": "tokenId"},
                {"type": "address", "name": "kpr"}
                ],
            "outputs": [{"type": "uint256"}]
        }
    ]"#;

    let contract: ethabi::Contract = serde_json::from_str(abi)?;
    Ok(contract)
}
