// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// 杠杆类型枚举 - 所有合约共享
// 杠杆类型枚举
enum LeverageType{
    CONSERVATIVE,   // 保守型 (1S8L)  ,1元借0.125元, 等價於(1L0.125S) --> 8/(9P) underlying
    MODERATE,       // 温和型 (1S4L)  ,1元借0.25元,  等價於(1L0.25S)  --> 5/(4P) underlying
    AGGRESSIVE     // 激进型 (1S1L)  ,1元借1元,     等價於(1L1S)     --> 2/(P)  underlying
    // HIGH_RISK,      // 高风险 (1S0.5L),1元借2元,     等價於(1L2S)     --> 3/(P)  underlying
    // EXTREME         // 极端型 (1S0.2L),1元借5元,     等價於(1L5S)     --> 6/(P)  underlying
}

// 杠杆代币信息
struct LeverageInfo {

    // 確定leverage(三種類型) + 鑄幣標的價格P0(underlyingPriceInWei):
    // 用戶輸入N份標的資產，即可確定：1. 用戶鑄幣的數量；2. 用戶所鑄杠桿幣的净值(假設當前為Pt)
    // 比如用戶有z份標的, 按照"MODERATE(1S4L)+P0"為參數進行鑄幣
    // stable token: x, leverage token: y = 4x
    // x*1 + y*1 = x + 4x = 5x = z*P0 <-- x = z*P0/5即爲stable token數量
    // x*1 + 4x*nav = z*Pt
    // nav = (z*Pt - x*1)/4x = (z*Pt - z*P0/5)/4/(z*P0/5) = (5Pt - P0)/(4P0)

    uint256 underlyingPriceInWei;     // 按照底層資產價格為underlyingPriceInWei進行鑄幣
    LeverageType leverage;                // 杠杆类型
    bool active;                      // 是否激活
}

// 其他共享的结构体也可以放在这里
struct BatchInfo {
    uint256 batchId;
    uint256 executionTime;
    uint256 actualExecutionTime;
    bool executed;
    uint256 requestCount;
}

struct SplitRequest {
    address user;// 用户地址
    uint256 underlyingAmountInWei;// 基础资产数量
    uint256 underlyingSplitPriceInWei;// 鑄幣價格, 即按照多少價格鑄造
    LeverageType leverage;// 杠杆级别
    uint256 submittedAt;// 提交时间
    bool executed;// 是否已执行
    uint256 batchId;// 批次ID
}

// // 用户持仓记录
// struct UserPosition {
//     uint256 lAmountInWei;          // 持有数量
//     uint256 timestamp;       // 开始持有时间
//     uint256 accruedInterest; // 已累积利息
//     bool active;             // 是否激活
// }