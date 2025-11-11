// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title USDCMock
 * @dev 完整ERC20实现，6位小数，带mint/burn，方便测试。价格锚定1美元由外部市场决定，合约本身不做价格控制。
 */
contract USDCMock is ERC20, Ownable(msg.sender) {
    uint8 private constant _DECIMALS = 6;//与真實USDC一致

    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    /// @notice owner可随意增发USDC
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice owner可销毁USDC
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}