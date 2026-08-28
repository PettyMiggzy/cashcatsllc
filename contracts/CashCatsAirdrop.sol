// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * CashCatsAirdrop
 * ----------------
 * A simple, deployable on-chain distributor: send $CASHCATSLLC to this contract,
 * then call distribute() and it splits the contract's ENTIRE balance to a fixed
 * list of recipients (the top-30 holders of the original Cash Cat token),
 * pro-rata by weight, in a single transaction.
 *
 * Fund it as many times as you like — each distribute() pays out whatever
 * $CASHCATSLLC currently sits in the contract, so you can top it up and re-run.
 *
 *   TOKEN      = 0x466b4F0be1f6e7Cf87f6de43B3ABd33233EE05cc  ($CASHCATSLLC)
 *   recipients = top-30 Cash Cat holders  (from scripts/snapshot-cashcat-top30.mjs)
 *   weights    = their Cash Cat balances  (pro-rata). For an EQUAL split, pass all 1s.
 *
 * Notes
 *  - distribute() is permissionless but can ONLY move the contract's own balance
 *    to the preset recipients — it can never touch anyone else's funds.
 *  - The last recipient receives any rounding remainder, so no dust is stranded.
 *  - The owner can refresh the recipient set (re-snapshot) and rescue tokens.
 *  - Deploy on Robinhood Chain (4663). Verify TOKEN before funding.
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

contract CashCatsAirdrop {
    address public owner;
    address public pendingOwner;        // two-step ownership: must be accepted
    IERC20 public immutable TOKEN;      // $CASHCATSLLC
    address[] public recipients;        // top-N Cash Cat holders
    uint256[] public weights;           // pro-rata weights (Cash Cat balances)
    uint256 public totalWeight;
    uint256 public totalDistributed;
    uint256 private _lock = 1;          // reentrancy guard

    event Distributed(uint256 amount, uint256 count);
    event RecipientsSet(uint256 count, uint256 totalWeight);
    event OwnershipTransferStarted(address indexed prev, address indexed next);
    event OwnerChanged(address indexed prev, address indexed next);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier nonReentrant() { require(_lock == 1, "reentrant"); _lock = 2; _; _lock = 1; }

    /// ERC-20 transfer that tolerates tokens which return no data (USDT-style).
    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "transfer failed");
    }

    constructor(address token, address[] memory _recipients, uint256[] memory _weights) {
        require(token != address(0), "token=0");
        TOKEN = IERC20(token);
        owner = msg.sender;
        _setRecipients(_recipients, _weights);
    }

    function _setRecipients(address[] memory r, uint256[] memory w) internal {
        require(r.length == w.length && r.length > 0, "bad length");
        delete recipients;
        delete weights;
        uint256 tw;
        for (uint256 i; i < r.length; i++) {
            require(r[i] != address(0), "zero addr");
            require(w[i] > 0, "zero weight");
            recipients.push(r[i]);
            weights.push(w[i]);
            tw += w[i];
        }
        totalWeight = tw;
        emit RecipientsSet(r.length, tw);
    }

    /// Owner can refresh the recipient set for a later snapshot.
    function setRecipients(address[] calldata r, uint256[] calldata w) external onlyOwner {
        _setRecipients(r, w);
    }

    /// Split the contract's ENTIRE $CASHCATSLLC balance across recipients, pro-rata by weight.
    /// Permissionless: it can only ever move this contract's own balance to the preset list.
    function distribute() external nonReentrant {
        uint256 bal = TOKEN.balanceOf(address(this));
        require(bal > 0, "nothing to distribute");
        uint256 tw = totalWeight;
        uint256 n = recipients.length;
        uint256 sent;
        for (uint256 i; i < n; i++) {
            // last recipient absorbs the rounding remainder so nothing is stranded
            uint256 amt = (i == n - 1) ? (bal - sent) : (bal * weights[i]) / tw;
            if (amt > 0) {
                _safeTransfer(address(TOKEN), recipients[i], amt);
                sent += amt;
            }
        }
        totalDistributed += sent;
        emit Distributed(sent, n);
    }

    // ---- views ----
    function recipientCount() external view returns (uint256) { return recipients.length; }
    function pending() external view returns (uint256) { return TOKEN.balanceOf(address(this)); }
    function allRecipients() external view returns (address[] memory) { return recipients; }

    // ---- admin ----
    /// Two-step ownership: current owner nominates, nominee must accept.
    /// Prevents a typo'd address from permanently orphaning admin control.
    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "zero");
        pendingOwner = next;
        emit OwnershipTransferStarted(owner, next);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        emit OwnerChanged(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    /// Reclaim tokens sent here (wrong token, or to pull funds back before distributing).
    function rescue(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        _safeTransfer(token, to, amount);
    }
}
