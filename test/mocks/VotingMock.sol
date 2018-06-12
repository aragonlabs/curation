pragma solidity 0.4.18;

import "../../contracts/interfaces/IVoting.sol";


contract VotingMock is IVoting {
    uint256 voteId;
    struct Vote {
        bool result;
        uint256 winningStake;
        uint256 totalStake;
    }
    mapping(uint256 => Vote) results;
    mapping(uint256 => bool) closed; // TODO
    mapping(address => uint256) voterWinningStake;

    function newVote(bytes _executionScript, string _metadata) external returns (uint256) {
        return voteId;
    }

    function setVoteClosed(uint256 _voteId, bool _closed) public {
        closed[_voteId] = _closed;
    }

    function setVoteId(uint256 _voteId) public {
        voteId = _voteId;
    }

    function setVoteResult(uint256 _voteId, bool _result, uint256 _winningStake, uint256 _totalStake) public {
        results[_voteId] = Vote(_result, _winningStake, _totalStake);
    }

    function setVoterWinningStake(address _voter, uint256 _stake) {
        voterWinningStake[_voter] = _stake;
    }

    // TODO: canExecute or isClosed??
    function isClosed(uint256 _voteId) view public returns (bool) {
        return closed[_voteId];
    }

    function getVoteResult(uint256 _voteId) view public returns (bool _result, uint256 _winningStake, uint256 _totalStake) {
        return (results[_voteId].result, results[_voteId].winningStake, results[_voteId].totalStake);
    }

    function getVoterWinningStake(uint256 _voteId, address _voter) view public returns (uint256) {
        if (!isClosed(_voteId)) {
            return 0;
        }

        return voterWinningStake[_voter];
    }
}
