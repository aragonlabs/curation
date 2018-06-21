pragma solidity 0.4.18;

import "../../contracts/Curation.sol";


contract CurationMock is Curation {
    uint256 _mockTime = now;

    function getTimestampExt() external view returns (uint256) {
        return getTimestamp();
    }

    function setTimestamp(uint i) public {
        _mockTime = i;
    }

    function addTime(uint i) public {
        _mockTime += i;
    }

    function getTimestamp() internal view returns (uint256) {
        return _mockTime;
    }

    function getUsedLock(uint256 lockId) view public returns (bool) {
        return usedLocks[lockId];
    }
}
