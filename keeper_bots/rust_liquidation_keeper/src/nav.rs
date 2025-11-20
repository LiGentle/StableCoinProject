//! NAV 监控模块
//!
//! 负责计算和更新代币的净资产价值（Net Asset Value）。

use std::sync::Arc;
use web3::types::U256;
use crate::database::{Database, LeverageType, UserPosition};

/// NAV计算结果结构体
#[derive(Debug, Clone)]
pub struct NavCalculation {
    pub user: web3::types::Address,
    pub token_id: U256,
    pub gross_nav: U256,        // 粗净值（18位精度）
    pub net_nav: U256,          // 净值（粗净值-累计利息调整后的18位精度）
    pub position_amount: U256,  // 持仓数量
    pub total_value: U256,      // 总价值（持仓量 * 粗净值）
    pub net_value: U256,        // 净价值（总价值 - 累计利息）
    pub accrued_interest: U256, // 累计利息
}

/// NAV 监控器
pub struct NavMonitor {
    web3: web3::Web3<web3::transports::Http>,
    database: Arc<Database>,
}

impl NavMonitor {
    pub fn new(
        web3: web3::Web3<web3::transports::Http>,
        database: Arc<Database>,
    ) -> anyhow::Result<Self> {
        tracing::info!("NAV监控器初始化");
        Ok(Self {
            web3,
            database,
        })
    }

    /// 计算从特定时间点以来积累的利息
    ///
    /// 对应InterestManager._calculateAccruedInterest函数
    /// 公式：本金 × 年利率 × 持有时间比例 / (BASIS_POINTS × SECONDS_PER_YEAR)
    /// 然后根据杠杆类型调整：Conservative除以8，Moderate除以4，Aggressive不变
    ///
    /// @param position_amount 持仓数量（L代币数量）
    /// @param leverage_level 杠杆类型
    /// @param interest_rate 年化利率（基点）
    /// @param holding_time_seconds 持有时间（秒）
    /// @return 积累的利息金额（18位精度）
    pub fn calculate_accrued_interest(
    &self,
    position_amount: U256,
    leverage_level: LeverageType,
    interest_rate: U256, // 假设 interest_rate 是以基点表示的年利率，例如 500 表示 5%
    holding_time_seconds: u64,
    ) -> Option<U256> { // 修改返回类型为 Option<U256> 以处理溢出
        if position_amount.is_zero() || interest_rate.is_zero() {
            return Some(U256::zero());
        }
    
        let basis_points = U256::from(10_000u64);
        let seconds_per_year = U256::from(365 * 24 * 60 * 60);
    
        // 1. 调整计算顺序，先处理可能的大数相除，再相乘，以减少中间值溢出的风险
        // 公式: (position_amount * (interest_rate * holding_time_seconds)) / (basis_points * seconds_per_year)
        // 但为了更好精度，可以尝试： (position_amount * holding_time_seconds * interest_rate) / (basis_points * seconds_per_year)
    
        // 使用 checked_ 系列方法防止溢出
        let numerator = position_amount
            .checked_mul(U256::from(holding_time_seconds))? // 第一步乘
            .checked_mul(interest_rate)?; // 第二步乘
    
        let denominator = basis_points.checked_mul(seconds_per_year)?;
    
        // 2. 执行除法
        let base_accrued_interest = numerator.checked_div(denominator)?;
    
        // 3. 根据杠杆类型调整
        let accrued_interest = match leverage_level {
            LeverageType::Conservative => base_accrued_interest.checked_div(U256::from(8u64))?,
            LeverageType::Moderate => base_accrued_interest.checked_div(U256::from(4u64))?,
            LeverageType::Aggressive => base_accrued_interest,
        };
    
        Some(accrued_interest)
    }
    
    /// 计算所有用户持仓的净值
    /// 使用最新的底层资产价格来计算各个持仓的单位净值
    ///
    /// 计算步骤：
    /// 1. 获取系统参数（包括年利率）
    /// 2. 获取所有用户持仓信息
    /// 3. 为每个持仓计算从上次记录时间至今新产生的利息
    /// 4. 更新总累计利息（数据库中的利息 + 新产生的利息）
    /// 5. 为每个持仓计算粗净值（gross_nav）
    /// 6. 计算总价值（total_value = 持仓量 * 粗净值）
    /// 7. 计算除息净值（net_nav = (总价值 - 总累计利息) / 持仓量）
    /// 8. 计算净价值（net_value = 总价值 - 总累计利息）
    ///
    /// @param current_price 当前底层资产价格(U256，18位精度)
    /// @return Vec<NavCalculation> 所有持仓的NAV计算结果
    pub async fn calculate_all_nav(&self, current_price: U256) -> anyhow::Result<Vec<NavCalculation>> {
        let mut results = Vec::new();
        let price_precision = U256::from(1_000_000_000_000_000_000u64); // 1e18
        let current_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // 获取系统参数，包括年利率
        let system_params = self.database.get_system_params()?;
        let interest_rate = system_params.annual_interest_rate;

        tracing::info!("使用年利率: {} (基点)", interest_rate);

        // 获取所有用户持仓信息
        let all_positions = self.get_all_user_positions()?;

        tracing::info!("开始计算 {} 个持仓的NAV", all_positions.len());

        for position in all_positions {
            // 如果mint_price为0，跳过该持仓的计算
            if position.mint_price.is_zero() {
                tracing::warn!("持仓 {:?} mint_price为0，跳过NAV计算", position.token_id);
                continue;
            }

            // 计算从上次记录时间至今新产生的利息（实时利息）
            let holding_time_since_last_update = current_time.saturating_sub(position.timestamp);
            let new_accrued_interest = match self.calculate_accrued_interest(
                position.amount,
                position.leverage.clone(),
                interest_rate,
                holding_time_since_last_update,
            ) {
                Some(interest) => interest,
                None => {
                    tracing::warn!("利息计算溢出 - 持仓: {:?}, 使用0作为新利息", position.token_id);
                    U256::zero()
                }
            };

            // 总累计利息 = 数据库中的累计利息 + 新产生的利息
            let total_accrued_interest = position.total_interest + new_accrued_interest;

            tracing::debug!(
                "利息计算 - 持仓: {:?}, 上次更新时间: {}, 持有时间: {}秒, 新利息: {}, 总利息: {}",
                position.token_id, position.timestamp, holding_time_since_last_update,
                new_accrued_interest, total_accrued_interest
            );

            // 计算粗净值（对应Solidity中的_calculateNav）
            let gross_nav = self.calculate_gross_nav(
                position.leverage.clone(),
                current_price,
                position.mint_price
            )?;

            // 计算总价值：total_value = position.amount * gross_nav / price_precision
            let total_value = if !gross_nav.is_zero() {
                position.amount * gross_nav / price_precision
            } else {
                U256::zero()
            };

            // 计算除息净值和净价值
            let (net_nav, net_value) = if total_value >= total_accrued_interest {
                // net_value = total_value - total_accrued_interest
                let net_value = total_value - total_accrued_interest;

                // net_nav = net_value * price_precision / position_amount
                let net_nav = if !position.amount.is_zero() {
                    net_value * price_precision / position.amount
                } else {
                    U256::zero()
                };

                (net_nav, net_value)
            } else {
                // 如果累计利息超过总价值，净值为0
                tracing::warn!("持仓 {:?} 累计利息超过总价值，净值设为0", position.token_id);
                (U256::zero(), U256::zero())
            };

            results.push(NavCalculation {
                user: position.user,
                token_id: position.token_id,
                gross_nav,
                net_nav,
                position_amount: position.amount,
                total_value,
                net_value,
                accrued_interest: total_accrued_interest,
            });

            tracing::debug!(
                "持仓NAV计算完成 - 用户: {:?}, TokenID: {}, 粗净值: {}, 净值: {}, 持仓量: {}",
                position.user, position.token_id, gross_nav, net_nav, position.amount
            );
        }

        tracing::info!("NAV计算完成，共处理 {} 个有效持仓", results.len());
        Ok(results)
    }

    /// 计算粗净值（对应CustodianFixed._calculateNav函数）
    ///
    /// CONSERVATIVE: (9*Pt - P0) / (8*P0)
    /// MODERATE: (5*Pt - P0) / (4*P0)
    /// AGGRESSIVE: (2*Pt - P0) / (1*P0)
    ///
    /// @param leverage 杠杆类型
    /// @param current_price 当前价格（18位精度）
    /// @return 粗净值（18位精度）
    pub fn calculate_gross_nav(&self, leverage: LeverageType, current_price: U256, mint_price: U256) -> anyhow::Result<U256> {
        const PRICE_PRECISION: u64 = 1_000_000_000_000_000_000; // 1e18

        match leverage {
            LeverageType::Conservative => {
                // NAV = (9*Pt - P0) / (8*P0)
                let pt_scaled = U256::from(9u64) * current_price;
                let numerator = pt_scaled - mint_price;
                let denominator = U256::from(8u64) * mint_price;
                if denominator.is_zero() {
                    return Err(anyhow::anyhow!("Invalid mint price for Conservative leverage"));
                }
                Ok(numerator * U256::from(PRICE_PRECISION) / denominator)
            }
            LeverageType::Moderate => {
                // NAV = (5*Pt - P0) / (4*P0)
                let pt_scaled = U256::from(5u64) * current_price;
                let numerator = pt_scaled - mint_price;
                let denominator = U256::from(4u64) * mint_price;
                if denominator.is_zero() {
                    return Err(anyhow::anyhow!("Invalid mint price for Moderate leverage"));
                }
                Ok(numerator * U256::from(PRICE_PRECISION) / denominator)
            }
            LeverageType::Aggressive => {
                // NAV = (2*Pt - P0) / (1*P0)
                let pt_scaled = U256::from(2u64) * current_price;
                let numerator = pt_scaled - mint_price;
                let denominator = mint_price;
                if denominator.is_zero() {
                    return Err(anyhow::anyhow!("Invalid mint price for Aggressive leverage"));
                }
                Ok(numerator * U256::from(PRICE_PRECISION) / denominator)
            }
        }
    }

    /// 获取所有用户的持仓信息
    fn get_all_user_positions(&self) -> anyhow::Result<Vec<UserPosition>> {
        // 使用database.rs中提供的公共方法
        self.database.get_all_user_positions()
    }

    pub async fn run(&mut self) -> anyhow::Result<()> {
        // TODO: 定期计算和监控NAV变化
        tracing::info!("NAV监控器运行中...");

        // 可以在这里实现定期从链上获取价格并计算NAV的逻辑
        // 使用tokio::time::interval等定时器实现

        std::future::pending().await
    }
}
