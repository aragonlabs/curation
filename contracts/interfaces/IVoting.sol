pragma solidity ^0.4.18;


interface IVoting {
    function newVote(bytes _executionScript, string _metadata) external returns (uint256 voteId);
    function isClosed(uint256 voteId) view public returns (bool);
    function getVoteResult(uint256 voteId) public returns (bool result, uint256 winningStake, uint256 totalStake);
    function getVoterWinningStake(uint256 voteId, address voter) public returns (uint256);
}


contract FakeVoting {
    // to work around coverage issue
    function fake() public {
        // for lint
    }
}
