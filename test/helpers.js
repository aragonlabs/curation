module.exports = {
  // checks if a log for unlocking tokens was generated with the given params
  checkUnlocked: (receipt, account, unlocker, lockId) => {
    const logs = receipt.receipt.logs.filter(
      l =>
        l.topics[0] == web3.sha3('Unlocked(address,address,uint256)') &&
        '0x' + l.topics[1].slice(26) == account &&
        '0x' + l.topics[2].slice(26) == unlocker &&
        web3.toDecimal(l.data) == lockId
    )
    return logs.length == 1
  },

  // checks if a log for moving tokens was generated with the given params
  // if amount is 0, it will check for any
  checkMovedTokens: (receipt, from, to, amount) => {
    const logs = receipt.receipt.logs.filter(
      l =>
        l.topics[0] == web3.sha3('MovedTokens(address,address,uint256)') &&
        '0x' + l.topics[1].slice(26) == from &&
        '0x' + l.topics[2].slice(26) == to &&
        (web3.toDecimal(l.data) == amount || amount == 0)
    )
    return logs.length == 1 || (amount == 0 && logs.length >= 1)
  }
}
