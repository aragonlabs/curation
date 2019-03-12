pragma solidity 0.4.24;

import "staking/contracts/IStakingLocking.sol";


contract StakingMock is IStakingLocking {
    uint256 amount;
    uint8 lockUnit;
    uint64 lockStarts;
    uint64 lockEnds;
    address unlocker;
    bytes32 metadata;

    event Unlocked(address indexed account, address indexed unlocker, uint256 oldLockId);
    event UnlockedPartial(address indexed account, address indexed unlocker, uint256 indexed lockId, uint256 amount);
    event MovedTokens(address indexed from, address indexed to, uint256 amount);

    function setLock(uint256 _amount, uint8 _lockUnit, uint64 _lockStarts, uint64 _lockEnds, address _unlocker, bytes32 _metadata) public {
        amount = _amount;
        lockUnit = _lockUnit;
        lockStarts = _lockStarts;
        lockEnds = _lockEnds;
        unlocker = _unlocker;
    }

    function unlock(address _acct, uint256 _lockId) public {
        emit Unlocked(_acct, msg.sender, _lockId);
    }

    function moveTokens(address _from, address _to, uint256 _amount) public {
        emit MovedTokens(_from, _to, _amount);
    }

    function unlockPartialAndMoveTokens(address _from, uint256 _lockId, address _to, uint256 _amount) external {
        emit UnlockedPartial(_from, msg.sender, _lockId, _amount);
        emit MovedTokens(_from, _to, _amount);
    }

    function getLock(
        address acct,
        uint256 lockId
    )
        public
        view
        returns (
            uint256 _amount,
            uint8 _lockUnit,
            uint64 _lockStarts,
            uint64 _lockEnds,
            address _unlocker,
            bytes32 _metadata,
            uint256 _prevUnlockerLockId,
            uint256 _nextUnlockerLockId
        )
    {
        return (amount, lockUnit, lockStarts, lockEnds, unlocker, metadata, 0, 0);
    }


}
