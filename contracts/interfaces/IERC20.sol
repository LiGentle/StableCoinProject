// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC20 {
	//QUESTION: why view function?
	function balanceOf(address) external view returns (uint);
	function transfer(address to, uint value) external returns (bool success);
	function transferFrom(address from, address to, uint value) external returns (bool success);
	function approve(address spender, uint value) external returns (bool success);
}