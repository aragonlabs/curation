pragma solidity ^0.4.18;


interface IStaking {
    function unlock(address acct, uint256 lockId) public;
    function unlockAndMoveTokens(uint256 lockId, address from, address to, uint256 amount) external;
    function getLock(
        address acct,
        uint256 lockId
    )
        public
        view
        returns (
            uint256 amount,
            uint8 lockUnit,
            uint64 lockEnds,
            address unlocker,
            bytes32 metadata
        );
}


contract FakeStaking {
    // to work around coverage issue
    function fake() public {
        // for lint
    }
}
