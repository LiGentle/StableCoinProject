//! Rust Liquidation Keeper Bot
//!
//! 这个机器人用于监控杠杆代币系统的清算事件和拍卖。

mod config;
mod database;
mod events;
mod liquidation;
mod nav;
mod reset;

use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 初始化日志
    tracing_subscriber::fmt()
        .with_level(true)
        .with_thread_ids(true)
        .with_target(false)
        .compact()
        .init();

    tracing::info!("启动 Rust Liquidation Keeper...");

    // 加载配置
    let config = config::load_config()?;
    tracing::info!("配置加载成功");

    // 初始化数据库
    let database = Arc::new(database::Database::new().await?);
    tracing::info!("数据库初始化成功");

    // 创建Web3客户端
    let web3 = web3::Web3::new(
        web3::transports::Http::new(&config.rpc_url)?
    );
    tracing::info!("Web3客户端初始化成功");

    // 创建导航监控器对象供清算监控器使用
    let nav_for_liquidation = nav::NavMonitor::new(
        web3.clone(),
        database.clone(),
    )?;

    // 创建清算监控器
    let mut liquidation_monitor = liquidation::LiquidationMonitor::new(
        web3.clone(),
        nav_for_liquidation,
        database.clone(),
        config.clone(),
        config.contracts.oracle.clone(),
        config.contracts.liquidation_manager.clone(),
        config.contracts.auction_manager.clone(),
    )?;

    // 创建独立的NAV监控器用于单独运行
    let mut nav_monitor = nav::NavMonitor::new(
        web3.clone(),
        database.clone(),
    )?;

    let mut event_monitor = events::EventMonitor::new(
        web3.clone(),
        database.clone(),
        config.clone(),
    ).await?;

    tracing::info!("所有监控器初始化完成，准备启动...");

    // 启动所有监控任务
    let liquidation_handle = tokio::spawn(async move {
        if let Err(e) = liquidation_monitor.run().await {
            tracing::error!("清算监控器错误: {}", e);
        }
    });

    let nav_handle = tokio::spawn(async move {
        if let Err(e) = nav_monitor.run().await {
            tracing::error!("NAV监控器错误: {}", e);
        }
    });

    let events_handle = tokio::spawn(async move {
        if let Err(e) = event_monitor.run().await {
            tracing::error!("事件监控器错误: {}", e);
        }
    });

    // 等待所有任务完成或者接收到关闭信号
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("收到关闭信号，正在停止...");
        }
        _ = liquidation_handle => {
            tracing::info!("清算监控任务已结束");
        }
        _ = nav_handle => {
            tracing::info!("NAV监控任务已结束");
        }
        _ = events_handle => {
            tracing::info!("事件监控任务已结束");
        }
    }

    tracing::info!("Keeper 已停止");
    Ok(())
}
