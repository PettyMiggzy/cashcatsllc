// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ⚠️  DO NOT DEPLOY AS-IS. CASHCATSLLC is Uniswap v4-only (native-ETH pool,
 *     hook 0x75A54357D9C78a2Db19004a5FDc76c50F9242AEC, fee 0, tickSpacing 200).
 *     This contract uses a Uniswap v2 router + [WETH, TOKEN] path, so buyAndBurn()
 *     REVERTS every call — no such v2 pair exists. The live buy-&-burn runs
 *     client-side in /swap/ (v4, in the same tx as the buy). Reference only until
 *     ported to v4. Also unfixed here: caller-supplied amountOutMin=0 (MEV) and
 *     owner rescueETH drain. See contracts/README.md.
 *
 * CashCatsBuyBurn
 * ----------------
 * Receives ETH (routing fees from the CashCats Swap) and, on demand,
 * market-buys $CASHCATSLLC through a Uniswap-V2-style router and sends
 * every token it buys to the dead address. Supply only goes down.
 *
 * The token contract itself is untouched (tax stays 0/0). All the
 * "buy & burn" lives here, in the swap layer, exactly as the site says.
 *
 * Deploy notes:
 *   - ROUTER  = the V2-style router deployed on Robinhood Chain (set at deploy).
 *   - TOKEN   = 0x53a557a2a46083A3E9cD26ff4cdc4CC81DA809cc ($CASHCATSLLC).
 *   - WETH    = the wrapped-native token the router uses.
 *   Anyone can call buyAndBurn(); it is permissionless on purpose so the
 *   community (or a keeper) can trigger burns. minOut guards against MEV.
 */

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
}

interface IV2Router {
    function WETH() external view returns (address);
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;
}

contract CashCatsBuyBurn {
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address public immutable TOKEN;   // $CASHCATSLLC
    IV2Router public immutable ROUTER;
    address public owner;

    event Burned(address indexed caller, uint256 ethIn, uint256 tokensBurned);
    event RouterFunded(address indexed from, uint256 amount);
    event OwnerChanged(address indexed prev, address indexed next);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor(address router, address token) {
        ROUTER = IV2Router(router);
        TOKEN = token;
        owner = msg.sender;
    }

    /// Fees arrive here as plain ETH transfers.
    receive() external payable { emit RouterFunded(msg.sender, msg.value); }

    /**
     * Swap the contract's entire ETH balance for $CASHCATSLLC and burn it.
     * @param amountOutMin slippage floor (0 allowed but discouraged).
     */
    function buyAndBurn(uint256 amountOutMin) external {
        uint256 ethIn = address(this).balance;
        require(ethIn > 0, "no fees to burn");

        address[] memory path = new address[](2);
        path[0] = ROUTER.WETH();
        path[1] = TOKEN;

        uint256 before = IERC20(TOKEN).balanceOf(DEAD);
        // Send bought tokens straight to the dead address — never held here.
        ROUTER.swapExactETHForTokensSupportingFeeOnTransferTokens{value: ethIn}(
            amountOutMin, path, DEAD, block.timestamp + 600
        );
        uint256 burned = IERC20(TOKEN).balanceOf(DEAD) - before;
        emit Burned(msg.sender, ethIn, burned);
    }

    /// Total $CASHCATSLLC this mechanism has burned to the dead address.
    function totalBurnedAtDead() external view returns (uint256) {
        return IERC20(TOKEN).balanceOf(DEAD);
    }

    function transferOwnership(address next) external onlyOwner {
        emit OwnerChanged(owner, next);
        owner = next;
    }

    /// Escape hatch for stuck ETH before any router is trusted. No token custody.
    function rescueETH(address to) external onlyOwner {
        (bool ok, ) = to.call{value: address(this).balance}("");
        require(ok, "rescue failed");
    }
}
