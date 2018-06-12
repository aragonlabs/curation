pragma solidity ^0.4.18;


interface IVoting {
    function newVote(bytes _executionScript, string _metadata) external returns (uint256 voteId);
    function setVoteResult(uint256 voteId, bool result, uint256 winningStake, uint256 totalStake) public;
    // TODO: canExecute or isClosed??
    function isClosed(uint256 voteId) view public returns (bool);
    function getVoteResult(uint256 voteId) view public returns (bool, uint256, uint256);
    function getVoterWinningStake(uint256 voteId, address voter) view public returns (uint256);
}


contract FakeVoting {
    // to work around coverage issue
}
