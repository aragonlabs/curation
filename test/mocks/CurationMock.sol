pragma solidity 0.4.18;

import "../../contracts/Curation.sol";


contract CurationMock is Curation {
    uint64 _mockTime = uint64(now);

    function getTimestampExt() external view returns (uint64) {
        return getTimestamp();
    }

    function setTimestamp(uint64 i) public {
        _mockTime = i;
    }

    function addTime(uint64 i) public {
        _mockTime += i;
    }

    function getTimestamp() internal view returns (uint64) {
        return _mockTime;
    }

    function getUsedLock(uint256 lockId) view public returns (bool) {
        return usedLocks[lockId];
    }
}
