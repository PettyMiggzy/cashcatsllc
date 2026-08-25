// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * CashCatsFeeRouter
 * -----------------
 * "Our own swap that uses fees." Users buy any token through this router
 * instead of the raw DEX. It skims a small routing fee (default 1%) in ETH,
 * forwards that fee to the CashCatsBuyBurn contract, and routes the rest of
 * the trade through the underlying V2-style router as normal.
 *
 * Result: every swap that goes through the CashCats front-end funds the
 * buy & burn of $CASHCATSLLC, while the traded token and the $CASHCATSLLC
 * token contract stay 0/0 tax.
 *
 * Wire the site's "Open CashCats Swap" button to a UI that calls
 * buyWithFee(...) on this contract (ethers.js + injected wallet).
 */

interface IV2RouterFR {
    function WETH() external view returns (address);
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;
}

contract CashCatsFeeRouter {
    IV2RouterFR public immutable ROUTER;
    address payable public buyBurn;      // CashCatsBuyBurn address (fee sink)
    address public owner;
    uint16 public feeBps = 100;          // 1.00% (max 300 = 3%)

    event Swapped(address indexed user, address indexed token, uint256 ethIn, uint256 fee);
    event FeeChanged(uint16 bps);
    event SinkChanged(address sink);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor(address router, address payable buyBurn_) {
        ROUTER = IV2RouterFR(router);
        buyBurn = buyBurn_;
        owner = msg.sender;
    }

    /**
     * Buy `token` with ETH; a feeBps cut is forwarded to the buy&burn sink.
     * @param token    token to buy for the user
     * @param minOut   slippage floor on the user's trade
     * @param to       recipient of the purchased tokens
     */
    function buyWithFee(address token, uint256 minOut, address to) external payable {
        require(msg.value > 0, "no eth");
        uint256 fee = (msg.value * feeBps) / 10_000;
        uint256 swapAmt = msg.value - fee;

        if (fee > 0) {
            (bool ok, ) = buyBurn.call{value: fee}("");
            require(ok, "fee xfer failed");
        }

        address[] memory path = new address[](2);
        path[0] = ROUTER.WETH();
        path[1] = token;
        ROUTER.swapExactETHForTokensSupportingFeeOnTransferTokens{value: swapAmt}(
            minOut, path, to, block.timestamp + 600
        );
        emit Swapped(msg.sender, token, msg.value, fee);
    }

    function setFeeBps(uint16 bps) external onlyOwner {
        require(bps <= 300, "fee too high"); // hard cap 3%
        feeBps = bps;
        emit FeeChanged(bps);
    }
    function setSink(address payable sink) external onlyOwner { buyBurn = sink; emit SinkChanged(sink); }
    function transferOwnership(address next) external onlyOwner { owner = next; }
}
